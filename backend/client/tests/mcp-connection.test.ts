import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import { McpConnection, type McpConnectionEvent } from "../src/mcp/connection.ts";
import type { SamplingApprovalDecision } from "../src/runs/approval.ts";

describe("McpConnection", () => {
  test("traces JSON-RPC and delegates sampling to the client model", async () => {
    const directory = await mkdtemp(join(tmpdir(), "secure-research-mcp-"));
    const events: McpConnectionEvent[] = [];
    const samples: unknown[] = [];
    const transport = new FakeServerTransport();
    const connection = new McpConnection({
      config: { serverEntry: "server/src/index.ts", serverEnvFile: null },
      cacheRootPath: join(directory, "cache"),
      transport,
      ollama: {
        model: "fake-model",
        async sample(params) {
          samples.push(params);
          return {
            content: JSON.stringify({
              status: "answered",
              answer: "Monitor loss and data quality [S1].",
              rationale: "The approved source names both signals.",
            }),
            thinking: null,
            usage: {
              promptTokens: 11,
              outputTokens: 7,
              totalDurationMs: 25,
              loadDurationMs: 0,
              promptEvalDurationMs: 10,
              evalDurationMs: 15,
            },
          };
        },
      },
      emit(event) {
        events.push(event);
      },
    });

    try {
      await connection.connect();
      const result = await connection.callResearch("What should teams monitor?");

      expect(result.status).toBe("answered");
      expect(result.citationValid).toBe(true);
      expect(result.citedSourceIds).toEqual(["S1"]);
      expect(samples).toHaveLength(1);
      expect(transport.rootUri).toStartWith("file:");

      expect(eventMethods(events)).toContain("initialize");
      expect(eventMethods(events)).toContain("tools/call");
      expect(eventMethods(events)).toContain("roots/list");
      expect(eventMethods(events)).toContain("sampling/createMessage");
      expect(eventMethods(events)).toContain("notifications/message");
      expect(
        events.some((event) => event.summary === "Returned approved cache root"),
      ).toBe(true);
      expect(events.some((event) => event.kind === "progress")).toBe(true);
    } finally {
      await connection.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("waits for explicit approval before sampling", async () => {
    const directory = await mkdtemp(join(tmpdir(), "secure-research-approval-"));
    const transport = new FakeServerTransport();
    const samples: unknown[] = [];
    let approve: (decision: SamplingApprovalDecision) => void = () => undefined;
    const connection = new McpConnection({
      config: { serverEntry: "server/src/index.ts", serverEnvFile: null },
      cacheRootPath: join(directory, "cache"),
      transport,
      approveSampling: () =>
        new Promise((resolve) => {
          approve = resolve;
        }),
      ollama: {
        model: "fake-model",
        async sample(params) {
          samples.push(params);
          return fakeSample();
        },
      },
    });

    try {
      await connection.connect();
      const resultPromise = connection.callResearch("What should teams monitor?");
      await waitFor(() => transport.samplingRequested);

      expect(samples).toHaveLength(0);
      approve("approve");
      const result = await resultPromise;

      expect(result.status).toBe("answered");
      expect(samples).toHaveLength(1);
    } finally {
      await connection.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("calls the real stdio server and serves client-side sampling", async () => {
    const directory = await mkdtemp(join(tmpdir(), "secure-research-stdio-"));
    const notion = fakeNotionServer();
    const previousEnv = {
      NOTION_TOKEN: process.env.NOTION_TOKEN,
      NOTION_ROOT_PAGE_ID: process.env.NOTION_ROOT_PAGE_ID,
      NOTION_BASE_URL: process.env.NOTION_BASE_URL,
      NOTION_MAX_PAGES: process.env.NOTION_MAX_PAGES,
      NOTION_MAX_BLOCKS: process.env.NOTION_MAX_BLOCKS,
    };
    process.env.NOTION_TOKEN = "test-token";
    process.env.NOTION_ROOT_PAGE_ID = "rootpage";
    process.env.NOTION_BASE_URL = `http://${notion.hostname}:${notion.port}`;
    process.env.NOTION_MAX_PAGES = "3";
    process.env.NOTION_MAX_BLOCKS = "20";

    const samples: unknown[] = [];
    const events: McpConnectionEvent[] = [];
    const connection = new McpConnection({
      config: {
        serverEntry: join(process.cwd(), "server/src/index.ts"),
        serverEnvFile: null,
      },
      cacheRootPath: join(directory, "cache"),
      approveSampling: async () => "approve",
      ollama: {
        model: "fake-model",
        async sample(params) {
          samples.push(params);
          return fakeSample();
        },
      },
      emit(event) {
        events.push(event);
      },
    });

    try {
      await connection.connect();
      const result = await connection.callResearch("What should teams monitor?");

      expect(result.status).toBe("answered");
      expect(result.sources[0].pageTitle).toBe("Monitoring");
      expect(samples).toHaveLength(1);
      expect(eventMethods(events)).toContain("sampling/createMessage");
      expect(eventMethods(events)).toContain("roots/list");
    } finally {
      await connection.close();
      notion.stop(true);
      restoreEnv(previousEnv);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

class FakeServerTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport["onmessage"];
  rootUri = "";
  samplingRequested = false;

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if (!("method" in message)) {
      this.handleClientResponse(message);
      return;
    }
    if (message.method === "initialize" && "id" in message) {
      this.receive({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {}, logging: {} },
          serverInfo: { name: "fake-secure-research", version: "0.1.0" },
        },
      });
      return;
    }
    if (message.method === "tools/call" && "id" in message) {
      this.receive({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          level: "info",
          logger: "secure-research",
          data: { message: "Loading approved Notion page tree", stage: "retrieval" },
        },
      });
      this.receive({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          progressToken: 1,
          progress: 50,
          total: 100,
          message: "Ranked approved evidence",
        },
      });
      this.receive({ jsonrpc: "2.0", id: "roots-1", method: "roots/list" });
      this.pendingToolRequest = message.id;
      return;
    }
  }

  private pendingToolRequest: RequestId | null = null;

  private handleClientResponse(message: JSONRPCMessage): void {
    if (!("id" in message) || !("result" in message)) return;
    if (message.id === "roots-1") {
      const result = message.result as { roots?: Array<{ uri: string }> };
      this.rootUri = result.roots?.[0]?.uri ?? "";
      this.receive({
        jsonrpc: "2.0",
        id: "sampling-1",
        method: "sampling/createMessage",
        params: {
          messages: [
            {
              role: "user",
              content: { type: "text", text: "Use approved evidence only." },
            },
          ],
          maxTokens: 1800,
          systemPrompt: "Ground every claim.",
          temperature: 0.1,
        },
      });
      this.samplingRequested = true;
      return;
    }
    if (message.id === "sampling-1" && this.pendingToolRequest !== null) {
      this.receive({
        jsonrpc: "2.0",
        id: this.pendingToolRequest,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "answered",
                answer: "Monitor loss and data quality [S1].",
                rationale: "The approved source names both signals.",
                sources: [
                  {
                    sourceId: "S1",
                    pageId: "page-1",
                    pageTitle: "Monitoring",
                    pageUrl: "https://notion.example/page-1",
                    headingPath: ["Monitoring"],
                    blockIds: ["block-1"],
                    score: 1,
                    excerpt: "",
                  },
                ],
                citedSourceIds: ["S1"],
                citationValid: true,
              }),
            },
          ],
          structuredContent: {
            status: "answered",
            answer: "Monitor loss and data quality [S1].",
            rationale: "The approved source names both signals.",
            sources: [
              {
                sourceId: "S1",
                pageId: "page-1",
                pageTitle: "Monitoring",
                pageUrl: "https://notion.example/page-1",
                headingPath: ["Monitoring"],
                blockIds: ["block-1"],
                score: 1,
                excerpt: "",
              },
            ],
            citedSourceIds: ["S1"],
            citationValid: true,
          },
        },
      });
    }
  }

  private receive(message: JSONRPCMessage): void {
    queueMicrotask(() => this.onmessage?.(message));
  }
}

function fakeSample() {
  return {
    content: JSON.stringify({
      status: "answered",
      answer: "Monitor loss and data quality [S1].",
      rationale: "The approved source names both signals.",
    }),
    thinking: null,
    usage: {
      promptTokens: 11,
      outputTokens: 7,
      totalDurationMs: 25,
      loadDurationMs: 0,
      promptEvalDurationMs: 10,
      evalDurationMs: 15,
    },
  };
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
            title: {
              type: "title",
              title: [{ plain_text: "Monitoring" }],
            },
          },
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

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for condition");
}

function eventMethods(events: McpConnectionEvent[]): Array<string | null> {
  return events.map((event) => event.method);
}
