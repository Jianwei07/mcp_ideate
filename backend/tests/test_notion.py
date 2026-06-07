import httpx
import pytest

from secure_research.notion import NotionClient


@pytest.mark.asyncio
async def test_follows_only_child_pages_discovered_under_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(request.url.path)
        responses = {
            "/v1/pages/root": {
                "id": "root",
                "url": "https://notion.example/root",
                "properties": {
                    "title": {
                        "type": "title",
                        "title": [{"plain_text": "Root"}],
                    }
                },
            },
            "/v1/blocks/root/children": {
                "results": [
                    {
                        "id": "p1",
                        "type": "paragraph",
                        "has_children": False,
                        "paragraph": {
                            "rich_text": [{"plain_text": "Root evidence"}]
                        },
                    },
                    {
                        "id": "child",
                        "type": "child_page",
                        "has_children": True,
                        "child_page": {"title": "Child"},
                    },
                ],
                "has_more": False,
                "next_cursor": None,
            },
            "/v1/pages/child": {
                "id": "child",
                "url": "https://notion.example/child",
                "properties": {
                    "title": {
                        "type": "title",
                        "title": [{"plain_text": "Child"}],
                    }
                },
            },
            "/v1/blocks/child/children": {
                "results": [
                    {
                        "id": "p2",
                        "type": "paragraph",
                        "has_children": False,
                        "paragraph": {
                            "rich_text": [{"plain_text": "Child evidence"}]
                        },
                    }
                ],
                "has_more": False,
                "next_cursor": None,
            },
        }
        return httpx.Response(200, json=responses[request.url.path])

    transport = httpx.MockTransport(handler)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", client_factory)
    pages = await NotionClient("token", "root").fetch_page_tree()

    assert [page.page_id for page in pages] == ["root", "child"]
    assert "/v1/pages/unrelated" not in requested
