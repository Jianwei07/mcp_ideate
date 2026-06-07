import re

from .models import CitationSource, SourceChunk


CITATION_RE = re.compile(r"\[(S\d+)\]")
CLAIM_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'-]+")


def extract_citations(answer: str) -> list[str]:
    return list(dict.fromkeys(CITATION_RE.findall(answer)))


def validate_citations(
    answer: str, sources: list[SourceChunk]
) -> tuple[bool, list[str]]:
    cited = extract_citations(answer)
    allowed = {source.source_id for source in sources}
    markers_valid = bool(cited) and set(cited).issubset(allowed)
    claims = [
        claim.strip()
        for claim in CLAIM_SPLIT_RE.split(answer)
        if len(WORD_RE.findall(claim)) >= 4
    ]
    claims_cited = bool(claims) and all(CITATION_RE.search(claim) for claim in claims)
    return markers_valid and claims_cited, cited


def citation_sources(chunks: list[SourceChunk]) -> list[CitationSource]:
    return [
        CitationSource(
            source_id=chunk.source_id,
            page_id=chunk.page_id,
            page_title=chunk.page_title,
            page_url=chunk.page_url,
            heading_path=chunk.heading_path,
            block_ids=chunk.block_ids,
            score=chunk.score,
            excerpt=_excerpt(chunk.text),
        )
        for chunk in chunks
    ]


def _excerpt(text: str, max_chars: int = 280) -> str:
    compact = " ".join(text.split())
    if len(compact) <= max_chars:
        return compact
    return f"{compact[: max_chars - 1].rstrip()}…"
