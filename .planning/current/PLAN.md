# Plan: Secure MCP AI Ops Foundation

## Objective

Migrate the existing POC to one backend Bun workspace where `bun dev` starts a
customer-side MCP host and its independent protected-data stdio server, while
preserving sampling, roots, logging, progress, citations, cancellation, and
security behavior.

## Context

- `AGENTS.md`
- `backend/client/`, `backend/server/`, `backend/contracts/`
- `frontend/src/`
- `.planning/spec/specs.json`

## Must-Haves

- One `bun dev` starts prerequisites, migrations, host, UI, and MCP server.
- The UI transcript is derived from real MCP, model, and application events.
- Sampling pauses for explicit approval and Ollama runs only in the client.
- Server access is fixed to the configured Notion root and temporary MCP root.
- SQLite and JSONL persist only approved conversation and metadata fields.
- Failures expose safe diagnostics in the UI and full cause chains on stderr.
- All Bun quality gates and integration tests pass before completing cutover.

## Tasks

| Task | Files | Action | Verify | Done |
|---|---|---|---|---|
| Workspace | `backend/package.json`, `backend/contracts/`, `backend/scripts/`, `backend/db/` | Add backend Bun workspace, contracts, schema, quality commands, and supervisor | `cd backend && bun run typecheck` | Backend commands and schema work |
| Server | `backend/server/src/`, `backend/server/tests/` | Port secure research MCP server and behavior tests | `cd backend && bun test server/tests` | Server performs no inference |
| Host | `backend/client/src/host/`, `backend/client/src/runs/`, `backend/client/src/model/` | Add MCP connection, approval-controlled sampling, transcript recording, and Ollama | `cd backend && bun test client/tests` | Full stdio flow works |
| Persistence/API | `backend/client/src/persistence/`, host routes | Add sessions, turns, SSE replay, audit, recovery, and errors | `cd backend && bun test client/tests` | History and safe audit work |
| UI | `frontend/src/` | Add session console, transcript details, approval, citations, and metrics | `cd frontend && bun run build` | Browser flow is complete |
| Cutover | docs, tests, legacy paths | Verify, document, and remove superseded Python runtime after parity | `cd backend && bun run check` | Bun is canonical |

## Risks / Checkpoints

- Stop deletion if behavior parity or Bun integration verification fails.
- Never copy `.env` values into planning, tests, logs, or client code.
- Keep raw protected content in volatile memory only.

Quality gates:
- FE build: `cd frontend && bun run build`
- Backend client lint: `cd backend && bun run lint:client`
- Backend format check: `cd backend && bun run format:check`
- Backend client typecheck: `cd backend && bun run typecheck:client`
- Backend client test: `cd backend && bun test client/tests`
- Backend server lint: `cd backend && bun run lint:server`
- Backend server typecheck: `cd backend && bun run typecheck:server`
- Backend server test: `cd backend && bun test server/tests`
Tests policy: tests under tests/; update TESTS.md when non-trivial.
Commit checkpoints:
- Needed: yes
- Slice 1: workspace, contracts, persistence schema | files: `backend/{contracts,db,scripts}/**` | verify: `cd backend && bun run typecheck`
- Slice 2: secure server | files: `backend/server/**` | verify: `cd backend && bun test server/tests`
- Slice 3: MCP host and model | files: `backend/client/src/{host,runs,model}/**` | verify: `cd backend && bun test client/tests`
- Slice 4: persistence, API, UI | files: `backend/client/**`, `frontend/**` | verify: `cd backend && bun test client/tests && bun run build`
- Slice 5: cutover and docs | files: docs, legacy paths | verify: `cd backend && bun run check`
Execution gate: OPEN by explicit user authorization.
