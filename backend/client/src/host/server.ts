import {
  createTurnSchema,
  isTrivialGreetingQuery,
  type ResearchResult,
  samplingDecisionSchema,
  type TranscriptEvent,
} from "@secure-research/contracts";
import type { ClientConfig } from "./config.ts";
import { classifyError, printCauseChain } from "./errors.ts";
import { OllamaAdapter } from "../model/ollama.ts";
import { McpConnection } from "../mcp/connection.ts";
import { SessionStore } from "../persistence/store.ts";
import { SamplingApprovalBroker } from "../runs/approval.ts";
import { MetadataAudit } from "../runs/audit.ts";
import { TranscriptRecorder } from "../runs/transcript.ts";

type ActiveRun = {
  controller: AbortController;
  clients: Set<StreamClient>;
  detail?: (sequence: number) => unknown | null;
  timedOut: boolean;
  timeout: Timer;
};

type StreamClient = {
  controller: ReadableStreamDefaultController<string>;
  heartbeat: Timer;
};

type HostOptions = {
  preflight?: boolean;
};

const RUN_TIMEOUT_MS = 60_000;
const SSE_HEARTBEAT_MS = 5_000;
const NON_RESEARCH_MESSAGE =
  "Ask a standalone research question about the approved CS230 notes.";

export function createHost(
  config: ClientConfig,
  options: HostOptions = {},
): Bun.Server<undefined> {
  const store = new SessionStore(config.databasePath);
  const audit = new MetadataAudit(config.auditDir);
  const ollama = new OllamaAdapter(
    config.ollamaBaseUrl,
    config.ollamaModel,
    config.ollamaContextTokens,
    config.ollamaMaxOutputTokens,
    config.ollamaKeepAlive,
  );
  const approvals = new SamplingApprovalBroker();
  const activeRuns = new Map<string, ActiveRun>();

  if (options.preflight ?? true) {
    void ollama.preflight().catch((error) => {
      const correlationId = crypto.randomUUID();
      printCauseChain(error, correlationId);
    });
  }

  return Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 255,
    fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }

      if (url.pathname === "/api/config") {
        return Response.json({
          knowledge: "CS230 page tree",
          inference: `${config.ollamaModel} · local`,
          transport: "MCP stdio",
          audit: "Metadata only",
        });
      }

      if (url.pathname === "/api/sessions" && request.method === "GET") {
        return Response.json({ sessions: store.listSessions() });
      }

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch && request.method === "GET") {
        const session = store.getSession(sessionMatch[1]);
        if (!session) return Response.json({ status: "not_found" }, { status: 404 });
        return Response.json({ session });
      }

      if (url.pathname === "/api/runs" && request.method === "POST") {
        return startRun(request, config, store, audit, ollama, approvals, activeRuns);
      }

      const approvalMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/sampling$/);
      if (approvalMatch && request.method === "GET") {
        return samplingApprovalStatus(approvalMatch[1], approvals);
      }
      if (approvalMatch && request.method === "POST") {
        return decideSampling(request, approvalMatch[1], approvals);
      }

      const eventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (eventMatch && request.method === "GET") {
        const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
        return streamRun(eventMatch[1], Number.isSafeInteger(after) ? after : 0, store, activeRuns);
      }

      const detailMatch = url.pathname.match(
        /^\/api\/runs\/([^/]+)\/events\/(\d+)\/detail$/,
      );
      if (detailMatch && request.method === "GET") {
        return eventDetail(detailMatch[1], Number.parseInt(detailMatch[2], 10), activeRuns);
      }

      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch && request.method === "DELETE") {
        return cancelRun(runMatch[1], activeRuns);
      }

      return Response.json({ status: "not_found" }, { status: 404 });
    },
  });
}

async function startRun(
  request: Request,
  config: ClientConfig,
  store: SessionStore,
  audit: MetadataAudit,
  ollama: OllamaAdapter,
  approvals: SamplingApprovalBroker,
  activeRuns: Map<string, ActiveRun>,
): Promise<Response> {
  const correlationId = crypto.randomUUID();
  try {
    const input = createTurnSchema.parse(await request.json());
    if (isTrivialGreetingQuery(input.query)) {
      return Response.json(
        {
          code: "NON_RESEARCH_QUERY",
          message: NON_RESEARCH_MESSAGE,
          stage: "validation",
          retryable: false,
          correlationId,
          httpStatus: 422,
        },
        { status: 422 },
      );
    }
    const session = store.createSession(input.query);
    const turn = store.createTurn({
      sessionId: session.id,
      query: input.query,
      model: config.ollamaModel,
      thinkingRequested: input.thinking,
      thinkingSupported: ollama.supportsThinking(),
      contextTokens: config.ollamaContextTokens,
    });
    const controller = new AbortController();
    const activeRun: ActiveRun = {
      controller,
      clients: new Set(),
      timedOut: false,
      timeout: setTimeout(() => {
        activeRun.timedOut = true;
        controller.abort();
      }, RUN_TIMEOUT_MS),
    };
    activeRuns.set(turn.id, activeRun);

    void executeRun(
      turn.id,
      input.query,
      input.thinking,
      config,
      store,
      audit,
      ollama,
      approvals,
      controller.signal,
      activeRuns,
    );

    return Response.json({
      run_id: turn.id,
      events_url: `/api/runs/${turn.id}/events`,
    });
  } catch (error) {
    const apiError = classifyError(error, correlationId);
    printCauseChain(error, correlationId);
    return Response.json(apiError, { status: apiError.httpStatus });
  }
}

function samplingApprovalStatus(
  runId: string,
  approvals: SamplingApprovalBroker,
): Response {
  const pending = approvals.pending(runId);
  if (!pending) return Response.json({ status: "none" });
  return Response.json({ status: "pending", approval: pending });
}

async function decideSampling(
  request: Request,
  runId: string,
  approvals: SamplingApprovalBroker,
): Promise<Response> {
  const input = samplingDecisionSchema.parse(await request.json());
  const accepted = approvals.decide(runId, input.decision);
  if (!accepted) return Response.json({ status: "not_found" }, { status: 404 });
  return Response.json({
    status: input.decision === "approve" ? "approved" : "denied",
  });
}

function streamRun(
  runId: string,
  afterSequence: number,
  store: SessionStore,
  activeRuns: Map<string, ActiveRun>,
): Response {
  const run = activeRuns.get(runId);
  const replay = store.listEvents(runId, afterSequence);
  if (!run && !store.getTurn(runId)) {
    return Response.json({ status: "not_found" }, { status: 404 });
  }

  let streamClient: StreamClient | null = null;
  const stream = new ReadableStream<string>({
    start(controller) {
      for (const event of replay) controller.enqueue(sseData(toFrontendEvent(runId, event)));
      if (!run) {
        controller.close();
        return;
      }
      const client: StreamClient = {
        controller,
        heartbeat: setInterval(() => {
          try {
            controller.enqueue(": keepalive\n\n");
          } catch {
            clearInterval(client.heartbeat);
            run.clients.delete(client);
          }
        }, SSE_HEARTBEAT_MS),
      };
      streamClient = client;
      run.clients.add(client);
      controller.enqueue(": connected\n\n");
    },
    cancel() {
      if (streamClient) {
        clearInterval(streamClient.heartbeat);
        run.clients.delete(streamClient);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function eventDetail(
  runId: string,
  sequence: number,
  activeRuns: Map<string, ActiveRun>,
): Response {
  const detail = activeRuns.get(runId)?.detail?.(sequence);
  if (detail === undefined || detail === null) {
    return Response.json({ status: "not_found" }, { status: 404 });
  }
  return Response.json({ detail });
}

function cancelRun(runId: string, activeRuns: Map<string, ActiveRun>): Response {
  const run = activeRuns.get(runId);
  run?.controller.abort();
  broadcast(activeRuns, runId, {
    sequence: 0,
    run_id: runId,
    timestamp: new Date().toISOString(),
    type: "cancelled",
    stage: "host",
    level: "warning",
    message: "The run was cancelled.",
    data: {},
  });
  storeCancelledRun(runId, activeRuns);
  return Response.json({ status: "cancelled" });
}

async function executeRun(
  runId: string,
  query: string,
  thinkingRequested: boolean,
  config: ClientConfig,
  store: SessionStore,
  audit: MetadataAudit,
  ollama: OllamaAdapter,
  approvals: SamplingApprovalBroker,
  signal: AbortSignal,
  activeRuns: Map<string, ActiveRun>,
): Promise<void> {
  const startedAt = Date.now();
  const recorder = new TranscriptRecorder(runId, store, audit);
  const run = activeRuns.get(runId);
  if (run) run.detail = (sequence) => recorder.detail(sequence);
  const unsubscribe = recorder.subscribe((event) => {
    broadcast(activeRuns, runId, toFrontendEvent(runId, event));
  });

  const connection = new McpConnection({
    config,
    ollama,
    thinkingRequested,
    approveSampling: async ({ messageCount, signal }) => {
      store.updateTurn(runId, { status: "awaiting_approval" });
      await recorder.record({
        channel: "application",
        origin: "approval",
        direction: "internal",
        kind: "sampling",
        method: "sampling/createMessage",
        requestId: null,
        parentRequestId: null,
        level: "info",
        status: "pending",
        summary: "Waiting for sampling approval",
        durationMs: null,
        metadata: { messageCount },
      });
      const decision = await approvals.request({ turnId: runId, messageCount }, signal);
      if (decision === "approve") store.updateTurn(runId, { status: "running" });
      return decision;
    },
    emit: async (event) => {
      await recorder.record(event);
    },
  });

  try {
    store.updateTurn(runId, { status: "running" });
    await recorder.record({
      channel: "application",
      origin: "host",
      direction: "internal",
      kind: "run",
      method: null,
      requestId: null,
      parentRequestId: null,
      level: "info",
      status: "running",
      summary: "Started approved research run",
      durationMs: null,
      metadata: {},
    });
    await connection.connect(signal);
    const result = await connection.callResearch(query, { signal });
    finishRun(runId, result, store, activeRuns, Date.now() - startedAt);
  } catch (error) {
    const run = activeRuns.get(runId);
    if (signal.aborted) {
      if (run?.timedOut) {
        const message = "The research run timed out before completing.";
        store.updateTurn(runId, {
          status: "error",
          errorCode: "RUN_TIMEOUT",
          errorMessage: message,
          retryable: true,
        });
        broadcast(activeRuns, runId, {
          sequence: 0,
          run_id: runId,
          timestamp: new Date().toISOString(),
          type: "error",
          stage: "host",
          level: "error",
          message,
          data: { display_message: message },
        });
        return;
      }
      store.updateTurn(runId, { status: "cancelled" });
      return;
    }
    const correlationId = crypto.randomUUID();
    const apiError = classifyError(error, correlationId);
    printCauseChain(error, correlationId);
    store.updateTurn(runId, {
      status: "error",
      errorCode: apiError.code,
      errorMessage: apiError.message,
      retryable: apiError.retryable,
    });
    broadcast(activeRuns, runId, {
      sequence: 0,
      run_id: runId,
      timestamp: new Date().toISOString(),
      type: "error",
      stage: apiError.stage,
      level: "error",
      message: apiError.message,
      data: { display_message: apiError.message, correlationId },
    });
  } finally {
    unsubscribe();
    approvals.cancel(runId);
    await connection.close().catch(() => undefined);
    closeRun(activeRuns, runId);
  }
}

function finishRun(
  runId: string,
  result: ResearchResult,
  store: SessionStore,
  activeRuns: Map<string, ActiveRun>,
  durationMs: number,
): void {
  store.updateTurn(runId, {
    status: result.status === "error" ? "error" : "complete",
    answer: result.answer,
    rationale: result.rationale,
    totalDurationMs: durationMs,
  });
  store.replaceCitations(runId, result.sources);
  broadcast(activeRuns, runId, {
    sequence: 0,
    run_id: runId,
    timestamp: new Date().toISOString(),
    type: "result",
    stage: "validation",
    level: result.status === "error" ? "error" : "info",
    message: "Research run completed",
    data: { result: toFrontendResult(result), duration_ms: durationMs },
  });
}

function broadcast(
  activeRuns: Map<string, ActiveRun>,
  runId: string,
  event: Record<string, unknown>,
): void {
  const run = activeRuns.get(runId);
  if (!run) return;
  const payload = sseData(event);
  for (const client of run.clients) {
    try {
      client.controller.enqueue(payload);
    } catch {
      clearInterval(client.heartbeat);
      run.clients.delete(client);
    }
  }
}

function sseData(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function toFrontendEvent(runId: string, event: TranscriptEvent): Record<string, unknown> {
  return {
    sequence: event.sequence,
    run_id: runId,
    timestamp: event.timestamp,
    type: event.level === "error" ? "error" : "trace",
    stage: event.origin,
    level: event.level,
    message: event.summary,
    data: event.metadata,
  };
}

function closeRun(activeRuns: Map<string, ActiveRun>, runId: string): void {
  const run = activeRuns.get(runId);
  if (!run) return;
  clearTimeout(run.timeout);
  for (const client of run.clients) {
    clearInterval(client.heartbeat);
    try {
      client.controller.close();
    } catch {
      // The browser may already have closed its EventSource.
    }
  }
  activeRuns.delete(runId);
}

function storeCancelledRun(runId: string, activeRuns: Map<string, ActiveRun>): void {
  const run = activeRuns.get(runId);
  if (!run) return;
  clearTimeout(run.timeout);
}

function toFrontendResult(result: ResearchResult) {
  return {
    status: result.status,
    answer: result.answer,
    rationale: result.rationale,
    sources: result.sources.map((source) => ({
      source_id: source.sourceId,
      page_id: source.pageId,
      page_title: source.pageTitle,
      page_url: source.pageUrl,
      heading_path: source.headingPath,
      block_ids: source.blockIds,
      score: source.score,
      excerpt: source.excerpt,
    })),
    cited_source_ids: result.citedSourceIds,
    citation_valid: result.citationValid,
  };
}
