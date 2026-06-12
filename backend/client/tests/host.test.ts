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
  const sessions = (await (await fetch(`${baseUrl}/api/sessions`)).json()) as {
    sessions: Array<{ id: string }>;
  };
  for (const session of sessions.sessions) {
    const restored = (await (
      await fetch(`${baseUrl}/api/sessions/${session.id}`)
    ).json()) as { session: { turns?: Array<{ id: string; status: string }> } };
    const turn = restored.session.turns?.find((item) => item.id === turnId);
    if (turn) return turn.status;
  }
  return null;
}
