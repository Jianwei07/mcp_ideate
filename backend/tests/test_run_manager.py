import asyncio
from pathlib import Path

import pytest

from secure_research.audit import JsonlAuditLog
from secure_research.web import RunManager


class SlowClient:
    async def research(self, query, event_sink):
        await event_sink("sampling", "Waiting for model", "info", {})
        await asyncio.sleep(30)


@pytest.mark.asyncio
async def test_active_run_can_be_cancelled(tmp_path: Path) -> None:
    manager = RunManager(
        SlowClient(),  # type: ignore[arg-type]
        JsonlAuditLog(tmp_path),
        "test-model",
    )
    state = await manager.create("valid question")
    await asyncio.sleep(0)
    await manager.cancel(state.run_id)
    await asyncio.wait_for(state.task, timeout=1)

    assert state.status == "cancelled"
    terminal = await state.events.get()
    while terminal.type == "trace":
        terminal = await state.events.get()
    assert terminal.type == "cancelled"
