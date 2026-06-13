import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  knowledgeSearchResultSchema,
  knowledgeStatusResultSchema,
  notionPageFetchResultSchema,
  notionSearchResponseSchema,
  researchResultSchema,
  type KnowledgeSearchResult,
  type KnowledgeStatusResult,
  type NotionPageFetchResult,
  type NotionSearchResponse,
  type ResearchResult,
  type TranscriptEvent,
} from "@secure-research/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolResultSchema,
  CreateMessageRequestSchema,
  ListRootsRequestSchema,
  LoggingMessageNotificationSchema,
  type CreateMessageResult,
  type JSONRPCMessage,
  type LoggingMessageNotification,
} from "@modelcontextprotocol/sdk/types.js";
import type { ClientConfig } from "../host/config.ts";
import type { OllamaAdapter } from "../model/ollama.ts";
import type { SamplingApprovalDecision } from "../runs/approval.ts";

export type McpConnectionEvent = Omit<
  TranscriptEvent,
  "id" | "turnId" | "sequence" | "timestamp" | "detailAvailable"
>;

export type McpConnectionOptions = {
  config: Pick<ClientConfig, "serverEntry" | "serverEnvFile">;
  cacheRootPath?: string;
  ollama: Pick<OllamaAdapter, "model" | "sample">;
  thinkingRequested?: boolean;
  thinkingSupported?: boolean;
  approveSampling?: (request: {
    messageCount: number;
    signal?: AbortSignal;
  }) => Promise<SamplingApprovalDecision>;
  emit?: (event: McpConnectionEvent) => void | Promise<void>;
  transport?: Transport;
};

export class McpConnection {
  private readonly client: Client;
  private readonly transport: Transport;

  constructor(private readonly options: McpConnectionOptions) {
    this.client = new Client(
      { name: "secure-research-host", version: "0.2.0" },
      { capabilities: { sampling: {}, roots: {} } },
    );
    this.transport = new TracingTransport(
      options.transport ?? createStdioTransport(options.config),
      (direction, message) => {
        void this.emit({
          channel: "mcp",
          origin: "mcp-connection",
          direction,
          kind: messageKind(message),
          method: messageMethod(message),
          requestId: messageId(message),
          parentRequestId: null,
          level: messageLevel(message),
          status: messageStatus(message),
          summary: summarizeMessage(direction, message),
          durationMs: null,
          metadata: safeMessageMetadata(message),
        });
      },
    );
    this.registerHandlers();
  }

  async connect(signal?: AbortSignal): Promise<void> {
    await mkdir(this.cacheRootPath(), { recursive: true });
    await this.client.connect(this.transport, { signal });
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  async callResearch(
    query: string,
    options: Pick<RequestOptions, "signal"> = {},
  ): Promise<ResearchResult> {
    const result = await this.client.callTool(
      { name: "research", arguments: { query } },
      CallToolResultSchema,
      {
        ...options,
        resetTimeoutOnProgress: true,
        onprogress: async (progress) => {
          await this.emit({
            channel: "mcp",
            origin: "mcp-server",
            direction: "server_to_client",
            kind: "progress",
            method: "notifications/progress",
            requestId: null,
            parentRequestId: null,
            level: "info",
            status: "running",
            summary: String(progress.message ?? "MCP tool progress"),
            durationMs: null,
            metadata: {
              progress: progress.progress,
              total: progress.total,
            },
          });
        },
      },
    );
    if ("isError" in result && result.isError) {
      throw new Error(firstText(result.content) ?? "The MCP server returned an error.");
    }
    if ("structuredContent" in result && result.structuredContent) {
      return researchResultSchema.parse(result.structuredContent);
    }
    const text = "content" in result ? firstText(result.content) : null;
    return researchResultSchema.parse(JSON.parse(text ?? ""));
  }

  async callNotionSearch(
    query: string,
    limit = 10,
    options: Pick<RequestOptions, "signal"> = {},
  ): Promise<NotionSearchResponse> {
    return notionSearchResponseSchema.parse(
      await this.callStructuredTool("notion_search", { query, limit }, options),
    );
  }

  async callNotionFetch(
    page: string,
    options: Pick<RequestOptions, "signal"> = {},
  ): Promise<NotionPageFetchResult> {
    return notionPageFetchResultSchema.parse(
      await this.callStructuredTool("notion_fetch", { page }, options),
    );
  }

  async callKnowledgeSearch(
    query: string,
    options: Pick<RequestOptions, "signal"> = {},
  ): Promise<KnowledgeSearchResult> {
    return knowledgeSearchResultSchema.parse(
      await this.callStructuredTool("knowledge_search", { query }, options),
    );
  }

  async callKnowledgeStatus(
    options: Pick<RequestOptions, "signal"> = {},
  ): Promise<KnowledgeStatusResult> {
    return knowledgeStatusResultSchema.parse(
      await this.callStructuredTool("knowledge_status", {}, options),
    );
  }

  private async callStructuredTool(
    name: string,
    args: Record<string, unknown>,
    options: Pick<RequestOptions, "signal">,
  ): Promise<unknown> {
    const result = await this.client.callTool(
      { name, arguments: args },
      CallToolResultSchema,
      options,
    );
    if ("isError" in result && result.isError) {
      throw new Error(firstText(result.content) ?? "The MCP server returned an error.");
    }
    if ("structuredContent" in result && result.structuredContent) {
      return result.structuredContent;
    }
    const text = "content" in result ? firstText(result.content) : null;
    return JSON.parse(text ?? "");
  }

  private registerHandlers(): void {
    this.client.setRequestHandler(ListRootsRequestSchema, async () => {
      const rootPath = this.cacheRootPath();
      await this.emit({
        channel: "mcp",
        origin: "mcp-connection",
        direction: "server_to_client",
        kind: "roots",
        method: "roots/list",
        requestId: null,
        parentRequestId: null,
        level: "info",
        status: "complete",
        summary: "Returned approved cache root",
        durationMs: null,
        metadata: { rootName: "secure-research-cache" },
      });
      return {
        roots: [
          {
            uri: pathToFileURL(rootPath).href,
            name: "secure-research-cache",
          },
        ],
      };
    });

    this.client.setRequestHandler(
      CreateMessageRequestSchema,
      async (request, extra): Promise<CreateMessageResult> => {
        await this.emit({
          channel: "model",
          origin: "mcp-server",
          direction: "server_to_client",
          kind: "sampling",
          method: request.method,
          requestId: null,
          parentRequestId: null,
          level: "info",
          status: "pending",
          summary: "MCP server requested client-side sampling",
          durationMs: null,
          metadata: {
            messageCount: request.params.messages.length,
            maxTokens: request.params.maxTokens,
            temperature: request.params.temperature,
            thinkingRequested: this.options.thinkingRequested ?? false,
            thinkingSupported: this.options.thinkingSupported ?? false,
          },
        });
        const decision = await this.options.approveSampling?.({
          messageCount: request.params.messages.length,
          signal: extra.signal,
        });
        if (decision === "deny") {
          await this.emit({
            channel: "model",
            origin: "approval",
            direction: "internal",
            kind: "sampling",
            method: request.method,
            requestId: null,
            parentRequestId: null,
            level: "warning",
            status: "denied",
            summary: "Client-side sampling denied",
            durationMs: null,
            metadata: { messageCount: request.params.messages.length },
          });
          throw new Error("Client-side sampling was denied.");
        }
        await this.emit({
          channel: "model",
          origin: "ollama",
          direction: "server_to_client",
          kind: "sampling",
          method: request.method,
          requestId: null,
          parentRequestId: null,
          level: "info",
          status: "running",
          summary: "Running approved client-side sampling",
          durationMs: null,
          metadata: {
            messageCount: request.params.messages.length,
            model: this.options.ollama.model,
            thinkingRequested: this.options.thinkingRequested ?? false,
            thinkingSupported: this.options.thinkingSupported ?? false,
          },
        });
        const sample = await this.options.ollama.sample(
          {
            systemPrompt: request.params.systemPrompt,
            messages: request.params.messages.map((message) => ({
              role: message.role,
              content: normalizeSamplingContent(message.content),
            })),
            maxTokens: request.params.maxTokens,
            temperature: request.params.temperature,
          },
          this.options.thinkingRequested ?? false,
          extra.signal,
        );
        if (sample.thinking) {
          console.error(
            `[secure-research] raw_ollama_thinking model=${this.options.ollama.model}\n${sample.thinking}`,
          );
        }
        await this.emit({
          channel: "model",
          origin: "ollama",
          direction: "internal",
          kind: "sampling",
          method: request.method,
          requestId: null,
          parentRequestId: null,
          level: "info",
          status: "complete",
          summary: "Client-side sampling completed",
          durationMs: sample.usage.totalDurationMs,
          metadata: {
            promptTokens: sample.usage.promptTokens,
            outputTokens: sample.usage.outputTokens,
            thinkingReturned: sample.thinking !== null,
          },
        });
        return {
          role: "assistant",
          model: this.options.ollama.model,
          content: { type: "text", text: sample.content },
          stopReason: "endTurn",
        };
      },
    );

    this.client.setNotificationHandler(
      LoggingMessageNotificationSchema,
      async (notification) => {
        await this.emit(loggingEvent(notification));
      },
    );
  }

  private cacheRootPath(): string {
    return resolve(this.options.cacheRootPath ?? "./runtime/mcp-cache");
  }

  private async emit(event: McpConnectionEvent): Promise<void> {
    await this.options.emit?.(event);
  }
}

class TracingTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport["onmessage"];

  constructor(
    private readonly inner: Transport,
    private readonly trace: (
      direction: "client_to_server" | "server_to_client",
      message: JSONRPCMessage,
    ) => void,
  ) {}

  async start(): Promise<void> {
    this.inner.onmessage = (message, extra) => {
      this.trace("server_to_client", message);
      this.onmessage?.(message, extra);
    };
    this.inner.onerror = (error) => this.onerror?.(error);
    this.inner.onclose = () => this.onclose?.();
    await this.inner.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    this.trace("client_to_server", message);
    await this.inner.send(message, options);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

function createStdioTransport(
  config: Pick<ClientConfig, "serverEntry" | "serverEnvFile">,
): Transport {
  return new StdioClientTransport({
    command: "bun",
    args: [config.serverEntry],
    env: definedEnv(process.env),
    stderr: "inherit",
  });
}

function definedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string";
    }),
  );
}

function loggingEvent(notification: LoggingMessageNotification): McpConnectionEvent {
  const data = isRecord(notification.params.data) ? notification.params.data : {};
  return {
    channel: "mcp",
    origin: notification.params.logger ?? "mcp-server",
    direction: "server_to_client",
    kind: "logging",
    method: notification.method,
    requestId: null,
    parentRequestId: null,
    level: transcriptLevel(notification.params.level),
    status: notification.params.level === "error" ? "error" : "running",
    summary: String(data.message ?? "MCP server log"),
    durationMs: null,
    metadata: omit(data, "message"),
  };
}

function transcriptLevel(level: string): McpConnectionEvent["level"] {
  if (
    level === "debug" ||
    level === "info" ||
    level === "warning" ||
    level === "error"
  ) {
    return level;
  }
  return level === "notice" ? "info" : "warning";
}

function messageKind(message: JSONRPCMessage): string {
  if ("method" in message && "id" in message) return "request";
  if ("method" in message) return "notification";
  if ("error" in message) return "error";
  return "response";
}

function messageLevel(message: JSONRPCMessage): McpConnectionEvent["level"] {
  if (messageMethod(message) === "notifications/cancelled") return "warning";
  if ("error" in message) return "error";
  return "debug";
}

function messageStatus(message: JSONRPCMessage): McpConnectionEvent["status"] {
  if (messageMethod(message) === "notifications/cancelled") return "cancelled";
  if ("error" in message) return "error";
  return "running";
}

function messageMethod(message: JSONRPCMessage): string | null {
  return "method" in message ? message.method : null;
}

function messageId(message: JSONRPCMessage): string | null {
  if (!("id" in message)) return null;
  return String(message.id);
}

function summarizeMessage(
  direction: "client_to_server" | "server_to_client",
  message: JSONRPCMessage,
): string {
  const method = messageMethod(message);
  if (method) return `${direction} ${method}`;
  return `${direction} ${messageKind(message)}`;
}

function safeMessageMetadata(message: JSONRPCMessage): Record<string, unknown> {
  return {
    kind: messageKind(message),
    method: messageMethod(message),
    hasResult: "result" in message,
    hasError: "error" in message,
  };
}

function firstText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      return item.text;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function omit(
  value: Record<string, unknown>,
  keyToOmit: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== keyToOmit));
}

function normalizeSamplingContent(
  content: unknown,
): { type: "text"; text: string } | Array<{ type: string; text?: string }> {
  if (
    isRecord(content) &&
    content.type === "text" &&
    typeof content.text === "string"
  ) {
    return { type: "text", text: content.text };
  }
  if (Array.isArray(content)) {
    return content.filter(isRecord).map((item) => ({
      type: String(item.type ?? "unknown"),
      text: typeof item.text === "string" ? item.text : undefined,
    }));
  }
  return { type: "text", text: "" };
}
