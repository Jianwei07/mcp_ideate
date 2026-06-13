# Stack

Analysis date: 2026-06-07

## Current Runtime

- Bun 1.3 or newer for backend host, MCP server, tests, and package management.
- MCP TypeScript SDK `1.29.0`.
- Biome for backend lint and format checks.
- React 19 and TypeScript in `frontend/`.
- Vite 7 and Tailwind CSS 4 for frontend development.

## Current Data

- Drizzle ORM with Bun's native SQLite driver.
- SQLite database in `backend/runtime/research.db`.
- JSONL metadata audit in `backend/runtime/audit/`.
- Temporary filesystem cache provided through MCP roots.

## Configuration Names

- Server: `NOTION_TOKEN`, `NOTION_ROOT_PAGE_ID`, `NOTION_BASE_URL`.
- Client: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_CONTEXT_TOKENS`.
- Host: `HOST`, `PORT`, `DATABASE_PATH`, `AUDIT_DIR`.
