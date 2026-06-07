from pathlib import Path
from urllib.parse import unquote, urlparse

from mcp.types import Root


CACHE_ROOT_NAME = "secure-research-cache"


def root_uri_to_path(root: Root) -> Path:
    parsed = urlparse(str(root.uri))
    if parsed.scheme != "file":
        raise ValueError("The research cache root must use a file URI")
    if parsed.netloc not in ("", "localhost"):
        raise ValueError("Remote file roots are not allowed")
    path = Path(unquote(parsed.path)).resolve()
    if not path.exists() or not path.is_dir():
        raise ValueError("The research cache root must be an existing directory")
    return path


def select_cache_root(roots: list[Root]) -> Path:
    for root in roots:
        if root.name == CACHE_ROOT_NAME:
            return root_uri_to_path(root)
    raise ValueError(
        f"Client must provide exactly one approved '{CACHE_ROOT_NAME}' root"
    )


def resolve_within_root(root: Path, relative_name: str) -> Path:
    target = (root / relative_name).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError("Cache path escapes the approved root") from exc
    return target
