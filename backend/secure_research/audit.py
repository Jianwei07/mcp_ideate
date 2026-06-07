from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Any


class JsonlAuditLog:
    def __init__(
        self,
        directory: Path,
        *,
        max_bytes: int = 5 * 1024 * 1024,
        backups: int = 3,
    ) -> None:
        self.directory = directory
        self.path = directory / "research-audit.jsonl"
        self.max_bytes = max_bytes
        self.backups = backups
        self._lock = Lock()

    def append(self, record: dict[str, Any]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(record, separators=(",", ":"), sort_keys=True)
        with self._lock:
            self._rotate_if_needed(len(payload) + 1)
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(payload)
                handle.write("\n")

    def _rotate_if_needed(self, incoming_bytes: int) -> None:
        if not self.path.exists():
            return
        if self.path.stat().st_size + incoming_bytes <= self.max_bytes:
            return

        oldest = self.path.with_suffix(f".jsonl.{self.backups}")
        if oldest.exists():
            oldest.unlink()
        for index in range(self.backups - 1, 0, -1):
            source = self.path.with_suffix(f".jsonl.{index}")
            if source.exists():
                source.replace(self.path.with_suffix(f".jsonl.{index + 1}"))
        self.path.replace(self.path.with_suffix(".jsonl.1"))
