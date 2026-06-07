from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class NormalizedBlock(BaseModel):
    block_id: str
    block_type: str
    text: str
    heading_level: int | None = None


class NormalizedPage(BaseModel):
    page_id: str
    title: str
    url: str
    blocks: list[NormalizedBlock]


class SourceChunk(BaseModel):
    source_id: str = ""
    page_id: str
    page_title: str
    page_url: str
    heading_path: list[str] = Field(default_factory=list)
    block_ids: list[str] = Field(default_factory=list)
    text: str
    score: float = 0.0


class CitationSource(BaseModel):
    source_id: str
    page_id: str
    page_title: str
    page_url: str
    heading_path: list[str]
    block_ids: list[str]
    score: float
    excerpt: str


class SampledAnswer(BaseModel):
    status: Literal["answered", "insufficient_evidence"]
    answer: str
    rationale: str


class ResearchResult(BaseModel):
    status: Literal["answered", "insufficient_evidence", "error"]
    answer: str
    rationale: str
    sources: list[CitationSource] = Field(default_factory=list)
    cited_source_ids: list[str] = Field(default_factory=list)
    citation_valid: bool = False


class TraceEvent(BaseModel):
    sequence: int
    run_id: str
    timestamp: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat()
    )
    type: Literal["trace", "result", "error", "cancelled"]
    stage: str
    level: Literal["debug", "info", "warning", "error"] = "info"
    message: str
    data: dict[str, Any] = Field(default_factory=dict)
