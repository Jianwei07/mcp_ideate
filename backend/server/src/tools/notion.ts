import {
  knowledgeSearchResultSchema,
  knowledgeStatusResultSchema,
  notionPageFetchResultSchema,
  notionSearchResponseSchema,
} from "@secure-research/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerConfig } from "../config.ts";
import { loadKnowledgeCorpus, searchKnowledgeSources } from "../knowledge.ts";
import { NotionAdapter } from "../notion/client.ts";
import { selectCacheRoot } from "../security/roots.ts";

export function registerNotionTools(mcp: McpServer, config: ServerConfig): void {
  mcp.registerTool(
    "notion_search",
    {
      title: "Search Notion pages",
      description: "Search read-only Notion pages shared with the integration.",
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(20).default(10),
      },
      outputSchema: notionSearchResponseSchema,
    },
    async ({ query, limit }, extra) => {
      const results = await notion(config).searchPages(query, limit, extra.signal);
      return result({
        results: results.map((page) => ({ object: "page" as const, ...page })),
      });
    },
  );

  mcp.registerTool(
    "notion_fetch",
    {
      title: "Fetch Notion page",
      description:
        "Fetch a read-only Notion page as enhanced markdown by page ID or URL.",
      inputSchema: {
        page: z.string().trim().min(1).max(500),
      },
      outputSchema: notionPageFetchResultSchema,
    },
    async ({ page }, extra) => {
      const fetched = await notion(config).fetchPageMarkdown(page, extra.signal);
      return result(fetched);
    },
  );

  mcp.registerTool(
    "knowledge_search",
    {
      title: "Search approved knowledge",
      description:
        "Search Notion-backed approved knowledge and return citation-ready chunks.",
      inputSchema: {
        query: z.string().trim().min(3).max(500),
      },
      outputSchema: knowledgeSearchResultSchema,
    },
    async ({ query }, extra) => {
      const sources = await searchKnowledgeSources(query, config, extra.signal);
      return result({ sources });
    },
  );

  mcp.registerTool(
    "knowledge_status",
    {
      title: "Inspect knowledge status",
      description: "Return safe Notion corpus metadata without protected excerpts.",
      inputSchema: {},
      outputSchema: knowledgeStatusResultSchema,
    },
    async (_input, extra) => {
      const roots = await mcp.server.listRoots();
      const cacheRoot = await selectCacheRoot(roots.roots);
      const corpus = await loadKnowledgeCorpus(cacheRoot, config, extra.signal);
      return result({
        cacheHit: corpus.cacheHit,
        pageCount: corpus.pages.length,
        titles: corpus.pages.map((page) => page.title),
        notionVersion: config.notionVersion,
      });
    },
  );
}

function notion(config: ServerConfig): NotionAdapter {
  return new NotionAdapter({
    token: config.notionToken,
    rootPageId: config.notionRootPageId,
    baseUrl: config.notionBaseUrl,
    version: config.notionVersion,
    maxPages: config.maxPages,
    maxBlocks: config.maxBlocks,
  });
}

function result<T>(structuredContent: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}
