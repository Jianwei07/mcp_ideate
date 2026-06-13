import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { TranscriptEvent } from "@secure-research/contracts";

export class MetadataAudit {
  private readonly path: string;

  constructor(
    directory: string,
    private readonly maxBytes = 5 * 1024 * 1024,
    private readonly backups = 3,
  ) {
    this.path = join(directory, "research-audit.jsonl");
    void mkdir(directory, { recursive: true });
  }

  async append(event: TranscriptEvent): Promise<void> {
    const record = {
      timestamp: event.timestamp,
      turnId: event.turnId,
      sequence: event.sequence,
      channel: event.channel,
      origin: event.origin,
      direction: event.direction,
      kind: event.kind,
      method: event.method,
      requestId: event.requestId,
      parentRequestId: event.parentRequestId,
      level: event.level,
      status: event.status,
      summary: event.summary,
      durationMs: event.durationMs,
      metadata: event.metadata,
    };
    const line = `${JSON.stringify(record)}\n`;
    await this.rotateIfNeeded(Buffer.byteLength(line));
    await appendFile(this.path, line, { encoding: "utf8" });
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    try {
      const current = await stat(this.path);
      if (current.size + incomingBytes <= this.maxBytes) return;
    } catch {
      return;
    }

    const oldest = `${this.path}.${this.backups}`;
    await unlink(oldest).catch(() => undefined);
    for (let index = this.backups - 1; index >= 1; index -= 1) {
      await rename(`${this.path}.${index}`, `${this.path}.${index + 1}`).catch(
        () => undefined,
      );
    }
    await rename(this.path, `${this.path}.1`);
  }
}
