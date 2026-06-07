from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .audit import JsonlAuditLog
from .config import Settings
from .mcp_client import MCPResearchClient
from .models import TraceEvent


TERMINAL_TYPES = {"result", "error", "cancelled"}


class RunRequest(BaseModel):
    query: str = Field(min_length=3, max_length=500)


class RunCreated(BaseModel):
    run_id: str
    events_url: str


@dataclass
class RunState:
    run_id: str
    query_hash: str
    audit: JsonlAuditLog
    status: Literal["running", "complete", "error", "cancelled"] = "running"
    sequence: int = 0
    started_at: float = field(default_factory=time.monotonic)
    events: asyncio.Queue[TraceEvent] = field(default_factory=asyncio.Queue)
    task: asyncio.Task[None] | None = None

    async def emit(
        self,
        event_type: Literal["trace", "result", "error", "cancelled"],
        stage: str,
        message: str,
        level: Literal["debug", "info", "warning", "error"] = "info",
        data: dict[str, Any] | None = None,
    ) -> None:
        self.sequence += 1
        event = TraceEvent(
            sequence=self.sequence,
            run_id=self.run_id,
            type=event_type,
            stage=stage,
            level=level,
            message=message,
            data=data or {},
        )
        await self.events.put(event)
        self.audit.append(_audit_record(event, self.query_hash))


class RunManager:
    def __init__(
        self,
        client: MCPResearchClient,
        audit: JsonlAuditLog,
        model: str,
    ) -> None:
        self.client = client
        self.audit = audit
        self.model = model
        self.runs: dict[str, RunState] = {}
        self.active_run_id: str | None = None
        self._lock = asyncio.Lock()

    async def create(self, query: str) -> RunState:
        async with self._lock:
            active = self.active()
            if active is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A research run is already active",
                )
            run_id = uuid.uuid4().hex
            state = RunState(
                run_id=run_id,
                query_hash=hashlib.sha256(query.encode("utf-8")).hexdigest(),
                audit=self.audit,
            )
            self.runs[run_id] = state
            self.active_run_id = run_id
            state.task = asyncio.create_task(self._execute(state, query))
            self._trim_history()
            return state

    def active(self) -> RunState | None:
        if self.active_run_id is None:
            return None
        state = self.runs.get(self.active_run_id)
        if state is None or state.status != "running":
            return None
        return state

    def get(self, run_id: str) -> RunState:
        state = self.runs.get(run_id)
        if state is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return state

    async def cancel(self, run_id: str) -> None:
        state = self.get(run_id)
        if state.status != "running" or state.task is None:
            raise HTTPException(status_code=409, detail="Run is not active")
        state.task.cancel()

    async def _execute(self, state: RunState, query: str) -> None:
        await state.emit(
            "trace",
            "request",
            "Research run accepted",
            data={"model": self.model, "transport": "stdio"},
        )
        try:
            result = await self.client.research(
                query,
                lambda stage, message, level, data: state.emit(
                    "trace",
                    stage,
                    message,
                    _trace_level(level),
                    data,
                ),
            )
            state.status = "complete"
            duration_ms = round(
                (time.monotonic() - state.started_at) * 1000
            )
            await state.emit(
                "result",
                "complete",
                "Research run completed",
                data={
                    "duration_ms": duration_ms,
                    "result": result.model_dump(mode="json"),
                },
            )
        except asyncio.CancelledError:
            state.status = "cancelled"
            duration_ms = round(
                (time.monotonic() - state.started_at) * 1000
            )
            await asyncio.shield(
                state.emit(
                    "cancelled",
                    "cancelled",
                    "Research run cancelled",
                    "warning",
                    {"duration_ms": duration_ms},
                )
            )
        except Exception as exc:
            state.status = "error"
            duration_ms = round(
                (time.monotonic() - state.started_at) * 1000
            )
            await state.emit(
                "error",
                "error",
                "Research run failed",
                "error",
                {
                    "duration_ms": duration_ms,
                    "error_type": type(exc).__name__,
                    "display_message": _safe_error_message(exc),
                },
            )
        finally:
            if self.active_run_id == state.run_id:
                self.active_run_id = None

    def _trim_history(self) -> None:
        completed = [
            state
            for state in self.runs.values()
            if state.status != "running"
        ]
        completed.sort(key=lambda item: item.started_at)
        for state in completed[:-19]:
            self.runs.pop(state.run_id, None)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.require_server_credentials()
        audit = JsonlAuditLog(settings.audit_dir)
        client = MCPResearchClient(settings)
        if not settings.skip_startup_preflight:
            await client.ollama.preflight()
        await client.connect()
        app.state.settings = settings
        app.state.client = client
        app.state.runs = RunManager(client, audit, settings.ollama_model)
        try:
            yield
        finally:
            active = app.state.runs.active()
            if active is not None and active.task is not None:
                active.task.cancel()
                await asyncio.gather(active.task, return_exceptions=True)
            await client.close()

    app = FastAPI(
        title="Secure MCP Research",
        version="0.1.0",
        lifespan=lifespan,
    )

    @app.get("/api/health")
    async def health(request: Request) -> dict[str, Any]:
        active = request.app.state.runs.active()
        return {
            "status": "ok",
            "transport": "stdio",
            "model": settings.ollama_model,
            "active_run_id": active.run_id if active else None,
        }

    @app.post("/api/runs", response_model=RunCreated, status_code=202)
    async def create_run(payload: RunRequest, request: Request) -> RunCreated:
        state = await request.app.state.runs.create(payload.query.strip())
        return RunCreated(
            run_id=state.run_id,
            events_url=f"/api/runs/{state.run_id}/events",
        )

    @app.get("/api/runs/{run_id}/events")
    async def run_events(run_id: str, request: Request) -> StreamingResponse:
        state = request.app.state.runs.get(run_id)
        return StreamingResponse(
            _stream_events(state),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    @app.delete("/api/runs/{run_id}", status_code=204)
    async def cancel_run(run_id: str, request: Request) -> Response:
        await request.app.state.runs.cancel(run_id)
        return Response(status_code=204)

    _mount_frontend(app, settings.frontend_dist)
    return app


async def _stream_events(state: RunState) -> AsyncIterator[str]:
    while True:
        event = await state.events.get()
        yield f"data: {event.model_dump_json()}\n\n"
        if event.type in TERMINAL_TYPES:
            return


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    assets = dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend(path: str):
        index = dist / "index.html"
        requested = (dist / path).resolve()
        if path and requested.is_relative_to(dist.resolve()) and requested.is_file():
            return FileResponse(requested)
        if index.exists():
            return FileResponse(index)
        raise HTTPException(
            status_code=503,
            detail=(
                "Frontend is not built. From the repository root, run "
                "`cd frontend && bun install && bun run build`."
            ),
        )


def _audit_record(event: TraceEvent, query_hash: str) -> dict[str, Any]:
    safe_data: dict[str, Any] = {}
    allowed = {
        "cache_hit",
        "page_count",
        "chunk_count",
        "selected_count",
        "selected_sources",
        "source_count",
        "citation_valid",
        "cited_source_ids",
        "duration_ms",
        "error_type",
        "model",
        "transport",
        "tool",
        "percentage",
        "progress",
        "total",
        "root_name",
        "status",
        "message_count",
        "max_tokens",
    }
    for key, value in event.data.items():
        if key in allowed:
            safe_data[key] = value

    result = event.data.get("result")
    if isinstance(result, dict):
        safe_data.update(
            {
                "result_status": result.get("status"),
                "citation_valid": result.get("citation_valid"),
                "cited_source_ids": result.get("cited_source_ids", []),
                "source_block_ids": [
                    block_id
                    for source in result.get("sources", [])
                    for block_id in source.get("block_ids", [])
                ],
            }
        )

    return {
        "timestamp": event.timestamp,
        "run_id": event.run_id,
        "query_sha256": query_hash,
        "sequence": event.sequence,
        "type": event.type,
        "stage": event.stage,
        "level": event.level,
        "message": event.message,
        "data": safe_data,
    }


def _safe_error_message(exc: Exception) -> str:
    text = str(exc)
    allowed_fragments = (
        "Ollama",
        "Notion",
        "MCP",
        "citation",
        "configuration",
        "root",
        "model",
    )
    if any(fragment.lower() in text.lower() for fragment in allowed_fragments):
        return text[:300]
    return "The run failed. Check the local server log for details."


def _trace_level(
    level: str,
) -> Literal["debug", "info", "warning", "error"]:
    if level in {"debug", "warning", "error"}:
        return level
    return "info"


def main() -> None:
    settings = Settings()
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
