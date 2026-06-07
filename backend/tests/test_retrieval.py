from secure_research.models import NormalizedBlock, NormalizedPage
from secure_research.retrieval import chunk_pages, rank_chunks


def test_heading_aware_chunking_and_lexical_ranking() -> None:
    pages = [
        NormalizedPage(
            page_id="page-1",
            title="Full Cycle of a DL Project",
            url="https://notion.example/page-1",
            blocks=[
                NormalizedBlock(
                    block_id="h1",
                    block_type="heading_2",
                    heading_level=2,
                    text="Monitoring signals",
                ),
                NormalizedBlock(
                    block_id="p1",
                    block_type="paragraph",
                    text=(
                        "Monitor multiple signals including data quality, "
                        "loss, and model performance over time."
                    ),
                ),
                NormalizedBlock(
                    block_id="h2",
                    block_type="heading_2",
                    heading_level=2,
                    text="Deployment",
                ),
                NormalizedBlock(
                    block_id="p2",
                    block_type="paragraph",
                    text="Deploy only after evaluation gates pass.",
                ),
            ],
        )
    ]

    chunks = chunk_pages(pages)
    ranked = rank_chunks("What signals should we monitor?", chunks)

    assert len(chunks) == 2
    assert ranked[0].source_id == "S1"
    assert ranked[0].heading_path == ["Monitoring signals"]
    assert "model performance" in ranked[0].text


def test_no_matching_terms_returns_no_evidence() -> None:
    page = NormalizedPage(
        page_id="page-1",
        title="Neural Networks",
        url="https://notion.example/page-1",
        blocks=[
            NormalizedBlock(
                block_id="p1",
                block_type="paragraph",
                text="Gradient descent updates model weights.",
            )
        ],
    )

    assert rank_chunks("procurement policy", chunk_pages([page])) == []
