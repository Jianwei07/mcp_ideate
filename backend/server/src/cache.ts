import { rename } from "node:fs/promises";
import { resolveWithinRoot } from "./security/roots.ts";
import type { NormalizedPage } from "./types.ts";

const CACHE_FILE = "notion-corpus.json";

type CachePayload = {
  fetchedAt: number;
  pages: NormalizedPage[];
};

export async function loadCachedPages(
  root: string,
  ttlSeconds: number,
): Promise<NormalizedPage[] | null> {
  try {
    const payload = (await Bun.file(resolveWithinRoot(root, CACHE_FILE)).json()) as
      | CachePayload
      | undefined;
    if (!payload || Date.now() / 1000 - payload.fetchedAt > ttlSeconds) return null;
    return Array.isArray(payload.pages) ? payload.pages : null;
  } catch {
    return null;
  }
}

export async function saveCachedPages(
  root: string,
  pages: NormalizedPage[],
): Promise<void> {
  const path = resolveWithinRoot(root, CACHE_FILE);
  const temporary = resolveWithinRoot(root, `${CACHE_FILE}.tmp`);
  await Bun.write(
    temporary,
    JSON.stringify({ fetchedAt: Date.now() / 1000, pages } satisfies CachePayload),
  );
  await rename(temporary, path);
}
