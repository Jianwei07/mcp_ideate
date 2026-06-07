from __future__ import annotations

import asyncio
from collections import deque
from typing import Any

import httpx

from .models import NormalizedBlock, NormalizedPage


TEXT_BLOCK_TYPES = {
    "bookmark",
    "bulleted_list_item",
    "callout",
    "code",
    "equation",
    "heading_1",
    "heading_2",
    "heading_3",
    "heading_4",
    "numbered_list_item",
    "paragraph",
    "quote",
    "table_row",
    "to_do",
    "toggle",
}


class NotionClient:
    def __init__(
        self,
        token: str,
        root_page_id: str,
        *,
        base_url: str = "https://api.notion.com",
        version: str = "2026-03-11",
        max_pages: int = 30,
        max_blocks: int = 3000,
    ) -> None:
        self.root_page_id = _compact_id(root_page_id)
        self.base_url = base_url.rstrip("/")
        self.max_pages = max_pages
        self.max_blocks = max_blocks
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": version,
            "Content-Type": "application/json",
        }

    async def fetch_page_tree(self) -> list[NormalizedPage]:
        pages: list[NormalizedPage] = []
        queued: deque[str] = deque([self.root_page_id])
        seen: set[str] = set()
        block_count = 0

        async with httpx.AsyncClient(
            headers=self.headers, timeout=30.0
        ) as client:
            while queued:
                page_id = queued.popleft()
                if page_id in seen:
                    continue
                if len(seen) >= self.max_pages:
                    raise RuntimeError("Notion page limit exceeded")
                seen.add(page_id)

                page_data = await self._request(
                    client, f"/v1/pages/{page_id}"
                )
                title = _page_title(page_data)
                url = page_data.get("url") or _page_url(page_id)
                blocks, child_pages = await self._walk_container(
                    client, page_id
                )
                block_count += len(blocks)
                if block_count > self.max_blocks:
                    raise RuntimeError("Notion block limit exceeded")
                pages.append(
                    NormalizedPage(
                        page_id=page_id,
                        title=title,
                        url=url,
                        blocks=blocks,
                    )
                )
                queued.extend(
                    child_id
                    for child_id in child_pages
                    if child_id not in seen
                )
        return pages

    async def _walk_container(
        self, client: httpx.AsyncClient, container_id: str
    ) -> tuple[list[NormalizedBlock], list[str]]:
        normalized: list[NormalizedBlock] = []
        child_pages: list[str] = []
        blocks = await self._list_children(client, container_id)

        for block in blocks:
            block_id = _compact_id(block["id"])
            block_type = block.get("type", "unsupported")
            if block_type == "child_page":
                child_pages.append(block_id)
                continue

            text = _block_text(block)
            if text:
                normalized.append(
                    NormalizedBlock(
                        block_id=block_id,
                        block_type=block_type,
                        text=text,
                        heading_level=_heading_level(block_type),
                    )
                )

            if block.get("has_children"):
                nested, nested_pages = await self._walk_container(
                    client, block_id
                )
                normalized.extend(nested)
                child_pages.extend(nested_pages)
        return normalized, child_pages

    async def _list_children(
        self, client: httpx.AsyncClient, block_id: str
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        cursor: str | None = None
        while True:
            params: dict[str, Any] = {"page_size": 100}
            if cursor:
                params["start_cursor"] = cursor
            data = await self._request(
                client,
                f"/v1/blocks/{block_id}/children",
                params=params,
            )
            results.extend(data.get("results", []))
            if not data.get("has_more"):
                return results
            cursor = data.get("next_cursor")

    async def _request(
        self,
        client: httpx.AsyncClient,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        for attempt in range(4):
            response = await client.get(
                f"{self.base_url}{path}", params=params
            )
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == 3:
                    response.raise_for_status()
                retry_after = float(response.headers.get("Retry-After", "1"))
                await asyncio.sleep(min(retry_after, 4.0))
                continue
            response.raise_for_status()
            return response.json()
        raise RuntimeError("Notion request failed after retries")


def _compact_id(value: str) -> str:
    return value.replace("-", "").strip()


def _page_url(page_id: str) -> str:
    return f"https://www.notion.so/{_compact_id(page_id)}"


def _page_title(page: dict[str, Any]) -> str:
    for property_value in page.get("properties", {}).values():
        if property_value.get("type") == "title":
            text = _rich_text(property_value.get("title", []))
            if text:
                return text
    return "Untitled Notion page"


def _heading_level(block_type: str) -> int | None:
    if not block_type.startswith("heading_"):
        return None
    try:
        return int(block_type.rsplit("_", 1)[1])
    except ValueError:
        return None


def _block_text(block: dict[str, Any]) -> str:
    block_type = block.get("type", "")
    if block_type not in TEXT_BLOCK_TYPES:
        return ""
    value = block.get(block_type, {})
    if block_type == "equation":
        return value.get("expression", "")
    if block_type == "table_row":
        return " | ".join(_rich_text(cell) for cell in value.get("cells", []))
    return _rich_text(value.get("rich_text", []))


def _rich_text(items: list[dict[str, Any]]) -> str:
    return "".join(item.get("plain_text", "") for item in items).strip()
