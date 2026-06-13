import type { CitationSource } from "@secure-research/contracts";
import type { SourceChunk } from "../types.ts";

const CITATION_RE = /\[(S\d+)\]/g;
const CLAIM_SPLIT_RE = /(?<=[.!?])\s+|\n+/;
const WORD_RE = /[A-Za-z][A-Za-z'-]+/g;

export type CitationValidation = {
  valid: boolean;
  citedSourceIds: string[];
  invalidSourceIds: string[];
  claimCount: number;
  uncitedClaimCount: number;
  hasCitations: boolean;
};

export function extractCitations(answer: string): string[] {
  return [...new Set([...answer.matchAll(CITATION_RE)].map((match) => match[1]))];
}

export function validateCitations(
  answer: string,
  sources: SourceChunk[],
): CitationValidation {
  const citedSourceIds = extractCitations(answer);
  const allowed = new Set(sources.map((source) => source.sourceId));
  const invalidSourceIds = citedSourceIds.filter((sourceId) => !allowed.has(sourceId));
  const claims = answer
    .split(CLAIM_SPLIT_RE)
    .map((claim) => claim.trim())
    .filter((claim) => (claim.match(WORD_RE) ?? []).length >= 4);
  const uncitedClaimCount = claims.filter(
    (claim) => !extractCitations(claim).some((sourceId) => allowed.has(sourceId)),
  ).length;
  const hasCitations = citedSourceIds.length > 0;

  return {
    valid:
      hasCitations &&
      invalidSourceIds.length === 0 &&
      claims.length > 0 &&
      uncitedClaimCount === 0,
    citedSourceIds,
    invalidSourceIds,
    claimCount: claims.length,
    uncitedClaimCount,
    hasCitations,
  };
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
