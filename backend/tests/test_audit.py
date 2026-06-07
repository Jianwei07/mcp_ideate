import json
from pathlib import Path

import pytest

from secure_research.audit import JsonlAuditLog
from secure_research.web import RunState


@pytest.mark.asyncio
async def test_audit_log_excludes_query_answer_and_excerpts(
    tmp_path: Path,
) -> None:
    audit = JsonlAuditLog(tmp_path)
    state = RunState(
        run_id="run-1",
        query_hash="hash-only",
        audit=audit,
    )
    await state.emit(
        "result",
        "complete",
        "Research run completed",
        data={
            "duration_ms": 81,
            "result": {
                "status": "answered",
                "answer": "Sensitive answer [S1]",
                "rationale": "Sensitive rationale",
                "citation_valid": True,
                "cited_source_ids": ["S1"],
                "sources": [
                    {
                        "block_ids": ["block-1"],
                        "excerpt": "Sensitive note excerpt",
                    }
                ],
            },
        },
    )

    record = json.loads((tmp_path / "research-audit.jsonl").read_text())
    serialized = json.dumps(record)
    assert record["query_sha256"] == "hash-only"
    assert record["data"]["source_block_ids"] == ["block-1"]
    assert "Sensitive answer" not in serialized
    assert "Sensitive rationale" not in serialized
    assert "Sensitive note excerpt" not in serialized
