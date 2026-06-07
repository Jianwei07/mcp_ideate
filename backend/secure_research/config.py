from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_DIR = Path(__file__).resolve().parents[1]
REPOSITORY_DIR = PROJECT_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    notion_token: str = ""
    notion_root_page_id: str = ""
    notion_base_url: str = "https://api.notion.com"
    notion_version: str = "2026-03-11"
    notion_cache_ttl_seconds: int = 300
    notion_max_pages: int = 30
    notion_max_blocks: int = 3000

    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "gemma4:12b-it-q4_K_M"
    ollama_timeout_seconds: float = 180.0
    ollama_context_tokens: int = 8192
    ollama_max_output_tokens: int = 1200
    ollama_keep_alive: str = "5m"

    audit_dir: Path = Field(default=PROJECT_DIR / "runtime" / "audit")
    frontend_dist: Path = Field(default=REPOSITORY_DIR / "frontend" / "dist")
    host: str = "127.0.0.1"
    port: int = 8000
    skip_startup_preflight: bool = False

    def require_server_credentials(self) -> None:
        missing: list[str] = []
        if not self.notion_token.strip():
            missing.append("NOTION_TOKEN")
        if not self.notion_root_page_id.strip():
            missing.append("NOTION_ROOT_PAGE_ID")
        if missing:
            joined = ", ".join(missing)
            raise RuntimeError(
                f"Missing required server configuration: {joined}. "
                "Copy .env.example to .env and configure the read-only Notion integration."
            )
