export type ServerConfig = {
  notionToken: string;
  notionRootPageId: string;
  notionBaseUrl: string;
  notionVersion: string;
  cacheTtlSeconds: number;
  maxPages: number;
  maxBlocks: number;
};

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const notionToken = env.NOTION_TOKEN?.trim() ?? "";
  const notionRootPageId = env.NOTION_ROOT_PAGE_ID?.trim() ?? "";
  const missing = [
    !notionToken && "NOTION_TOKEN",
    !notionRootPageId && "NOTION_ROOT_PAGE_ID",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Missing secure server configuration: ${missing.join(", ")}. ` +
        "Copy server/.env.example to server/.env.",
    );
  }

  return {
    notionToken,
    notionRootPageId,
    notionBaseUrl: (env.NOTION_BASE_URL ?? "https://api.notion.com").replace(/\/$/, ""),
    notionVersion: env.NOTION_VERSION ?? "2026-03-11",
    cacheTtlSeconds: positiveInteger(env.NOTION_CACHE_TTL_SECONDS, 300),
    maxPages: positiveInteger(env.NOTION_MAX_PAGES, 30),
    maxBlocks: positiveInteger(env.NOTION_MAX_BLOCKS, 3000),
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Expected a positive integer configuration value, received '${value}'`,
    );
  }
  return parsed;
}
