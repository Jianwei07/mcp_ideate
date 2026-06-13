import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientConfig } from "../src/host/config.ts";
import { createHost } from "../src/host/server.ts";
import { SessionStore } from "../src/persistence/store.ts";

const servers: Bun.Server<undefined>[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("host API", () => {
  test("exposes runtime metadata for the frontend", async () => {
    const server = createHost(testConfig(), { preflight: false });
    servers.push(server);

    const response = await fetch(`http://${server.hostname}:${server.port}/api/config`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      knowledge: "CS230 page tree",
      inference: "test-model · local",
      transport: "MCP stdio",
      audit: "Metadata only",
    });
  });

  test("rejects greeting queries before starting a run", async () => {
    const server = createHost(testConfig(), { preflight: false });
    servers.push(server);

    const response = await fetch(`http://${server.hostname}:${server.port}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hello" }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "NON_RESEARCH_QUERY",
      message: "Ask a standalone research question about the approved CS230 notes.",
      stage: "validation",
      retryable: false,
      httpStatus: 422,
    });
  });

  test("serves persisted sessions and SSE event replay", async () => {
    const config = testConfig();
    const store = new SessionStore(config.databasePath);
    const session = store.createSession("What should teams monitor?");
    const turn = store.createTurn({
      sessionId: session.id,
      query: "What should teams monitor?",
      model: "test-model",
      thinkingRequested: false,
      thinkingSupported: false,
      contextTokens: 8192,
    });
    store.appendEvent({
      id: "event-1",
      turnId: turn.id,
      sequence: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      channel: "application",
      origin: "host",
      direction: "internal",
      kind: "run",
      method: null,
      requestId: null,
      parentRequestId: null,
      level: "info",
      status: "complete",
      summary: "Completed persisted run",
      durationMs: null,
      metadata: { safe: true },
      detailAvailable: false,
    });
    store.close();
    const server = createHost(config, { preflight: false });
    servers.push(server);

    const baseUrl = `http://${server.hostname}:${server.port}`;
    const sessions = (await (await fetch(`${baseUrl}/api/sessions`)).json()) as {
      sessions: Array<{ id: string }>;
    };
    const restored = (await (
      await fetch(`${baseUrl}/api/sessions/${session.id}`)
    ).json()) as {
      session: { turns: Array<{ id: string }> };
    };
    const events = await (await fetch(`${baseUrl}/api/runs/${turn.id}/events`)).text();

    expect(sessions.sessions.map((item) => item.id)).toContain(session.id);
    expect(restored.session.turns[0].id).toBe(turn.id);
    expect(events).toContain("Completed persisted run");
    expect(events).toContain('"run_id":"');
  });

  test("rejects overlapping active runs", async () => {
    const config = testConfig();
    const server = createHost(config, {
      preflight: false,
      runExecutor: async (
        runId,
        _query,
        _thinking,
        _config,
        store,
        _audit,
        _ollama,
        _approvals,
        signal,
        activeRuns,
      ) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        store.updateTurn(runId, { status: "cancelled" });
        const run = activeRuns.get(runId);
        if (run) clearTimeout(run.timeout);
        activeRuns.delete(runId);
      },
    });
    servers.push(server);
    const baseUrl = `http://${server.hostname}:${server.port}`;

    const first = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "What should teams monitor?" }),
    });
    const started = (await first.json()) as { run_id: string };
    const second = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "What should teams monitor next?" }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      code: "RUN_ALREADY_ACTIVE",
      stage: "host",
      retryable: true,
      httpStatus: 409,
    });
    await fetch(`${baseUrl}/api/runs/${started.run_id}`, { method: "DELETE" });

    await waitFor(async () => {
      return (await hostTurnStatus(baseUrl, started.run_id)) === "cancelled";
    });
  });

  test("persists citation validation failure as a domain error", async () => {
    const notion = fakeNotionServer();
    const ollama = fakeOllamaServer("Monitor loss and data quality.");
    servers.push(notion, ollama);
    const previousEnv = setNotionEnv(notion);
    const config = {
      ...testConfig(),
      ollamaBaseUrl: `http://${ollama.hostname}:${ollama.port}`,
      serverEntry: join(process.cwd(), "server/src/index.ts"),
    };
    const server = createHost(config, { preflight: false });
    servers.push(server);
    const baseUrl = `http://${server.hostname}:${server.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "What should teams monitor?" }),
      });
      const started = (await response.json()) as { run_id: string };

      await waitFor(async () => {
        const approval = (await (
          await fetch(`${baseUrl}/api/runs/${started.run_id}/sampling`)
        ).json()) as { status: string };
        return approval.status === "pending";
      });
      await fetch(`${baseUrl}/api/runs/${started.run_id}/sampling`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve_always" }),
      });

      await waitFor(async () => {
        const turn = await hostTurn(baseUrl, started.run_id);
        return turn?.status === "error";
      });

      const turn = await hostTurn(baseUrl, started.run_id);
      expect(turn).toMatchObject({
        status: "error",
        errorCode: "CITATION_VALIDATION_FAILED",
        errorMessage: "Response withheld because citation validation failed.",
        retryable: false,
      });
    } finally {
      restoreEnv(previousEnv);
    }
  });
});

function testConfig(): ClientConfig {
  const directory = mkdtempSync(join(tmpdir(), "secure-mcp-host-test-"));
  tempDirs.push(directory);
  return {
    host: "127.0.0.1",
    port: 0,
    databasePath: join(directory, "research.db"),
    auditDir: join(directory, "audit"),
    ollamaBaseUrl: "http://127.0.0.1:1",
    ollamaModel: "test-model",
    ollamaContextTokens: 8192,
    ollamaMaxOutputTokens: 1200,
    ollamaKeepAlive: "5m",
    serverEntry: join(directory, "server.ts"),
    serverEnvFile: null,
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await predicate()) return;
    await Bun.sleep(20);
  }
  throw new Error("Timed out waiting for condition");
}

async function hostTurnStatus(baseUrl: string, turnId: string): Promise<string | null> {
  return (await hostTurn(baseUrl, turnId))?.status ?? null;
}

async function hostTurn(
  baseUrl: string,
  turnId: string,
): Promise<{
  id: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean | null;
} | null> {
  const sessions = (await (await fetch(`${baseUrl}/api/sessions`)).json()) as {
    sessions: Array<{ id: string }>;
  };
  for (const session of sessions.sessions) {
    const restored = (await (
      await fetch(`${baseUrl}/api/sessions/${session.id}`)
    ).json()) as {
      session: {
        turns?: Array<{
          id: string;
          status: string;
          errorCode: string | null;
          errorMessage: string | null;
          retryable: boolean | null;
        }>;
      };
    };
    const turn = restored.session.turns?.find((item) => item.id === turnId);
    if (turn) return turn;
  }
  return null;
}

function setNotionEnv(
  server: Bun.Server<undefined>,
): Record<string, string | undefined> {
  const previous = {
    NOTION_TOKEN: process.env.NOTION_TOKEN,
    NOTION_ROOT_PAGE_ID: process.env.NOTION_ROOT_PAGE_ID,
    NOTION_BASE_URL: process.env.NOTION_BASE_URL,
    NOTION_MAX_PAGES: process.env.NOTION_MAX_PAGES,
    NOTION_MAX_BLOCKS: process.env.NOTION_MAX_BLOCKS,
  };
  process.env.NOTION_TOKEN = "test-token";
  process.env.NOTION_ROOT_PAGE_ID = "rootpage";
  process.env.NOTION_BASE_URL = `http://${server.hostname}:${server.port}`;
  process.env.NOTION_MAX_PAGES = "3";
  process.env.NOTION_MAX_BLOCKS = "20";
  return previous;
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function fakeNotionServer(): Bun.Server<undefined> {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/pages/rootpage") {
        return Response.json({
          id: "rootpage",
          url: "https://notion.example/rootpage",
          properties: {
            title: { type: "title", title: [{ plain_text: "Monitoring" }] },
          },
        });
      }
      if (url.pathname === "/v1/search") {
        return Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              object: "page",
              id: "rootpage",
              url: "https://notion.example/rootpage",
              properties: {
                title: { type: "title", title: [{ plain_text: "Monitoring" }] },
              },
            },
          ],
        });
      }
      if (url.pathname === "/v1/pages/rootpage/markdown") {
        return Response.json({
          object: "page_markdown",
          id: "rootpage",
          markdown:
            "# Monitoring\n\nMonitor data quality, loss, and model performance.",
          truncated: false,
          unknown_block_ids: [],
        });
      }
      if (url.pathname === "/v1/blocks/rootpage/children") {
        return Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              id: "heading1",
              type: "heading_2",
              has_children: false,
              heading_2: { rich_text: [{ plain_text: "Monitoring signals" }] },
            },
            {
              id: "body1",
              type: "paragraph",
              has_children: false,
              paragraph: {
                rich_text: [
                  { plain_text: "Monitor data quality, loss, and model performance." },
                ],
              },
            },
          ],
        });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });
}

function fakeOllamaServer(answer: string): Bun.Server<undefined> {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/chat") {
        return Response.json({
          message: {
            content: JSON.stringify({
              status: "answered",
              answer,
              rationale: "The approved source names both signals.",
            }),
          },
          prompt_eval_count: 11,
          eval_count: 7,
          total_duration: 25_000_000,
          load_duration: 0,
          prompt_eval_duration: 10_000_000,
          eval_duration: 15_000_000,
        });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });
}
