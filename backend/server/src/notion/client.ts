import type { NormalizedBlock, NormalizedPage } from "../types.ts";

const TEXT_BLOCK_TYPES = new Set([
  "bookmark",
  "bulleted_list_item",
  "callout",
  "code",
  "equation",
  "heading_1",
  "heading_2",
  "heading_3",
  "heading_4",
  "numbered_list_item",
  "paragraph",
  "quote",
  "table_row",
  "to_do",
  "toggle",
]);

type NotionConfig = {
  token: string;
  rootPageId: string;
  baseUrl: string;
  version: string;
  maxPages: number;
  maxBlocks: number;
};

export class NotionAdapter {
  private readonly rootPageId: string;
  private readonly headers: HeadersInit;

  constructor(private readonly config: NotionConfig) {
    this.rootPageId = compactId(config.rootPageId);
    this.headers = {
      Authorization: `Bearer ${config.token}`,
      "Notion-Version": config.version,
      "Content-Type": "application/json",
    };
  }

  async fetchPageTree(signal?: AbortSignal): Promise<NormalizedPage[]> {
    const pages: NormalizedPage[] = [];
    const queued = [this.rootPageId];
    const seen = new Set<string>();
    let blockCount = 0;

    while (queued.length > 0) {
      signal?.throwIfAborted();
      const pageId = queued.shift();
      if (!pageId || seen.has(pageId)) continue;
      if (seen.size >= this.config.maxPages) {
        throw new Error("Notion page limit exceeded");
      }
      seen.add(pageId);

      const page = await this.request(`/v1/pages/${pageId}`, undefined, signal);
      const walked = await this.walkContainer(pageId, signal);
      blockCount += walked.blocks.length;
      if (blockCount > this.config.maxBlocks) {
        throw new Error("Notion block limit exceeded");
      }

      pages.push({
        pageId,
        title: pageTitle(page),
        url: stringValue(page.url) || `https://www.notion.so/${pageId}`,
        blocks: walked.blocks,
      });
      queued.push(...walked.childPages.filter((child) => !seen.has(child)));
    }

    return pages;
  }

  private async walkContainer(
    containerId: string,
    signal?: AbortSignal,
  ): Promise<{ blocks: NormalizedBlock[]; childPages: string[] }> {
    const normalized: NormalizedBlock[] = [];
    const childPages: string[] = [];
    const blocks = await this.listChildren(containerId, signal);

    for (const block of blocks) {
      signal?.throwIfAborted();
      const blockId = compactId(stringValue(block.id));
      const blockType = stringValue(block.type) || "unsupported";
      if (blockType === "child_page") {
        childPages.push(blockId);
        continue;
      }

      const text = blockText(block, blockType);
      if (text) {
        normalized.push({
          blockId,
          blockType,
          text,
          headingLevel: headingLevel(blockType),
        });
      }

      if (block.has_children === true) {
        const nested = await this.walkContainer(blockId, signal);
        normalized.push(...nested.blocks);
        childPages.push(...nested.childPages);
      }
    }

    return { blocks: normalized, childPages };
  }

  private async listChildren(
    blockId: string,
    signal?: AbortSignal,
  ): Promise<Array<Record<string, unknown>>> {
    const results: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ page_size: "100" });
      if (cursor) params.set("start_cursor", cursor);
      const payload = await this.request(
        `/v1/blocks/${blockId}/children`,
        params,
        signal,
      );
      if (Array.isArray(payload.results)) {
        results.push(...payload.results.filter(isRecord));
      }
      cursor =
        payload.has_more === true
          ? stringValue(payload.next_cursor) || undefined
          : undefined;
    } while (cursor);

    return results;
  }

  private async request(
    path: string,
    params?: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.config.baseUrl}${path}`);
    if (params) url.search = params.toString();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        headers: this.headers,
        signal,
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 3) {
          throw notionHttpError(response.status);
        }
        const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
        await Bun.sleep(
          Math.min(Number.isFinite(retryAfter) ? retryAfter : 1, 4) * 1000,
        );
        continue;
      }
      if (!response.ok) throw notionHttpError(response.status);
      const payload: unknown = await response.json();
      if (!isRecord(payload)) throw new Error("Notion returned an invalid response");
      return payload;
    }
    throw new Error("Notion request failed after retries");
  }
}

function notionHttpError(status: number): Error {
  const error = new Error(`Notion request failed with HTTP ${status}`);
  error.name =
    status === 401 || status === 403 ? "NotionAuthorizationError" : "NotionError";
  return error;
}

function compactId(value: string): string {
  return value.replaceAll("-", "").trim();
}

function pageTitle(page: Record<string, unknown>): string {
  if (!isRecord(page.properties)) return "Untitled Notion page";
  for (const property of Object.values(page.properties)) {
    if (!isRecord(property) || property.type !== "title") continue;
    const text = richText(Array.isArray(property.title) ? property.title : []);
    if (text) return text;
  }
  return "Untitled Notion page";
}

function blockText(block: Record<string, unknown>, blockType: string): string {
  if (!TEXT_BLOCK_TYPES.has(blockType)) return "";
  const value = isRecord(block[blockType]) ? block[blockType] : {};
  if (blockType === "equation") return stringValue(value.expression);
  if (blockType === "table_row" && Array.isArray(value.cells)) {
    return value.cells
      .map((cell) => richText(Array.isArray(cell) ? cell : []))
      .join(" | ");
  }
  return richText(Array.isArray(value.rich_text) ? value.rich_text : []);
}

function richText(items: unknown[]): string {
  return items
    .filter(isRecord)
    .map((item) => stringValue(item.plain_text))
    .join("")
    .trim();
}

function headingLevel(blockType: string): number | null {
  const match = /^heading_(\d)$/.exec(blockType);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
