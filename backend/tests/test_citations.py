from secure_research.citations import extract_citations, validate_citations
from secure_research.models import SourceChunk


def _source(source_id: str) -> SourceChunk:
    return SourceChunk(
        source_id=source_id,
        page_id="page",
        page_title="Page",
        page_url="https://notion.example/page",
        text="Evidence",
    )


def test_validates_known_claim_markers() -> None:
    valid, cited = validate_citations(
        "The project uses monitoring gates [S1] and evaluation [S2].",
        [_source("S1"), _source("S2")],
    )
    assert valid is True
    assert cited == ["S1", "S2"]


def test_rejects_missing_or_unknown_markers() -> None:
    assert validate_citations("No marker.", [_source("S1")])[0] is False
    assert validate_citations("Unknown [S9].", [_source("S1")])[0] is False
    assert (
        validate_citations(
            "First supported claim [S1]. A second claim has no marker.",
            [_source("S1")],
        )[0]
        is False
    )
    assert extract_citations("Repeated [S1] and [S1].") == ["S1"]
