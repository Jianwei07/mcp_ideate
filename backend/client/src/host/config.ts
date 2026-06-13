import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type ClientConfig = {
  host: string;
  port: number;
  databasePath: string;
  auditDir: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaContextTokens: number;
  ollamaMaxOutputTokens: number;
  ollamaKeepAlive: string;
  serverEntry: string;
  serverEnvFile: string | null;
};

export function loadClientConfig(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const host = env.HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("The POC host must bind to 127.0.0.1");
  }

  const serverEnvFile = resolve(env.SERVER_ENV_FILE ?? "./server/.env");
  return {
    host: "127.0.0.1",
    port: positiveInteger(env.PORT, 8000),
    databasePath: resolve(env.DATABASE_PATH ?? "./runtime/research.db"),
    auditDir: resolve(env.AUDIT_DIR ?? "./runtime/audit"),
    ollamaBaseUrl: (env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, ""),
    ollamaModel: env.OLLAMA_MODEL ?? "llama3.2:3b",
    ollamaContextTokens: positiveInteger(env.OLLAMA_CONTEXT_TOKENS, 8192),
    ollamaMaxOutputTokens: positiveInteger(env.OLLAMA_MAX_OUTPUT_TOKENS, 1200),
    ollamaKeepAlive: env.OLLAMA_KEEP_ALIVE ?? "5m",
    serverEntry: resolve(env.MCP_SERVER_ENTRY ?? "./server/src/index.ts"),
    serverEnvFile: existsSync(serverEnvFile) ? serverEnvFile : null,
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received '${value}'`);
  }
  return parsed;
}
