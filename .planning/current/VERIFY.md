# Verify

## 2026-06-07

- `cd backend && bun test client/tests/mcp-connection.test.ts`: pass, 1 test.
- `cd backend && bun run typecheck:client`: pass.
- `cd backend && bun run lint:client`: pass.
- `cd backend && bun test client/tests`: pass, 1 test.
- `cd backend && bun run format:check`: fail on pre-existing formatting drift outside the new
  MCP connection slice.

Spec state:

- `01` marked complete from handoff-recorded verification.
- `02` marked complete from handoff-recorded verification.
- `03` remains incomplete; only the first MCP connection tracer-bullet is done.

## Layout Restructure

- New spec `07` added to move the Bun workspace into `backend/`.
- `cd backend && bun install`: pass.
- `cd backend && bun run typecheck`: pass.
- `cd backend && bun test server/tests`: pass, 4 tests.
- `cd backend && bun test client/tests`: pass, 1 test.
- `cd backend && bun run lint`: pass.
- `cd backend && bun run format:check`: pass.
- `cd backend && bun run build`: pass, builds `frontend/`.
- `cd backend && bun run db:migrate`: pass, migrations read from `backend/db/`.
- `cd backend && bun run check`: pass, 5 tests.
- Spec `07` marked complete after verification.

## Host Startup Fix

- `cd backend && bun run start`: pass; host starts and stays running.
- `cd backend && bun run dev`: pass; supervisor reaches host startup without the
  missing `client/src/host/index.ts` crash.
- `cd backend && bun run check`: pass after adding the minimal host entry.

## Host API And UI Fixes

- `cd backend && bun test client/tests`: pass; host metadata endpoint covered.
- `cd backend && bun run typecheck`: pass after host API/SSE wiring.
- `cd backend && bun run --cwd ../frontend build`: pass after Enter-key and
  runtime-label UI changes.
- `cd backend && bun run dev`: pass; supervisor reaches host startup and stays
  running.
- `cd backend && bun run check`: pass, 6 tests.

## Resilient Host Run Lifecycle

- `cd backend && bun test client/tests server/tests`: pass; greeting queries are
  rejected before run startup and shared greeting detection is covered.
- `cd backend && bun run typecheck`: pass after SSE heartbeat, timeout, and
  terminal-state changes.
- `cd backend && bun run --cwd ../frontend build`: pass after EventSource and
  cancel-state fixes.
- `cd backend && bun run check`: pass, 8 tests.
- `cd backend && bun run dev`: pass; supervisor reaches host startup and stays
  running. The command timeout is expected for the long-running dev server.

## Python Runtime Removal

- Removed legacy backend Python runtime files under `backend/secure_research/`,
  backend Python tests, `backend/client.py`, `backend/server.py`,
  `backend/pyproject.toml`, and `backend/uv.lock`.
- Backend Python search: no `backend/**/*.py`, `backend/**/pyproject.toml`, or
  `backend/**/uv.lock` files remain.
- Stale Python/FastAPI/uv reference search: remaining matches are only under the
  separate `roots_sample/` course sample.
- `cd backend && bun run check`: pass, 8 tests.

## Client Run Engine

- Added sampling approval broker and host approval endpoints.
- Added real stdio integration test that starts the Bun MCP server against fake
  Notion and proves inference delegates back to client-side sampling.
- Fixed interrupted-turn recovery to update only non-terminal states.
- `cd backend && bun test client/tests server/tests`: pass, 10 tests.
- `cd backend && bun run typecheck`: pass.
- `cd frontend && bun run build`: pass.
- `cd backend && bun run lint:client`: pass.
- `cd backend && bun run format:check`: pass.

## Sessions And React Console

- Added persisted session APIs, SSE replay, volatile detail endpoint, session
  restart tests, citation excerpt omission tests, and JSONL detail omission tests.
- Added React session sidebar, thinking toggle, sampling approval card, clickable
  trace details, metrics, replay, and session result inspection.
- `cd backend && bun test client/tests`: pass, 9 tests.
- `cd backend && bun run typecheck`: pass.
- `cd backend && bun run lint:client`: pass.
- `cd backend && bun run format:check`: pass.
- `cd frontend && bun run build`: pass.

## Final Cutover

- Added root `TESTS.md` with full and sliced verification commands.
- Updated root and backend READMEs to document Bun as the canonical runtime and
  `cd backend && bun run check` as the cutover gate.
- `cd backend && bun run check`: pass, 14 tests, frontend build included.
- `cd backend && bun run dev`: reaches healthy supervisor startup; timeout is
  expected because the dev server is long-running.
- Backend stale runtime search: no `backend/**/*.py`, `backend/**/pyproject.toml`,
  or `backend/**/uv.lock` files remain.
- Stale Python/FastAPI/Gemma backend references: none outside historical
  verification notes and the separate `roots_sample/` course sample.
