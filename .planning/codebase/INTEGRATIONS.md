# Integrations

Analysis date: 2026-06-07

## Notion

- Adapter: `backend/server/src/notion/client.ts`.
- Authentication uses a read-only integration token.
- Runtime scope is fixed by `NOTION_ROOT_PAGE_ID`.
- The adapter walks child pages and blocks.
- Page and block limits prevent unbounded traversal.

## Ollama

- Adapter: `backend/client/src/model/ollama.ts`.
- Local endpoint defaults to `127.0.0.1:11434`.
- The current installed model is `llama3.2:3b`.
- The client performs inference through MCP sampling callbacks.

## MCP

- Transport is stdio.
- Host implementation: `backend/client/src/mcp/connection.ts`.
- Server implementation: `backend/server/src/index.ts`.
- Features exercised: tools, sampling, roots, logging, and progress.

## Browser API

- Bun host creates runs and streams SSE events.
- Vite proxies `/api` during frontend development.

## Persistence And Monitoring

- Metadata-only JSONL audit and Drizzle/SQLite session persistence.
- No authentication because all services bind to localhost.
- No remote deployment, CI, or telemetry integration exists.

## Security Boundary

- The current local process split demonstrates protocol ownership.
- It does not create a real production network trust boundary.
