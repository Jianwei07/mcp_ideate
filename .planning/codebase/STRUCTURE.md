# Structure

## Current Top Level

- `backend/`: Bun backend workspace.
- `frontend/`: React/Vite browser application.
- `roots_sample/`: unchanged course reference.
- `AGENTS.md`: repository execution and architecture rules.

## Current Placement

- Add Bun MCP server behavior under `backend/server/src/`.
- Add Bun host lifecycle behavior under `backend/client/src/host/` and
  `backend/client/src/mcp/`.
- Add persistence behavior under `backend/client/src/persistence/` using
  migrations in `backend/db/`.
- Add UI behavior in `frontend/src/`.
- Legacy Python backend runtime has been removed during Bun cutover.

## Placement

- `backend/client/src/host/`: Bun HTTP API and MCP lifecycle.
- `backend/client/src/runs/`: RunEngine, approval, and transcript behavior.
- `backend/client/src/model/`: Ollama Adapter.
- `backend/client/src/persistence/`: Drizzle schema and storage.
- `backend/client/tests/`: host behavior tests.
- `backend/server/src/tools/`: MCP tools.
- `backend/server/src/notion/`: protected Notion Adapter.
- `backend/server/src/retrieval/`: normalization, ranking, and citations.
- `backend/server/src/security/`: roots, allowlist, and redaction.
- `backend/server/tests/`: MCP server behavior tests.
- `backend/contracts/`: shared Zod wire Interfaces only.
- `backend/db/`: Drizzle migrations.
- `backend/scripts/`: local lifecycle and database commands.
- `frontend/src/`: React browser implementation.

Generated backend runtime data belongs under `backend/runtime/` and is ignored.
