import type { NormalizedPage, SourceChunk } from "../types.ts";

const TOKEN_RE = /[a-z0-9][a-z0-9+#.-]*/gi;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "what",
  "when",
  "which",
  "with",
]);

export function tokenize(text: string): string[] {
  return (text.match(TOKEN_RE) ?? [])
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function chunkPages(pages: NormalizedPage[], maxChars = 1800): SourceChunk[] {
  const chunks: SourceChunk[] = [];

  for (const page of pages) {
    const headings: string[] = [];
    const lines: string[] = [];
    const blockIds: string[] = [];

    const flush = () => {
      const text = lines.join("\n").trim();
      if (text) {
        chunks.push({
          sourceId: "",
          pageId: page.pageId,
          pageTitle: page.title,
          pageUrl: page.url,
          headingPath: [...headings],
          blockIds: [...blockIds],
          text,
          score: 0,
        });
      }
      lines.length = 0;
      blockIds.length = 0;
    };

    for (const block of page.blocks) {
      const text = block.text.trim();
      if (!text) continue;

      if (block.headingLevel !== null) {
        flush();
        const level = Math.max(1, Math.min(block.headingLevel, 4));
        headings.splice(level - 1);
        headings.push(text);
        lines.push(text);
        blockIds.push(block.blockId);
        continue;
      }

      const currentLength = lines.reduce((total, line) => total + line.length, 0);
      if (lines.length > 0 && currentLength + text.length > maxChars) flush();
      lines.push(text);
      blockIds.push(block.blockId);
    }
    flush();
  }

  return chunks;
}

export function rankChunks(
  query: string,
  chunks: SourceChunk[],
  limit = 5,
  minimumScore = 0.15,
): SourceChunk[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || chunks.length === 0) return [];

  const documentTerms = chunks.map((chunk) => new Set(tokenize(chunk.text)));
  const documentFrequency = new Map<string, number>();
  for (const terms of documentTerms) {
    for (const term of terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const phrase = queryTerms.join(" ");
  const scored = chunks.flatMap((chunk, index) => {
    const bodyCounts = counts(tokenize(chunk.text));
    const headingCounts = counts(
      tokenize([chunk.pageTitle, ...chunk.headingPath].join(" ")),
    );
    let score = 0;

    for (const term of queryTerms) {
      const inverseFrequency =
        Math.log((chunks.length + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
      score += inverseFrequency * Math.min(bodyCounts.get(term) ?? 0, 3);
      score += inverseFrequency * Math.min(headingCounts.get(term) ?? 0, 2) * 1.8;
    }

    const haystack = tokenize(`${chunk.headingPath.join(" ")} ${chunk.text}`).join(" ");
    if (queryTerms.length > 1 && haystack.includes(phrase)) score += 4;
    const normalized = score / Math.max(new Set(queryTerms).size, 1);
    return normalized >= minimumScore
      ? [{ ...chunk, score: Number(normalized.toFixed(4)), _index: index }]
      : [];
  });

  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.pageTitle.localeCompare(right.pageTitle) ||
      (left.blockIds[0] ?? "").localeCompare(right.blockIds[0] ?? "") ||
      left._index - right._index,
  );

  return scored.slice(0, limit).map(({ _index: _discarded, ...chunk }, index) => ({
    ...chunk,
    sourceId: `S${index + 1}`,
  }));
}

function counts(tokens: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
}
