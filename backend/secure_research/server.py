from __future__ import annotations

import asyncio
import json
from typing import Annotated

from mcp import types
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.session import ServerSession
from pydantic import Field, ValidationError

from .cache import load_cached_pages, save_cached_pages
from .citations import citation_sources, validate_citations
from .config import Settings
from .models import ResearchResult, SampledAnswer
from .notion import NotionClient
from .prompts import SYSTEM_PROMPT, research_prompt
from .retrieval import chunk_pages, rank_chunks
from .security import select_cache_root


mcp = FastMCP(
    name="Secure Research MCP",
    instructions=(
        "Research the configured, allowlisted Notion knowledge base. "
        "Inference is delegated to the MCP client through sampling."
    ),
    log_level="ERROR",
)

_corpus_lock = asyncio.Lock()


@mcp.tool(
    title="Research approved knowledge",
    description=(
        "Retrieve evidence from the fixed CS230 Notion page tree and ask the "
        "client-side model to produce a grounded, cited answer."
    ),
)
async def research(
    query: Annotated[
        str,
        Field(
            min_length=3,
            max_length=500,
            description="Standalone research question",
        ),
    ],
    ctx: Context[ServerSession, None],
) -> ResearchResult:
    settings = Settings()
    settings.require_server_credentials()
    query = query.strip()

    await _log(ctx, "info", "Validating client-provided cache root", "roots")
    await ctx.report_progress(5, 100, "Validating approved cache root")
    roots_result = await ctx.session.list_roots()
    cache_root = select_cache_root(roots_result.roots)

    await _log(ctx, "info", "Loading approved Notion page tree", "retrieval")
    await ctx.report_progress(15, 100, "Loading approved Notion corpus")
    pages, cache_hit = await _load_pages(settings, cache_root)
    await _log(
        ctx,
        "info",
        "Approved corpus loaded",
        "retrieval",
        cache_hit=cache_hit,
        page_count=len(pages),
    )

    chunks = chunk_pages(pages)
    selected = rank_chunks(query, chunks)
    await ctx.report_progress(50, 100, "Ranked approved evidence")
    await _log(
        ctx,
        "info",
        "Evidence ranking complete",
        "retrieval",
        chunk_count=len(chunks),
        selected_count=len(selected),
        selected_sources=[source.source_id for source in selected],
    )

    sources = citation_sources(selected)
    if not selected:
        await _log(
            ctx,
            "warning",
            "No approved evidence matched the question",
            "grounding",
        )
        await ctx.report_progress(100, 100, "No supporting evidence found")
        return ResearchResult(
            status="insufficient_evidence",
            answer=(
                "The approved CS230 notes do not contain enough evidence to "
                "answer this question."
            ),
            rationale="No allowlisted source chunk passed the retrieval threshold.",
            sources=[],
            cited_source_ids=[],
            citation_valid=True,
        )

    await _log(
        ctx,
        "info",
        "Requesting client-side model sampling",
        "sampling",
        source_count=len(selected),
    )
    await ctx.report_progress(65, 100, "Sampling with the client-side model")
    sampled_result = await ctx.session.create_message(
        messages=[
            types.SamplingMessage(
                role="user",
                content=types.TextContent(
                    type="text",
                    text=research_prompt(query, selected),
                ),
            )
        ],
        max_tokens=1800,
        system_prompt=SYSTEM_PROMPT,
        temperature=0.1,
    )
    sampled = _parse_sampled_answer(sampled_result)

    if sampled.status == "insufficient_evidence":
        await ctx.report_progress(100, 100, "Model found insufficient evidence")
        return ResearchResult(
            status="insufficient_evidence",
            answer=sampled.answer,
            rationale=sampled.rationale,
            sources=sources,
            cited_source_ids=[],
            citation_valid=True,
        )

    citation_valid, cited_ids = validate_citations(sampled.answer, selected)
    await _log(
        ctx,
        "info",
        "Citation validation complete",
        "validation",
        citation_valid=citation_valid,
        cited_source_ids=cited_ids,
    )
    await ctx.report_progress(100, 100, "Research response validated")
    if not citation_valid:
        return ResearchResult(
            status="error",
            answer=(
                "The generated response was withheld because its source "
                "markers could not be validated."
            ),
            rationale="At least one citation was missing or outside the approved evidence set.",
            sources=sources,
            cited_source_ids=cited_ids,
            citation_valid=False,
        )

    return ResearchResult(
        status="answered",
        answer=sampled.answer,
        rationale=sampled.rationale,
        sources=sources,
        cited_source_ids=cited_ids,
        citation_valid=True,
    )


async def _load_pages(settings: Settings, cache_root):
    async with _corpus_lock:
        cached = await asyncio.to_thread(
            load_cached_pages,
            cache_root,
            settings.notion_cache_ttl_seconds,
        )
        if cached is not None:
            return cached, True

        notion = NotionClient(
            settings.notion_token,
            settings.notion_root_page_id,
            base_url=settings.notion_base_url,
            version=settings.notion_version,
            max_pages=settings.notion_max_pages,
            max_blocks=settings.notion_max_blocks,
        )
        pages = await notion.fetch_page_tree()
        await asyncio.to_thread(save_cached_pages, cache_root, pages)
        return pages, False


async def _log(
    ctx: Context[ServerSession, None],
    level: str,
    message: str,
    stage: str,
    **data,
) -> None:
    await ctx.session.send_log_message(
        level=level,
        data={"message": message, "stage": stage, **data},
        logger="secure-research",
        related_request_id=ctx.request_id,
    )


def _parse_sampled_answer(
    result: types.CreateMessageResult | types.CreateMessageResultWithTools,
) -> SampledAnswer:
    if not isinstance(result.content, types.TextContent):
        raise ValueError("Client sampling returned non-text content")
    try:
        return SampledAnswer.model_validate(json.loads(result.content.text))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise ValueError("Client sampling returned invalid structured output") from exc


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
