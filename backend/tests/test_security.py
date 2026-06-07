from pathlib import Path

import pytest
from mcp.types import Root
from pydantic import FileUrl

from secure_research.security import (
    CACHE_ROOT_NAME,
    resolve_within_root,
    select_cache_root,
)


def test_selects_named_file_root(tmp_path: Path) -> None:
    root = Root(uri=FileUrl(tmp_path.as_uri()), name=CACHE_ROOT_NAME)
    assert select_cache_root([root]) == tmp_path.resolve()


def test_rejects_missing_named_root(tmp_path: Path) -> None:
    root = Root(uri=FileUrl(tmp_path.as_uri()), name="unapproved")
    with pytest.raises(ValueError, match="approved"):
        select_cache_root([root])


def test_cache_path_cannot_escape_root(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="escapes"):
        resolve_within_root(tmp_path, "../outside.json")
