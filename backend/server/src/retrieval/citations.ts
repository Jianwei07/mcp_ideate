import type { CitationSource } from "@secure-research/contracts";
import type { SourceChunk } from "../types.ts";

const CITATION_RE = /\[(S\d+)\]/g;
const CLAIM_SPLIT_RE = /(?<=[.!?])\s+|\n+/;
const WORD_RE = /[A-Za-z][A-Za-z'-]+/g;

export function extractCitations(answer: string): string[] {
  return [...new Set([...answer.matchAll(CITATION_RE)].map((match) => match[1]))];
}

export function validateCitations(
  answer: string,
  sources: SourceChunk[],
): { valid: boolean; citedSourceIds: string[] } {
  const citedSourceIds = extractCitations(answer);
  const allowed = new Set(sources.map((source) => source.sourceId));
  const markersValid =
    citedSourceIds.length > 0 &&
    citedSourceIds.every((sourceId) => allowed.has(sourceId));
  const claims = answer
    .split(CLAIM_SPLIT_RE)
    .map((claim) => claim.trim())
    .filter((claim) => (claim.match(WORD_RE) ?? []).length >= 4);
  const claimsCited =
    claims.length > 0 && claims.every((claim) => /\[S\d+\]/.test(claim));

  return { valid: markersValid && claimsCited, citedSourceIds };
}

export function citationSources(chunks: SourceChunk[]): CitationSource[] {
  return chunks.map((chunk) => ({
    sourceId: chunk.sourceId,
    pageId: chunk.pageId,
    pageTitle: chunk.pageTitle,
    pageUrl: chunk.pageUrl,
    headingPath: chunk.headingPath,
    blockIds: chunk.blockIds,
    score: chunk.score,
    excerpt: excerpt(chunk.text),
  }));
}

function excerpt(text: string, maxChars = 280): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= maxChars
    ? compact
    : `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}
