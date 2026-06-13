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
    await withRealStdioConnection(
      [fakeSample()],
      async (connection, events, samples) => {
        const result = await connection.callResearch("What should teams monitor?");

        expect(result.status).toBe("answered");
        expect(result.sources[0].pageTitle).toBe("Monitoring");
        expect(samples).toHaveLength(1);
        expect(eventMethods(events)).toContain("sampling/createMessage");
        expect(eventMethods(events)).toContain("roots/list");
      },
    );
  });

  test("repairs answers that fail strict citation validation", async () => {
    await withRealStdioConnection(
      [fakeSample("Monitor loss and data quality."), fakeSample()],
      async (connection, events, samples) => {
        const result = await connection.callResearch("What should teams monitor?");

        expect(result.status).toBe("answered");
        expect(result.citationValid).toBe(true);
        expect(samples).toHaveLength(2);
        expect(
          events.some(
            (event) =>
              event.kind === "progress" &&
              event.summary === "Research response citation validation passed",
          ),
        ).toBe(true);
      },
    );
  });

  test("withholds answers when citation repair still fails", async () => {
    await withRealStdioConnection(
      [
        fakeSample("Monitor loss and data quality."),
        fakeSample("Monitor loss and data quality."),
      ],
      async (connection, events, samples) => {
        const result = await connection.callResearch("What should teams monitor?");

        expect(result.status).toBe("error");
        expect(result.citationValid).toBe(false);
        expect(samples).toHaveLength(2);
        expect(
          events.some(
            (event) =>
              event.kind === "progress" &&
              event.summary === "Citation validation failed; withholding response",
          ),
        ).toBe(true);
      },
    );
  });

  test("sends evidence from the requested explicit lecture", async () => {
    await withRealStdioConnection(
      [fakeSample("Lecture 5 covers error analysis [S1].")],
      async (connection, _events, samples) => {
        const result = await connection.callResearch("Tell me more about Lecture 5");
        const prompt = samplingPrompt(samples[0]);

        expect(result.status).toBe("answered");
        expect(result.sources.map((source) => source.pageTitle)).toEqual([
          "Lecture 5: Error Analysis",
        ]);
        expect(prompt).toContain("Page: Lecture 5: Error Analysis");
        expect(prompt).not.toContain(
          "Page: Lecture 10: What’s Going On Inside My Model?",
        );
      },
      {
        pages: [
          {
            id: "l10",
            title: "Lecture 10: What’s Going On Inside My Model?",
            text: "Saliency maps and occlusion sensitivity explain model behavior.",
          },
          {
            id: "l05",
            title: "Lecture 5: Error Analysis",
            text: "Error analysis helps teams inspect mislabeled examples and model failures.",
          },
        ],
      },
    );
  });

  test("exposes Notion-style search and fetch tools", async () => {
    await withRealStdioConnection(
      [fakeSample()],
      async (connection) => {
        const search = await connection.callNotionSearch("lecture", 5);

        expect(search.results.map((page) => page.title)).toEqual([
          "Lecture 2: Bias and Variance",
          "Lecture 5: Error Analysis",
        ]);

        const fetched = await connection.callNotionFetch(search.results[0].pageId);

        expect(fetched.title).toBe("Lecture 2: Bias and Variance");
        expect(fetched.markdown).toContain("Bias and variance");
      },
      {
        pages: [
          {
            id: "l02",
            title: "Lecture 2: Bias and Variance",
            text: "Bias and variance help diagnose model errors.",
          },
          {
            id: "l05",
            title: "Lecture 5: Error Analysis",
            text: "Error analysis inspects mislabeled examples.",
          },
        ],
      },
    );
  });

  test("searches knowledge through Notion markdown", async () => {
    await withRealStdioConnection(
      [fakeSample()],
      async (connection) => {
        const result = await connection.callKnowledgeSearch("Tell me about lecture 2");

        expect(result.sources).toHaveLength(1);
        expect(result.sources[0].pageTitle).toBe("Lecture 2: Bias and Variance");
        expect(result.sources[0].excerpt).toContain("Bias and variance");
      },
      {
        pages: [
          {
            id: "l02",
            title: "Lecture 2: Bias and Variance",
            text: "Bias and variance help diagnose model errors.",
          },
          {
            id: "l05",
            title: "Lecture 5: Error Analysis",
            text: "Error analysis inspects mislabeled examples.",
          },
        ],
      },
    );
  });

  test("answers explicit lecture queries through Notion search", async () => {
    await withRealStdioConnection(
      [fakeSample("Lecture 2 explains bias and variance [S1].")],
      async (connection, _events, samples) => {
        const result = await connection.callResearch("Tell me more about lecture 2");
        const prompt = samplingPrompt(samples[0]);

        expect(result.status).toBe("answered");
        expect(result.sources.map((source) => source.pageTitle)).toEqual([
          "Lecture 2: Bias and Variance",
        ]);
        expect(prompt).toContain("Page: Lecture 2: Bias and Variance");
        expect(prompt).not.toContain("Lecture 5: Error Analysis");
      },
      {
        pages: [
          {
            id: "rootpage",
            title: "Monitoring",
            text: "Monitor data quality, loss, and model performance.",
          },
          {
            id: "l02",
            title: "Lecture 2: Bias and Variance",
            text: "Bias and variance help diagnose model errors.",
          },
          {
            id: "l05",
            title: "Lecture 5: Error Analysis",
            text: "Error analysis inspects mislabeled examples.",
          },
        ],
      },
    );
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

function fakeSample(answer = "Monitor loss and data quality [S1].") {
  return {
    content: JSON.stringify({
      status: "answered",
      answer,
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

async function withRealStdioConnection(
  sampleResults: ReturnType<typeof fakeSample>[],
  run: (
    connection: McpConnection,
    events: McpConnectionEvent[],
    samples: unknown[],
  ) => Promise<void>,
  options: { pages?: FakeNotionPage[] } = {},
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "secure-research-stdio-"));
  const notion = fakeNotionServer(options.pages);
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
  let sampleIndex = 0;
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
        const result = sampleResults[Math.min(sampleIndex, sampleResults.length - 1)];
        sampleIndex += 1;
        return result;
      },
    },
    emit(event) {
      events.push(event);
    },
  });

  try {
    await connection.connect();
    await run(connection, events, samples);
  } finally {
    await connection.close();
    notion.stop(true);
    restoreEnv(previousEnv);
    await rm(directory, { recursive: true, force: true });
  }
}

type FakeNotionPage = { id: string; title: string; text: string };

function fakeNotionServer(
  pages: FakeNotionPage[] = [
    {
      id: "rootpage",
      title: "Monitoring",
      text: "Monitor data quality, loss, and model performance.",
    },
  ],
): Bun.Server<undefined> {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const pageId = url.pathname.match(/^\/v1\/pages\/([^/]+)$/)?.[1];
      const markdownPageId = url.pathname.match(
        /^\/v1\/pages\/([^/]+)\/markdown$/,
      )?.[1];
      const blockId = url.pathname.match(/^\/v1\/blocks\/([^/]+)\/children$/)?.[1];
      const page = pages.find(
        (item) => item.id === (pageId ?? markdownPageId ?? blockId),
      );
      if (url.pathname === "/v1/search") {
        return Response.json({
          has_more: false,
          next_cursor: null,
          results: pages
            .filter((item) => item.id !== "rootpage")
            .map((item) => pagePayload(item)),
        });
      }
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
      if (
        url.pathname === "/v1/blocks/rootpage/children" &&
        pages[0]?.id !== "rootpage"
      ) {
        return Response.json({
          has_more: false,
          next_cursor: null,
          results: pages.map((item) => ({
            id: item.id,
            type: "child_page",
            has_children: false,
            child_page: { title: item.title },
          })),
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
      if (page && url.pathname === `/v1/pages/${page.id}`) {
        return Response.json(pagePayload(page));
      }
      if (page && url.pathname === `/v1/pages/${page.id}/markdown`) {
        return Response.json({
          object: "page_markdown",
          id: page.id,
          markdown: `# ${page.title}\n\n${page.text}`,
          truncated: false,
          unknown_block_ids: [],
        });
      }
      if (page && url.pathname === `/v1/blocks/${page.id}/children`) {
        return Response.json({
          has_more: false,
          next_cursor: null,
          results: [
            {
              id: `${page.id}-body`,
              type: "paragraph",
              has_children: false,
              paragraph: { rich_text: [{ plain_text: page.text }] },
            },
          ],
        });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });
}

function pagePayload(page: FakeNotionPage) {
  return {
    object: "page",
    id: page.id,
    url: `https://notion.example/${page.id}`,
    properties: {
      title: {
        type: "title",
        title: [{ plain_text: page.title }],
      },
    },
  };
}

function samplingPrompt(sample: unknown): string {
  const params = sample as { messages?: Array<{ content?: { text?: string } }> };
  return (
    params.messages?.map((message) => message.content?.text ?? "").join("\n") ?? ""
  );
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
