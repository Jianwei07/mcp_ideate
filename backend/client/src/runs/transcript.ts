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
