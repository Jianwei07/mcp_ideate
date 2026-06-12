import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { SessionStore } from "../src/persistence/store.ts";
import { MetadataAudit } from "../src/runs/audit.ts";
import { formatTerminalEvent, TranscriptRecorder } from "../src/runs/transcript.ts";

describe("session persistence", () => {
  test("session history and citations survive restart without protected excerpts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "secure-research-store-"));
    const databasePath = join(directory, "research.db");

    try {
      const store = new SessionStore(databasePath);
      const session = store.createSession("What should teams monitor?");
      const turn = store.createTurn({
        sessionId: session.id,
        query: "What should teams monitor?",
        model: "test-model",
        thinkingRequested: false,
        thinkingSupported: false,
        contextTokens: 8192,
      });
      store.updateTurn(turn.id, {
        status: "complete",
        answer: "Monitor loss [S1].",
        rationale: "Approved source names it.",
      });
      store.replaceCitations(turn.id, [
        {
          sourceId: "S1",
          pageId: "page-1",
          pageTitle: "Monitoring",
          pageUrl: "https://notion.example/page-1",
          headingPath: ["Monitoring"],
          blockIds: ["block-1"],
          score: 1,
          excerpt: "PROTECTED NOTION EXCERPT",
        },
      ]);
      store.close();

      const restarted = new SessionStore(databasePath);
      const restored = restarted.getSession(session.id);

      expect(restored?.turns?.[0].status).toBe("complete");
      expect(restored?.turns?.[0].citations[0]).toMatchObject({
        sourceId: "S1",
        pageTitle: "Monitoring",
        excerpt: "",
      });
      restarted.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("recovery only interrupts non-terminal turns", async () => {
    const directory = await mkdtemp(join(tmpdir(), "secure-research-recovery-"));
    const databasePath = join(directory, "research.db");

    try {
      const store = new SessionStore(databasePath);
      const session = store.createSession("Recovery");
      const complete = store.createTurn({
        sessionId: session.id,
        query: "Complete turn",
        model: "test-model",
        thinkingRequested: false,
        thinkingSupported: false,
        contextTokens: 8192,
      });
      const running = store.createTurn({
        sessionId: session.id,
        query: "Running turn",
        model: "test-model",
        thinkingRequested: false,
        thinkingSupported: false,
        contextTokens: 8192,
      });
      store.updateTurn(complete.id, { status: "complete" });
      store.updateTurn(running.id, { status: "running" });
      store.close();

      const restarted = new SessionStore(databasePath);

      expect(restarted.getTurn(complete.id)?.status).toBe("complete");
      expect(restarted.getTurn(running.id)?.status).toBe("interrupted");
      restarted.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("audit and SQLite omit volatile details", async () => {
    const directory = await mkdtemp(join(tmpdir(), "secure-research-audit-"));

    try {
      const store = new SessionStore(join(directory, "research.db"));
      const session = store.createSession("Audit");
      const turn = store.createTurn({
        sessionId: session.id,
        query: "Audit turn",
        model: "test-model",
        thinkingRequested: false,
        thinkingSupported: false,
        contextTokens: 8192,
      });
      const recorder = new TranscriptRecorder(
        turn.id,
        store,
        new MetadataAudit(join(directory, "audit")),
      );

      await recorder.record(
        {
          channel: "mcp",
          origin: "mcp-connection",
          direction: "client_to_server",
          kind: "request",
          method: "tools/call",
          requestId: "1",
          parentRequestId: null,
          level: "debug",
          status: "running",
          summary: "client_to_server tools/call",
          durationMs: null,
          metadata: { method: "tools/call" },
        },
        { protectedPayload: "PROTECTED RAW PAYLOAD" },
      );

      const audit = await readFile(
        join(directory, "audit", "research-audit.jsonl"),
        "utf8",
      );
      const events = store.listEvents(turn.id);

      expect(audit).not.toContain("PROTECTED RAW PAYLOAD");
      expect(JSON.stringify(events)).not.toContain("PROTECTED RAW PAYLOAD");
      expect(recorder.detail(1)).toEqual({ protectedPayload: "PROTECTED RAW PAYLOAD" });
      store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("terminal transcript formatter omits volatile details", () => {
    const line = formatTerminalEvent({
      id: "event-1",
      turnId: "turn-1",
      sequence: 1,
      timestamp: "2026-01-01T00:00:00.000Z",
      channel: "mcp",
      origin: "mcp-connection",
      direction: "client_to_server",
      kind: "request",
      method: "tools/call",
      requestId: "1",
      parentRequestId: null,
      level: "debug",
      status: "running",
      summary: "client_to_server tools/call",
      durationMs: null,
      metadata: { method: "tools/call" },
      detailAvailable: true,
    });

    expect(line).toContain("run=turn-1");
    expect(line).toContain("method=tools/call");
    expect(line).toContain('metadata={"method":"tools/call"}');
    expect(line).not.toContain("PROTECTED RAW PAYLOAD");
  });
});
