from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from collections.abc import Awaitable, Callable
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters, types
from mcp.client.session import RequestContext
from mcp.client.stdio import stdio_client
from pydantic import FileUrl

from .config import PROJECT_DIR, Settings
from .models import ResearchResult
from .ollama import OllamaClient
from .security import CACHE_ROOT_NAME


EventSink = Callable[
    [str, str, str, dict[str, Any]], Awaitable[None]
]


class MCPResearchClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.ollama = OllamaClient(
            settings.ollama_base_url,
            settings.ollama_model,
            settings.ollama_timeout_seconds,
            settings.ollama_context_tokens,
            settings.ollama_max_output_tokens,
            settings.ollama_keep_alive,
        )
        self._stack = AsyncExitStack()
        self._session: ClientSession | None = None
        self._cache_directory: tempfile.TemporaryDirectory[str] | None = None
        self._event_sink: EventSink | None = None
        self._run_lock = asyncio.Lock()

    async def connect(self) -> None:
        if self._session is not None:
            return
        self.settings.require_server_credentials()
        self._stack = AsyncExitStack()
        self._cache_directory = tempfile.TemporaryDirectory(
            prefix="secure-research-cache-"
        )
        server_script = PROJECT_DIR / "server.py"
        env = os.environ.copy()
        env.update(
            {
                "NOTION_TOKEN": self.settings.notion_token,
                "NOTION_ROOT_PAGE_ID": self.settings.notion_root_page_id,
                "NOTION_BASE_URL": self.settings.notion_base_url,
                "NOTION_VERSION": self.settings.notion_version,
                "NOTION_CACHE_TTL_SECONDS": str(
                    self.settings.notion_cache_ttl_seconds
                ),
                "NOTION_MAX_PAGES": str(self.settings.notion_max_pages),
                "NOTION_MAX_BLOCKS": str(self.settings.notion_max_blocks),
            }
        )
        parameters = StdioServerParameters(
            command=sys.executable,
            args=[str(server_script)],
            cwd=PROJECT_DIR,
            env=env,
        )
        try:
            read_stream, write_stream = await self._stack.enter_async_context(
                stdio_client(parameters)
            )
            self._session = await self._stack.enter_async_context(
                ClientSession(
                    read_stream,
                    write_stream,
                    sampling_callback=self._sampling_callback,
                    list_roots_callback=self._list_roots_callback,
                    logging_callback=self._logging_callback,
                )
            )
            await self._session.initialize()
        except BaseException:
            await self._stack.aclose()
            self._session = None
            if self._cache_directory is not None:
                self._cache_directory.cleanup()
                self._cache_directory = None
            raise

    async def close(self) -> None:
        await self._stack.aclose()
        self._stack = AsyncExitStack()
        self._session = None
        if self._cache_directory is not None:
            self._cache_directory.cleanup()
            self._cache_directory = None

    async def research(
        self, query: str, event_sink: EventSink
    ) -> ResearchResult:
        if self._session is None:
            raise RuntimeError("MCP client is not connected")
        async with self._run_lock:
            self._event_sink = event_sink
            try:
                await self._emit(
                    "mcp",
                    "Calling the research tool over stdio",
                    "info",
                    {"transport": "stdio", "tool": "research"},
                )
                result = await self._session.call_tool(
                    "research",
                    arguments={"query": query},
                    progress_callback=self._progress_callback,
                )
                if result.isError:
                    message = _first_text(result) or "MCP tool call failed"
                    raise RuntimeError(message)
                if result.structuredContent is not None:
                    return ResearchResult.model_validate(
                        result.structuredContent
                    )
                text = _first_text(result)
                if not text:
                    raise RuntimeError("MCP tool returned no result")
                return ResearchResult.model_validate_json(text)
            finally:
                self._event_sink = None

    async def _sampling_callback(
        self,
        context: RequestContext[ClientSession, Any],
        params: types.CreateMessageRequestParams,
    ) -> types.CreateMessageResult:
        await self._emit(
            "sampling",
            "MCP server requested client-side inference",
            "info",
            {
                "model": self.settings.ollama_model,
                "message_count": len(params.messages),
                "max_tokens": params.maxTokens,
            },
        )
        sampled = await self.ollama.sample(params)
        await self._emit(
            "sampling",
            "Local model inference completed",
            "info",
            {"model": self.settings.ollama_model, "status": sampled.status},
        )
        return types.CreateMessageResult(
            role="assistant",
            model=self.settings.ollama_model,
            content=types.TextContent(
                type="text",
                text=sampled.model_dump_json(),
            ),
            stopReason="endTurn",
        )

    async def _list_roots_callback(
        self, context: RequestContext[ClientSession, Any]
    ) -> types.ListRootsResult:
        if self._cache_directory is None:
            return types.ListRootsResult(roots=[])
        root_path = Path(self._cache_directory.name).resolve()
        await self._emit(
            "roots",
            "Granted the MCP server a temporary cache root",
            "info",
            {"root_name": CACHE_ROOT_NAME},
        )
        return types.ListRootsResult(
            roots=[
                types.Root(
                    uri=FileUrl(root_path.as_uri()),
                    name=CACHE_ROOT_NAME,
                )
            ]
        )

    async def _logging_callback(
        self, params: types.LoggingMessageNotificationParams
    ) -> None:
        data = params.data if isinstance(params.data, dict) else {}
        stage = str(data.get("stage") or params.logger or "server")
        safe_data = {
            key: value
            for key, value in data.items()
            if key
            in {
                "cache_hit",
                "page_count",
                "chunk_count",
                "selected_count",
                "selected_sources",
                "source_count",
                "citation_valid",
                "cited_source_ids",
            }
        }
        message = str(data.get("msg") or data.get("message") or params.data)
        await self._emit(stage, message, _level(params.level), safe_data)

    async def _progress_callback(
        self, progress: float, total: float | None, message: str | None
    ) -> None:
        percentage = (
            round((progress / total) * 100, 1)
            if total and total > 0
            else None
        )
        await self._emit(
            "progress",
            message or "Research progress updated",
            "info",
            {"progress": progress, "total": total, "percentage": percentage},
        )

    async def _emit(
        self,
        stage: str,
        message: str,
        level: str,
        data: dict[str, Any],
    ) -> None:
        if self._event_sink is not None:
            await self._event_sink(stage, message, level, data)


def _first_text(result: types.CallToolResult) -> str | None:
    for content in result.content:
        if isinstance(content, types.TextContent):
            return content.text
    return None


def _level(level: str) -> str:
    if level in {"warning", "error"}:
        return level
    return "debug" if level == "debug" else "info"
