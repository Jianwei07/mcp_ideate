from __future__ import annotations

import math
import re
from collections import Counter

from .models import NormalizedPage, SourceChunk


TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9+#.-]*", re.IGNORECASE)
STOP_WORDS = {
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
}


def tokenize(text: str) -> list[str]:
    return [
        token.lower()
        for token in TOKEN_RE.findall(text)
        if token.lower() not in STOP_WORDS and len(token) > 1
    ]


def chunk_pages(
    pages: list[NormalizedPage], max_chars: int = 1800
) -> list[SourceChunk]:
    chunks: list[SourceChunk] = []
    for page in pages:
        headings: list[str] = []
        current_lines: list[str] = []
        current_block_ids: list[str] = []

        def flush() -> None:
            text = "\n".join(current_lines).strip()
            if text:
                chunks.append(
                    SourceChunk(
                        page_id=page.page_id,
                        page_title=page.title,
                        page_url=page.url,
                        heading_path=list(headings),
                        block_ids=list(current_block_ids),
                        text=text,
                    )
                )
            current_lines.clear()
            current_block_ids.clear()

        for block in page.blocks:
            text = block.text.strip()
            if not text:
                continue

            if block.heading_level is not None:
                flush()
                level = max(1, min(block.heading_level, 4))
                headings[:] = headings[: level - 1]
                headings.append(text)
                current_lines.append(text)
                current_block_ids.append(block.block_id)
                continue

            if current_lines and sum(map(len, current_lines)) + len(text) > max_chars:
                flush()
            current_lines.append(text)
            current_block_ids.append(block.block_id)

        flush()
    return chunks


def rank_chunks(
    query: str,
    chunks: list[SourceChunk],
    *,
    limit: int = 5,
    minimum_score: float = 0.15,
) -> list[SourceChunk]:
    query_terms = tokenize(query)
    if not query_terms or not chunks:
        return []

    document_terms = [set(tokenize(chunk.text)) for chunk in chunks]
    document_frequency = Counter(
        term for terms in document_terms for term in terms
    )
    phrase = " ".join(query_terms)
    scored: list[SourceChunk] = []

    for chunk, terms in zip(chunks, document_terms, strict=True):
        body_counts = Counter(tokenize(chunk.text))
        heading_counts = Counter(
            tokenize(" ".join([chunk.page_title, *chunk.heading_path]))
        )
        score = 0.0
        for term in query_terms:
            inverse_frequency = math.log(
                (len(chunks) + 1) / (document_frequency[term] + 1)
            ) + 1.0
            score += inverse_frequency * min(body_counts[term], 3)
            score += inverse_frequency * min(heading_counts[term], 2) * 1.8

        haystack = f"{' '.join(chunk.heading_path)} {chunk.text}".lower()
        if len(query_terms) > 1 and phrase in " ".join(tokenize(haystack)):
            score += 4.0

        normalized = score / max(len(set(query_terms)), 1)
        if normalized >= minimum_score:
            scored.append(chunk.model_copy(update={"score": round(normalized, 4)}))

    scored.sort(
        key=lambda item: (
            -item.score,
            item.page_title.lower(),
            item.block_ids[0] if item.block_ids else "",
        )
    )
    selected = scored[:limit]
    return [
        chunk.model_copy(update={"source_id": f"S{index}"})
        for index, chunk in enumerate(selected, start=1)
    ]
