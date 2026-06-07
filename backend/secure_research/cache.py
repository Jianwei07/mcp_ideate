from __future__ import annotations

import json
import time
from pathlib import Path

from .models import NormalizedPage
from .security import resolve_within_root


CACHE_FILE = "notion-corpus.json"


def load_cached_pages(
    root: Path, ttl_seconds: int
) -> list[NormalizedPage] | None:
    path = resolve_within_root(root, CACHE_FILE)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        age = time.time() - float(payload["fetched_at"])
        if age > ttl_seconds:
            return None
        return [
            NormalizedPage.model_validate(page)
            for page in payload.get("pages", [])
        ]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def save_cached_pages(root: Path, pages: list[NormalizedPage]) -> None:
    path = resolve_within_root(root, CACHE_FILE)
    temporary = resolve_within_root(root, f"{CACHE_FILE}.tmp")
    payload = {
        "fetched_at": time.time(),
        "pages": [page.model_dump(mode="json") for page in pages],
    }
    temporary.write_text(
        json.dumps(payload, separators=(",", ":")), encoding="utf-8"
    )
    temporary.replace(path)
