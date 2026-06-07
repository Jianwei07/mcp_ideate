from __future__ import annotations

import asyncio
import socket
from pathlib import Path

import pytest
import uvicorn
from fastapi import FastAPI, Request

from secure_research.config import Settings
from secure_research.mcp_client import MCPResearchClient


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.mark.asyncio
async def test_complete_stdio_sampling_roots_logging_and_progress(
    tmp_path: Path,
) -> None:
    external = FastAPI()
    calls = {"notion": 0, "ollama": 0}

    @external.get("/v1/pages/root")
    async def root_page():
        calls["notion"] += 1
        return {
            "id": "root",
            "url": "https://notion.example/root",
            "properties": {
                "title": {
                    "type": "title",
                    "title": [{"plain_text": "Stanford CS230"}],
                }
            },
        }

    @external.get("/v1/blocks/root/children")
    async def root_children():
        calls["notion"] += 1
        return {
            "results": [
                {
                    "id": "heading",
                    "type": "heading_2",
                    "has_children": False,
                    "heading_2": {
                        "rich_text": [{"plain_text": "Monitoring signals"}]
                    },
                },
                {
                    "id": "paragraph",
                    "type": "paragraph",
                    "has_children": False,
                    "paragraph": {
                        "rich_text": [
                            {
                                "plain_text": (
                                    "Monitor data quality, loss, and model "
                                    "performance throughout development."
                                )
                            }
                        ]
                    },
                },
            ],
            "has_more": False,
            "next_cursor": None,
        }

    @external.get("/api/tags")
    async def ollama_tags():
        return {"models": [{"name": "gemma4:12b-it-q4_K_M"}]}

    @external.post("/api/chat")
    async def ollama_chat(request: Request):
        calls["ollama"] += 1
        payload = await request.json()
        assert payload["model"] == "gemma4:12b-it-q4_K_M"
        assert "Approved evidence" in payload["messages"][-1]["content"]
        return {
            "message": {
                "content": (
                    '{"status":"answered",'
                    '"answer":"Teams should monitor data quality, loss, and '
                    'model performance [S1].",'
                    '"rationale":"S1 directly lists the monitored signals."}'
                )
            }
        }

    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(
            external,
            host="127.0.0.1",
            port=port,
            log_level="error",
        )
    )
    server_task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)

    settings = Settings(
        notion_token="test-token",
        notion_root_page_id="root",
        notion_base_url=f"http://127.0.0.1:{port}",
        ollama_base_url=f"http://127.0.0.1:{port}",
        audit_dir=tmp_path,
    )
    client = MCPResearchClient(settings)
    events: list[tuple[str, str, dict]] = []

    try:
        await client.ollama.preflight()
        await client.connect()
        result = await client.research(
            "What signals should teams monitor?",
            lambda stage, message, level, data: _capture(
                events, stage, message, data
            ),
        )
    finally:
        await client.close()
        server.should_exit = True
        await server_task

    assert result.status == "answered"
    assert result.citation_valid is True
    assert result.cited_source_ids == ["S1"]
    assert calls == {"notion": 2, "ollama": 1}
    stages = {stage for stage, _, _ in events}
    assert {"roots", "retrieval", "sampling", "progress", "validation"} <= stages


async def _capture(events, stage, message, data):
    events.append((stage, message, data))
