import { loadCachedPages, saveCachedPages } from "./cache.ts";
import type { ServerConfig } from "./config.ts";
import { NotionAdapter } from "./notion/client.ts";
import { chunkPages, rankChunks } from "./retrieval/index.ts";
import { citationSources } from "./retrieval/citations.ts";
import type { NormalizedPage, NotionMarkdownPage, SourceChunk } from "./types.ts";

const SEARCH_LIMIT = 10;

export type KnowledgeCorpus = {
  pages: NormalizedPage[];
  cacheHit: boolean;
};

export async function loadKnowledgeCorpus(
  cacheRoot: string,
  config: ServerConfig,
  signal?: AbortSignal,
): Promise<KnowledgeCorpus> {
  let pages = await loadCachedPages(cacheRoot, config.cacheTtlSeconds);
  const cacheHit = pages !== null;
  if (!pages) {
    pages = await notion(config).fetchPageTree(signal);
    await saveCachedPages(cacheRoot, pages);
  }
  return { pages, cacheHit };
}

export async function searchKnowledgeChunks(
  query: string,
  config: ServerConfig,
  signal?: AbortSignal,
): Promise<SourceChunk[]> {
  const adapter = notion(config);
  const pages = await searchMarkdownPages(adapter, query, signal);
  return rankChunks(query, chunkPages(pages));
}

export async function searchKnowledgeSources(
  query: string,
  config: ServerConfig,
  signal?: AbortSignal,
) {
  return citationSources(await searchKnowledgeChunks(query, config, signal));
}

export function markdownPageToNormalized(page: NotionMarkdownPage): NormalizedPage {
  return {
    pageId: page.pageId,
    title: page.title,
    url: page.url,
    blocks: markdownBlocks(page),
  };
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

async function searchMarkdownPages(
  adapter: NotionAdapter,
  query: string,
  signal?: AbortSignal,
): Promise<NormalizedPage[]> {
  const searchQuery = searchQueryFor(query);
  const pages = await adapter.searchPages(searchQuery, SEARCH_LIMIT, signal);
  const fetched: NormalizedPage[] = [];
  for (const page of pages) {
    signal?.throwIfAborted();
    const markdown = await adapter.fetchPageMarkdown(page.pageId, signal);
    fetched.push(markdownPageToNormalized(markdown));
  }
  return fetched;
}

function searchQueryFor(query: string): string {
  const lecture = query.match(/\b(?:l|lecture|lesson|class)\s*0*(\d+)\b/i);
  return lecture ? `Lecture ${Number.parseInt(lecture[1], 10)}` : query;
}

function markdownBlocks(page: NotionMarkdownPage) {
  return page.markdown
    .split(/\n+/)
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, index }) => {
      const heading = /^(#{1,4})\s+(.+)$/.exec(line);
      return {
        blockId: `${page.pageId}-md-${index}`,
        blockType: heading ? `heading_${heading[1].length}` : "paragraph",
        text: heading ? heading[2] : line,
        headingLevel: heading ? heading[1].length : null,
      };
    });
}
