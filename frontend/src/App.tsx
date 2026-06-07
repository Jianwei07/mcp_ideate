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
import type { ResearchResult, TraceEvent } from "./types";

const SUGGESTED_QUESTIONS = [
  "What is the disciplined process for developing an ML project?",
  "How do supervised and self-supervised learning differ?",
  "What signals should teams monitor during model development?",
];

type RunStatus = "idle" | "running" | "complete" | "error" | "cancelled";

function App() {
  const [query, setQuery] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);

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

  async function startRun(event: FormEvent) {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (cleanQuery.length < 3 || status === "running") return;

    eventSourceRef.current?.close();
    setEvents([]);
    setResult(null);
    setError("");
    setStatus("running");

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: cleanQuery }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? "Unable to start the research run");
      }

      setRunId(payload.run_id);
      const stream = new EventSource(payload.events_url);
      eventSourceRef.current = stream;
      stream.onmessage = (message) => {
        const trace = JSON.parse(message.data) as TraceEvent;
        setEvents((current) => [...current, trace]);
        if (trace.type === "result") {
          setResult(trace.data.result as ResearchResult);
          setStatus("complete");
          stream.close();
        } else if (trace.type === "error") {
          setError(
            String(trace.data.display_message ?? "The research run failed"),
          );
          setStatus("error");
          stream.close();
        } else if (trace.type === "cancelled") {
          setStatus("cancelled");
          stream.close();
        }
      };
      stream.onerror = () => {
        if (stream.readyState === EventSource.CLOSED) return;
        setError("The activity stream was interrupted.");
        setStatus("error");
        stream.close();
      };
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Request failed");
    }
  }

  async function cancelRun() {
    if (!runId) return;
    await fetch(`/api/runs/${runId}`, { method: "DELETE" });
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
                value="CS230 page tree"
              />
              <BoundaryItem
                icon={<Brain size={17} />}
                label="Inference"
                value="Gemma 4 · local"
              />
              <BoundaryItem
                icon={<TerminalWindow size={17} />}
                label="Transport"
                value="MCP stdio"
              />
              <BoundaryItem
                icon={<Database size={17} />}
                label="Audit"
                value="Metadata only"
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
              </dl>
            </div>
          </aside>

          <section className="min-w-0 py-7 lg:px-9">
            <div className="mx-auto flex h-full max-w-3xl flex-col">
              <div>
                <p className="eyebrow">Approved research</p>
                <h1 className="mt-3 max-w-xl text-3xl font-semibold tracking-[-0.04em] text-zinc-950 md:text-4xl">
                  Test the MCP path against secured notes.
                </h1>
                <p className="mt-3 max-w-[58ch] text-sm leading-6 text-zinc-600">
                  The server retrieves evidence. The client performs local
                  inference. Every answer must resolve to an approved source.
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
                      if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                      ) {
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
                  <span className="font-mono">⌘ Enter</span>
                </div>
              </form>

              {status === "idle" && (
                <div className="mt-10 border-t border-zinc-300 pt-6">
                  <p className="eyebrow">Evaluation prompts</p>
                  <div className="mt-3 divide-y divide-zinc-300">
                    {SUGGESTED_QUESTIONS.map((question) => (
                      <button
                        key={question}
                        onClick={() => setQuery(question)}
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
              )}

              {isRunning && <LoadingAnswer onCancel={cancelRun} />}

              {error && (
                <div className="mt-8 flex items-start gap-3 border-l-2 border-red-700 bg-red-50 px-4 py-3 text-sm text-red-900">
                  <WarningCircle className="mt-0.5 shrink-0" size={18} />
                  <div>
                    <p className="font-medium">Run failed</p>
                    <p className="mt-1 text-red-800">{error}</p>
                  </div>
                </div>
              )}

              {status === "cancelled" && (
                <div className="mt-8 flex items-center gap-3 border-l-2 border-amber-700 px-4 py-3 text-sm text-zinc-700">
                  <Prohibit size={18} />
                  The run was cancelled. No answer was persisted.
                </div>
              )}

              {result && <Answer result={result} />}
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
                    <TraceRow key={event.sequence} event={event} />
                  ))}
                </ol>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
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

function LoadingAnswer({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="mt-9 animate-enter border-t border-zinc-300 pt-6">
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

function Answer({ result }: { result: ResearchResult }) {
  const statusTone =
    result.status === "answered"
      ? "text-emerald-800"
      : result.status === "error"
        ? "text-red-800"
        : "text-amber-800";
  return (
    <article className="mt-9 animate-enter border-t border-zinc-300 pt-6">
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

function TraceRow({ event }: { event: TraceEvent }) {
  const isComplete = event.type === "result";
  const isError = event.type === "error";
  return (
    <li
      className="animate-trace grid grid-cols-[20px_1fr] gap-3 border-l border-zinc-300 pb-5 pl-4 last:pb-0"
      style={{ animationDelay: `${Math.min(event.sequence * 24, 180)}ms` }}
    >
      <span className="-ml-[25px] grid size-5 place-items-center rounded-full bg-stone-100 text-zinc-500">
        {isComplete ? (
          <CheckCircle className="text-emerald-700" size={14} weight="fill" />
        ) : isError ? (
          <WarningCircle className="text-red-700" size={14} />
        ) : (
          <span className="size-1.5 rounded-full bg-zinc-500" />
        )}
      </span>
      <div className="-mt-0.5 min-w-0">
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
      </div>
    </li>
  );
}

export default App;
