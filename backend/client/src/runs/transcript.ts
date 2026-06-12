import type {
  TranscriptEvent,
  TranscriptEvent as StoredEvent,
} from "@secure-research/contracts";
import type { SessionStore } from "../persistence/store.ts";
import type { MetadataAudit } from "./audit.ts";

type EventInput = Omit<
  TranscriptEvent,
  "id" | "turnId" | "sequence" | "timestamp" | "detailAvailable"
>;

export class TranscriptRecorder {
  private sequence: number;
  private readonly details = new Map<number, unknown>();
  private readonly listeners = new Set<(event: TranscriptEvent) => void>();

  constructor(
    readonly turnId: string,
    private readonly store: SessionStore,
    private readonly audit: MetadataAudit,
  ) {
    this.sequence = store.nextSequence(turnId);
  }

  async record(input: EventInput, detail?: unknown): Promise<StoredEvent> {
    const event: TranscriptEvent = {
      ...input,
      id: crypto.randomUUID(),
      turnId: this.turnId,
      sequence: this.sequence,
      timestamp: new Date().toISOString(),
      detailAvailable: detail !== undefined,
    };
    this.sequence += 1;
    this.store.appendEvent(event);
    if (detail !== undefined) this.details.set(event.sequence, detail);
    await this.audit.append(event);
    mirrorToTerminal(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  detail(sequence: number): unknown | null {
    return this.details.get(sequence) ?? null;
  }

  subscribe(listener: (event: TranscriptEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clearVolatileDetails(): void {
    this.details.clear();
  }
}

export function formatTerminalEvent(event: TranscriptEvent): string {
  const method = event.method ? ` method=${event.method}` : "";
  const requestId = event.requestId ? ` request=${event.requestId}` : "";
  const duration = event.durationMs === null ? "" : ` duration=${event.durationMs}ms`;
  const metadata =
    Object.keys(event.metadata).length === 0
      ? ""
      : ` metadata=${JSON.stringify(event.metadata)}`;
  return `[secure-research] run=${event.turnId} seq=${event.sequence} channel=${event.channel} origin=${event.origin} direction=${event.direction} kind=${event.kind}${method}${requestId} level=${event.level} status=${event.status}${duration} ${event.summary}${metadata}`;
}

function mirrorToTerminal(event: TranscriptEvent): void {
  if (process.env.TRANSCRIPT_TERMINAL === "0") return;
  const line = formatTerminalEvent(event);
  if (event.level === "error") console.error(line);
  else if (event.level === "warning") console.warn(line);
  else console.log(line);
}
