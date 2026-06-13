import {
  ArrowSquareOut,
  ArrowUp,
  Brain,
  CheckCircle,
  CircleNotch,
  Database,
  FileLock,
  FlowArrow,
  Prohibit,
  ShieldCheck,
  Stop,
  TerminalWindow,
  WarningCircle,
} from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  ResearchResult,
  RuntimeConfig,
  SessionDetail,
  SessionSummary,
  SessionTurn,
  TraceEvent,
} from "./types";

const SUGGESTED_QUESTIONS = [
  "What is the disciplined process for developing an ML project?",
  "How do supervised and self-supervised learning differ?",
  "What signals should teams monitor during model development?",
];

type RunStatus = "idle" | "running" | "complete" | "error" | "cancelled";
type SamplingDecision = "approve" | "approve_always" | "deny";

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  knowledge: "Approved page tree",
  inference: "Local model",
  transport: "MCP stdio",
  audit: "Metadata only",
};

const TRIVIAL_GREETING_QUERY_RE =
  /^(hi|hello|hey|yo|sup|thanks|thank you|good morning|good afternoon|good evening)$/;

function App() {
  const [query, setQuery] = useState("");
  const [activeQuestion, setActiveQuestion] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [thinking, setThinking] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<TraceEvent | null>(null);
  const [eventDetail, setEventDetail] = useState<Record<string, unknown> | null>(
    null,
  );
  const [approvalPending, setApprovalPending] = useState(false);
  const [autoApproveSampling, setAutoApproveSampling] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState("");
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>(
    DEFAULT_RUNTIME_CONFIG,
  );
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((config: RuntimeConfig | null) => {
        if (!cancelled && config) setRuntimeConfig(config);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);

  const duration = useMemo(() => {
    const terminal = [...events].reverse().find((event) =>
      ["result", "error", "cancelled"].includes(event.type),
    );
    const value = terminal?.data.duration_ms;
    return typeof value === "number" ? `${(value / 1000).toFixed(1)}s` : "—";
  }, [events]);

  const tokenMetrics = useMemo(() => {
    for (const event of [...events].reverse()) {
      const promptTokens = event.data.promptTokens;
      const outputTokens = event.data.outputTokens;
      if (typeof promptTokens === "number" || typeof outputTokens === "number") {
        return {
          promptTokens: typeof promptTokens === "number" ? promptTokens : 0,
          outputTokens: typeof outputTokens === "number" ? outputTokens : 0,
        };
      }
    }
    return { promptTokens: 0, outputTokens: 0 };
  }, [events]);

  async function loadSessions() {
    const response = await fetch("/api/sessions").catch(() => null);
    if (!response?.ok) return;
    const payload = (await response.json()) as { sessions: SessionSummary[] };
    setSessions(payload.sessions);
  }

  async function startRun(event: FormEvent) {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (cleanQuery.length < 3 || status === "running") return;
    if (isTrivialGreetingQuery(cleanQuery)) {
      setError("Ask a standalone research question about the approved CS230 notes.");
      setStatus("idle");
      return;
    }

    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setEvents([]);
    setSelectedEvent(null);
    setEventDetail(null);
    setApprovalPending(false);
    setAutoApproveSampling(false);
    setResult(null);
    setError("");
    setStatus("running");
    setActiveQuestion(cleanQuery);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: cleanQuery, thinking }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.detail ?? "Unable to start the research run",
        );
      }

      setRunId(payload.run_id);
      const stream = new EventSource(payload.events_url);
      let terminal = false;
      const finish = (nextStatus: RunStatus) => {
        terminal = true;
        setStatus(nextStatus);
        stream.close();
        if (eventSourceRef.current === stream) eventSourceRef.current = null;
      };
      eventSourceRef.current = stream;
      stream.onmessage = (message) => {
        const trace = JSON.parse(message.data) as TraceEvent;
        setEvents((current) => [...current, trace]);
        if (trace.stage === "approval" && trace.type === "trace") {
          setApprovalPending(true);
        }
        if (trace.type === "result") {
          setResult(trace.data.result as ResearchResult);
          setApprovalPending(false);
          void loadSessions();
          finish("complete");
        } else if (trace.type === "error") {
          setError(
            String(trace.data.display_message ?? "The research run failed"),
          );
          setApprovalPending(false);
          finish("error");
        } else if (trace.type === "cancelled") {
          setApprovalPending(false);
          finish("cancelled");
        }
      };
      stream.onerror = () => {
        if (terminal) return;
        setError("The activity stream was interrupted.");
        finish("error");
      };
    } catch (caught) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setStatus("error");
      setApprovalPending(false);
      setError(caught instanceof Error ? caught.message : "Request failed");
    }
  }

  async function decideSampling(decision: SamplingDecision) {
    if (!runId) return;
    const response = await fetch(`/api/runs/${runId}/sampling`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (response.ok) {
      setApprovalPending(false);
      if (decision === "approve_always") setAutoApproveSampling(true);
    }
  }

  async function cancelRun() {
    if (!runId) return;
    const response = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
    if (!response.ok) return;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setStatus("cancelled");
    setApprovalPending(false);
    setAutoApproveSampling(false);
  }

  async function selectSession(sessionId: string) {
    const response = await fetch(`/api/sessions/${sessionId}`);
    if (!response.ok) return;
    const payload = (await response.json()) as { session: SessionDetail };
    const turn = payload.session.turns?.at(-1);
    if (!turn) return;

    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setRunId(turn.id);
    setQuery(turn.query);
    setActiveQuestion(turn.query);
    setStatus(turnStatusToRunStatus(turn));
    setResult(turnToResult(turn));
    setError(turn.errorMessage ?? "");
    setApprovalPending(false);
    setAutoApproveSampling(false);
    setSelectedEvent(null);
    setEventDetail(null);

    const eventsResponse = await fetch(`/api/runs/${turn.id}/events`);
    if (eventsResponse.ok) setEvents(parseSseEvents(await eventsResponse.text()));
  }

  async function selectTraceEvent(event: TraceEvent) {
    setSelectedEvent(event);
    setEventDetail(null);
    if (!runId) return;
    const response = await fetch(
      `/api/runs/${runId}/events/${event.sequence}/detail`,
    );
    if (response.ok) {
      const payload = (await response.json()) as { detail: Record<string, unknown> };
      setEventDetail(payload.detail);
    }
  }

  const isRunning = status === "running";

  return (
    <main className="min-h-[100dvh] bg-stone-100 text-zinc-900">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1600px] flex-col px-4 py-4 md:px-6 md:py-6">
        <header className="flex items-center justify-between border-b border-zinc-300 pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-zinc-900 text-stone-50">
              <FlowArrow size={19} weight="bold" />
            </div>
            <div>
              <p className="text-[13px] font-semibold tracking-[-0.01em]">
                Secure MCP Research
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Local ideation console
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            <span
              className={`size-1.5 rounded-full ${
                isRunning ? "animate-pulse bg-amber-600" : "bg-emerald-700"
              }`}
            />
            {isRunning ? "Run active" : "Local boundary ready"}
          </div>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-0 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
          <aside className="border-b border-zinc-300 py-6 lg:border-r lg:border-b-0 lg:pr-6">
            <p className="eyebrow">Data boundary</p>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-1">
              <BoundaryItem
                icon={<FileLock size={17} />}
                label="Knowledge"
                value={runtimeConfig.knowledge}
              />
              <BoundaryItem
                icon={<Brain size={17} />}
                label="Inference"
                value={runtimeConfig.inference}
              />
              <BoundaryItem
                icon={<TerminalWindow size={17} />}
                label="Transport"
                value={runtimeConfig.transport}
              />
              <BoundaryItem
                icon={<Database size={17} />}
                label="Audit"
                value={runtimeConfig.audit}
              />
            </div>

            <div className="mt-8 border-t border-zinc-300 pt-5">
              <p className="eyebrow">Run stats</p>
              <dl className="mt-4 grid grid-cols-3 gap-3 lg:grid-cols-1">
                <Metric label="Events" value={String(events.length)} />
                <Metric
                  label="Sources"
                  value={String(result?.sources.length ?? 0)}
                />
                <Metric label="Elapsed" value={duration} />
                <Metric
                  label="Tokens"
                  value={`${tokenMetrics.promptTokens}/${tokenMetrics.outputTokens}`}
                />
              </dl>
            </div>

            <div className="mt-8 border-t border-zinc-300 pt-5">
              <p className="eyebrow">Sessions</p>
              <div className="mt-3 space-y-1">
                {sessions.length === 0 ? (
                  <p className="text-xs leading-5 text-zinc-500">No persisted turns yet.</p>
                ) : (
                  sessions.slice(0, 8).map((session) => (
                    <button
                      key={session.id}
                      onClick={() => void selectSession(session.id)}
                      className="block w-full truncate rounded-md px-2 py-2 text-left text-xs text-zinc-600 transition-colors duration-150 hover:bg-zinc-200 hover:text-zinc-950"
                    >
                      {session.title}
                    </button>
                  ))
                )}
              </div>
            </div>
          </aside>

          <section className="min-w-0 py-7 lg:px-9">
            <div className="mx-auto flex h-full max-w-3xl flex-col">
              <div>
                <p className="eyebrow">MCP practice chat</p>
                <h1 className="mt-3 max-w-xl text-3xl font-semibold tracking-[-0.04em] text-zinc-950 md:text-4xl">
                  Practice secure client/server AI loops.
                </h1>
                <p className="mt-3 max-w-[58ch] text-sm leading-6 text-zinc-600">
                  Ideate and test MCP roots, sampling approvals, local inference,
                  citation checks, and agent harness behavior in one local chat.
                </p>
              </div>

              <form className="mt-8" onSubmit={startRun}>
                <label
                  className="mb-2 block text-xs font-medium text-zinc-700"
                  htmlFor="research-query"
                >
                  Research question
                </label>
                <div className="relative">
                  <textarea
                    id="research-query"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    disabled={isRunning}
                    rows={4}
                    placeholder="Ask a standalone question about the approved CS230 notes..."
                    className="w-full resize-none rounded-xl border border-zinc-300 bg-stone-50 px-4 py-3.5 pr-14 text-[15px] leading-6 text-zinc-900 outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-zinc-400 focus:border-amber-700 focus:ring-3 focus:ring-amber-700/10 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={isRunning || query.trim().length < 3}
                    aria-label="Start research"
                    className="absolute right-3 bottom-3 grid size-9 place-items-center rounded-lg bg-zinc-900 text-stone-50 transition-[transform,background-color] duration-150 hover:bg-zinc-800 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-zinc-300"
                  >
                    {isRunning ? (
                      <CircleNotch className="animate-spin" size={17} />
                    ) : (
                      <ArrowUp size={17} weight="bold" />
                    )}
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>Stateless run · approved evidence only</span>
                  <span className="font-mono">Enter · Shift Enter newline</span>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    checked={thinking}
                    disabled={isRunning}
                    onChange={(event) => setThinking(event.target.checked)}
                    className="size-3.5 accent-zinc-900"
                  />
                  Request model thinking if the local model supports it
                </label>
              </form>

              <ChatThread
                activeQuestion={activeQuestion}
                status={status}
                result={result}
                error={error}
                approvalPending={approvalPending}
                autoApproveSampling={autoApproveSampling}
                onApproveOnce={() => void decideSampling("approve")}
                onApproveAlways={() => void decideSampling("approve_always")}
                onDeny={() => void decideSampling("deny")}
                onCancel={cancelRun}
                onPickQuestion={setQuery}
              />
            </div>
          </section>

          <aside className="border-t border-zinc-300 py-6 lg:border-t-0 lg:border-l lg:pl-6">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Protocol trace</p>
              <span className="font-mono text-[10px] text-zinc-500">
                {events.length.toString().padStart(2, "0")} events
              </span>
            </div>
            <div className="mt-5 max-h-[620px] overflow-y-auto pr-2 lg:max-h-[calc(100dvh-140px)]">
              {events.length === 0 ? (
                <div className="border-l border-dashed border-zinc-300 py-2 pl-5 text-sm leading-6 text-zinc-500">
                  Sampling, roots, retrieval, progress, and validation events
                  will appear here.
                </div>
              ) : (
                <ol className="space-y-0">
                  {events.map((event) => (
                    <TraceRow
                      key={event.sequence}
                      event={event}
                      selected={selectedEvent?.sequence === event.sequence}
                      onSelect={() => void selectTraceEvent(event)}
                    />
                  ))}
                </ol>
              )}
            </div>
            {selectedEvent && (
              <TraceDetail event={selectedEvent} detail={eventDetail} />
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

function isTrivialGreetingQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase().replace(/[!?.]+$/g, "");
  return TRIVIAL_GREETING_QUERY_RE.test(normalized);
}

function BoundaryItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-zinc-500">{icon}</span>
      <div>
        <p className="text-[11px] text-zinc-500">{label}</p>
        <p className="mt-0.5 text-[13px] font-medium text-zinc-800">{value}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 lg:border-b lg:border-zinc-300 lg:pb-2">
      <dt className="text-[11px] text-zinc-500">{label}</dt>
      <dd className="font-mono text-sm font-medium text-zinc-800">{value}</dd>
    </div>
  );
}

function ChatThread({
  activeQuestion,
  status,
  result,
  error,
  approvalPending,
  autoApproveSampling,
  onApproveOnce,
  onApproveAlways,
  onDeny,
  onCancel,
  onPickQuestion,
}: {
  activeQuestion: string;
  status: RunStatus;
  result: ResearchResult | null;
  error: string;
  approvalPending: boolean;
  autoApproveSampling: boolean;
  onApproveOnce: () => void;
  onApproveAlways: () => void;
  onDeny: () => void;
  onCancel: () => void;
  onPickQuestion: (question: string) => void;
}) {
  const idle = status === "idle" && !activeQuestion;
  return (
    <div className="mt-8 rounded-[1.35rem] border border-zinc-300 bg-stone-50/80 p-4 shadow-[0_18px_45px_-34px_rgba(39,39,42,0.35)] md:p-5">
      {idle ? (
        <div className="py-3">
          <p className="eyebrow">Practice queue</p>
          <p className="mt-3 max-w-[54ch] text-sm leading-6 text-zinc-600">
            Start a chat turn to watch roots, retrieval, sampling approval,
            inference, citation validation, and persisted audit events move across
            the MCP boundary.
          </p>
          <div className="mt-5 divide-y divide-zinc-300">
            {SUGGESTED_QUESTIONS.map((question) => (
              <button
                key={question}
                onClick={() => onPickQuestion(question)}
                className="group flex w-full items-center justify-between gap-4 py-3 text-left text-sm text-zinc-600 transition-colors duration-150 hover:text-zinc-950 active:translate-y-px"
              >
                <span>{question}</span>
                <ArrowUp
                  className="rotate-45 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  size={15}
                />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {activeQuestion && (
            <ChatBubble label="You" align="right">
              <p className="whitespace-pre-wrap text-sm leading-6">{activeQuestion}</p>
            </ChatBubble>
          )}

          <ChatBubble label="MCP host" align="left">
            {approvalPending ? (
              <ApprovalCard
                onApproveOnce={onApproveOnce}
                onApproveAlways={onApproveAlways}
                onDeny={onDeny}
              />
            ) : autoApproveSampling && status === "running" ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3 text-sm text-emerald-900">
                  <CheckCircle className="mt-0.5 shrink-0" size={18} weight="fill" />
                  <div>
                    <p className="font-medium">Auto-approving sampling for this run</p>
                    <p className="mt-1 leading-6 text-emerald-800">
                      Future client-side sampling requests in this run will proceed
                      without another prompt.
                    </p>
                  </div>
                </div>
                <LoadingAnswer onCancel={onCancel} />
              </div>
            ) : status === "running" ? (
              <LoadingAnswer onCancel={onCancel} />
            ) : status === "cancelled" ? (
              <div className="flex items-center gap-3 text-sm text-zinc-700">
                <Prohibit size={18} />
                The run was cancelled. No answer was persisted.
              </div>
            ) : error ? (
              <div className="flex items-start gap-3 text-sm text-red-900">
                <WarningCircle className="mt-0.5 shrink-0" size={18} />
                <div>
                  <p className="font-medium">Run failed</p>
                  <p className="mt-1 text-red-800">{error}</p>
                </div>
              </div>
            ) : result ? (
              <Answer result={result} />
            ) : (
              <p className="text-sm leading-6 text-zinc-500">
                Waiting for the next MCP event.
              </p>
            )}
          </ChatBubble>
        </div>
      )}
    </div>
  );
}

function ChatBubble({
  label,
  align,
  children,
}: {
  label: string;
  align: "left" | "right";
  children: React.ReactNode;
}) {
  const right = align === "right";
  return (
    <div className={`flex ${right ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] ${right ? "text-right" : "text-left"}`}>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          {label}
        </p>
        <div
          className={`rounded-2xl px-4 py-3 ${
            right
              ? "rounded-tr-sm bg-zinc-900 text-stone-50"
              : "rounded-tl-sm border border-zinc-300 bg-white text-zinc-800"
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function LoadingAnswer({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="animate-enter">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CircleNotch className="animate-spin text-amber-700" size={17} />
          Evaluating approved evidence
        </div>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-600 transition-[transform,color,background-color] duration-150 hover:bg-zinc-200 hover:text-zinc-950 active:scale-[0.97]"
        >
          <Stop size={13} weight="fill" />
          Cancel
        </button>
      </div>
      <div className="mt-5 space-y-3" aria-label="Loading answer">
        <div className="skeleton h-3 w-[88%]" />
        <div className="skeleton h-3 w-full" />
        <div className="skeleton h-3 w-[72%]" />
      </div>
    </div>
  );
}

function ApprovalCard({
  onApproveOnce,
  onApproveAlways,
  onDeny,
}: {
  onApproveOnce: () => void;
  onApproveAlways: () => void;
  onDeny: () => void;
}) {
  return (
    <div className="animate-enter text-sm text-zinc-800">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-medium text-amber-950">Sampling approval required</p>
          <p className="mt-1 leading-6 text-amber-900">
            The server retrieved evidence and is asking the client-side model to
            produce a grounded answer. Choose how this run should handle model
            calls.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            onClick={onDeny}
            className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-950 transition-colors duration-150 hover:bg-amber-100"
          >
            Deny
          </button>
          <button
            onClick={onApproveOnce}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-800 transition-colors duration-150 hover:bg-zinc-100"
          >
            Allow once
          </button>
          <button
            onClick={onApproveAlways}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-stone-50 transition-colors duration-150 hover:bg-zinc-800"
          >
            Always allow
          </button>
        </div>
      </div>
    </div>
  );
}

function Answer({ result }: { result: ResearchResult }) {
  const statusTone =
    result.status === "answered"
      ? "text-emerald-800"
      : result.status === "error"
        ? "text-red-800"
        : "text-amber-800";
  return (
    <article className="animate-enter">
      <div className="flex items-center justify-between gap-4">
        <div className={`flex items-center gap-2 text-xs font-medium ${statusTone}`}>
          {result.citation_valid ? (
            <ShieldCheck size={17} weight="fill" />
          ) : (
            <WarningCircle size={17} />
          )}
          {result.status === "answered"
            ? "Grounded response"
            : result.status === "error"
              ? "Response withheld"
              : "Insufficient evidence"}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          {result.cited_source_ids.join(" · ") || "No citations"}
        </span>
      </div>
      <div className="mt-5 whitespace-pre-wrap text-[15px] leading-7 text-zinc-800">
        <CitedText text={result.answer} />
      </div>
      <div className="mt-5 border-l border-zinc-300 pl-4">
        <p className="eyebrow">Evidence rationale</p>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          {result.rationale}
        </p>
      </div>

      {result.sources.length > 0 && (
        <div className="mt-8">
          <p className="eyebrow">Approved sources</p>
          <div className="mt-3 divide-y divide-zinc-300 border-y border-zinc-300">
            {result.sources.map((source) => (
              <a
                key={source.source_id}
                href={source.page_url}
                target="_blank"
                rel="noreferrer"
                className="group grid gap-2 py-4 transition-colors duration-150 hover:bg-stone-50 md:grid-cols-[44px_1fr_18px]"
              >
                <span className="font-mono text-xs font-semibold text-amber-800">
                  {source.source_id}
                </span>
                <span>
                  <span className="block text-sm font-medium text-zinc-800">
                    {source.page_title}
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500">
                    {source.heading_path.join(" › ") || "Page overview"}
                  </span>
                  <span className="mt-2 block text-[13px] leading-5 text-zinc-600">
                    {source.excerpt}
                  </span>
                </span>
                <ArrowSquareOut
                  className="mt-0.5 text-zinc-400 transition-colors duration-150 group-hover:text-zinc-800"
                  size={15}
                />
              </a>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function CitedText({ text }: { text: string }) {
  return text.split(/(\[S\d+\])/g).map((part, index) =>
    /^\[S\d+\]$/.test(part) ? (
      <span
        key={`${part}-${index}`}
        className="mx-0.5 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-900"
      >
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function TraceRow({
  event,
  selected,
  onSelect,
}: {
  event: TraceEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const isComplete = event.type === "result";
  const isError = event.type === "error";
  const isCancelled = event.type === "cancelled" || event.level === "warning";
  return (
    <li
      className={`animate-trace grid grid-cols-[20px_1fr] gap-3 border-l pb-5 pl-4 last:pb-0 ${
        selected ? "border-amber-700" : "border-zinc-300"
      }`}
      style={{ animationDelay: `${Math.min(event.sequence * 24, 180)}ms` }}
    >
      <span className="-ml-[25px] grid size-5 place-items-center rounded-full bg-stone-100 text-zinc-500">
        {isComplete ? (
          <CheckCircle className="text-emerald-700" size={14} weight="fill" />
        ) : isError ? (
          <WarningCircle className="text-red-700" size={14} />
        ) : isCancelled ? (
          <Prohibit className="text-amber-700" size={14} />
        ) : (
          <span className="size-1.5 rounded-full bg-zinc-500" />
        )}
      </span>
      <button className="-mt-0.5 min-w-0 text-left" onClick={onSelect}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
            {event.stage}
          </span>
          <span className="font-mono text-[9px] text-zinc-400">
            {event.sequence.toString().padStart(2, "0")}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-zinc-700">
          {event.message}
        </p>
        {typeof event.data.percentage === "number" && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full bg-amber-700 transition-transform duration-200 [transform-origin:left]"
              style={{
                transform: `scaleX(${Number(event.data.percentage) / 100})`,
              }}
            />
          </div>
        )}
      </button>
    </li>
  );
}

function TraceDetail({
  event,
  detail,
}: {
  event: TraceEvent;
  detail: Record<string, unknown> | null;
}) {
  return (
    <div className="mt-5 border-t border-zinc-300 pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">Event details</p>
        <span className="font-mono text-[10px] text-zinc-500">
          #{event.sequence.toString().padStart(2, "0")}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        Protected prompts, excerpts, and raw protocol payloads are masked from
        persisted history.
      </p>
      <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-zinc-900 p-3 text-[11px] leading-5 text-stone-100">
        {JSON.stringify(detail ?? event.data, null, 2)}
      </pre>
    </div>
  );
}

function turnStatusToRunStatus(turn: SessionTurn): RunStatus {
  if (turn.status === "complete") return "complete";
  if (turn.status === "cancelled") return "cancelled";
  if (turn.status === "error" || turn.status === "interrupted") return "error";
  return "idle";
}

function turnToResult(turn: SessionTurn): ResearchResult | null {
  if (!turn.answer) return null;
  return {
    status: turn.status === "error" ? "error" : "answered",
    answer: turn.answer,
    rationale: turn.rationale ?? "",
    cited_source_ids: turn.citations.map((source) => source.sourceId),
    citation_valid: true,
    sources: turn.citations.map((source) => ({
      source_id: source.sourceId,
      page_id: source.pageId,
      page_title: source.pageTitle,
      page_url: source.pageUrl,
      heading_path: source.headingPath,
      block_ids: source.blockIds,
      score: source.score,
      excerpt: source.excerpt,
    })),
  };
}

function parseSseEvents(text: string): TraceEvent[] {
  return text
    .split("\n\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as TraceEvent);
}

export default App;
