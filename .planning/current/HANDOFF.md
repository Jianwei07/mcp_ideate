# Handoff: Continue Bun MCP Migration

## Objective

Continue the approved migration to a customer-side Bun MCP host and an
independent protected-data Bun stdio server. The product goal is a secure,
observable MCP foundation that can later expand into AI Ops incident triage.

## Sources Of Truth

- Plan and checkpoints: `.planning/current/PLAN.md`
- Accepted decisions: `.planning/current/DECISIONS.md`
- Checklist: `.planning/current/TODO.md`
- Executable specs: `.planning/spec/specs.json`
- Current architecture map: `.planning/codebase/`
- Repository constraints: `AGENTS.md`

## Completed

- Added backend Bun workspace, one `backend/bun.lock`, strict TypeScript and
  Biome config.
- Added shared Zod contracts in `backend/contracts/`.
- Added Drizzle `bun:sqlite` schema and initial migration in `backend/db/`.
- Added `backend/scripts/dev.ts` supervisor and `backend/scripts/migrate.ts`.
- Added independent MCP server in `backend/server/`:
  - fixed Notion configuration and page-tree retrieval;
  - temporary MCP root enforcement and cache;
  - lexical chunk ranking;
  - MCP logging, progress, and sampling request;
  - claim-level citation validation;
  - no Ollama import or call.
- Added client foundations:
  - configuration and structured error classification;
  - Drizzle session store;
  - metadata-only JSONL audit;
  - volatile transcript recorder;
  - Ollama capability and sampling adapter.
- Added first client MCP connection slice:
  - stdio-capable `McpConnection` Interface;
  - roots, logging, sampling, progress, and JSON-RPC metadata tracing;
  - fake-transport integration test for sampling delegation and research result parsing.
- Completed client run-engine slice:
  - sampling approval broker and host approval endpoints;
  - MCP sampling callback blocks until approve/deny and emits denial metadata;
  - real stdio integration test runs the Bun MCP server against fake Notion and
    proves inference delegates back to client-side sampling;
  - fixed interrupted-turn recovery to update only non-terminal states.
- Completed sessions/transcripts slice:
  - `GET /api/sessions` and `GET /api/sessions/:id` expose persisted sessions;
  - `GET /api/runs/:id/events?after=N` replays persisted transcript events and
    streams active runs;
  - volatile event details are available only while the run is active;
  - persistence tests prove session history survives restart, terminal turns are
    not marked interrupted, citation excerpts stay out of SQLite, and raw details
    stay out of SQLite/JSONL audit.
- Completed React console slice:
  - session sidebar loads persisted sessions and replays selected turn events;
  - composer sends optional thinking requests;
  - sampling approval card approves or denies `/api/runs/:id/sampling`;
  - trace rows are clickable and show masked metadata/detail inspection;
  - metrics include event count, source count, elapsed time, and prompt/output
    token counts when available.
- Completed final cutover:
  - root `TESTS.md`, root README, backend README, planning state, and verification
    evidence updated;
  - full `cd backend && bun run check` passes with 14 tests and frontend build;
  - `cd backend && bun run dev` reaches healthy long-running startup;
  - no backend Python runtime files remain.

## Verified

- `cd backend && bun run typecheck:contracts` passes.
- `cd backend && bun run typecheck:server` passes.
- `cd backend && bun run typecheck:client` passes.
- `cd backend && bun test server/tests` passes: 4 tests.
- `cd backend && bun test client/tests` passes: 1 test.
- `cd backend && bun run lint:client` passes.
- `cd backend && bun run check` passes after host API, SSE lifecycle, and UI
  terminal-state fixes.
- `cd backend && bun test client/tests server/tests` passes: 10 tests.
- `cd backend && bun run typecheck` passes.
- `cd frontend && bun run build` passes.
- `cd backend && bun run lint:client` passes.
- `cd backend && bun run format:check` passes.
- `cd backend && bun test client/tests` passes: 9 tests.
- `cd frontend && bun run build` passes after React console wiring.
- `cd backend && bun run check` passes after final cutover: 14 tests.
- `cd backend && bun run dev` reaches healthy startup; timeout is expected for
  the long-running supervisor.

## Next Implementation Order

1. Run goal-backward verification if desired, then prepare a commit/PR when ready.

## Important Constraints

- Do not read, print, or copy `.env` values.
- Server stdout is MCP framing only; diagnostics go to stderr.
- Persist questions, answers, citations, safe summaries, and usage metrics.
- Never persist Notion excerpts, raw sampling prompts, native thinking, raw
  protocol payloads, credentials, or stack traces.
- `llama3.2:3b` is the current default; Qwen is optional.
- Sessions organize standalone turns and are not conversational model context.
- MCP revision is pinned to `2025-11-25`; label roots, sampling, and logging as
  course features scheduled for deprecation under SEP-2577.
- Legacy backend Python runtime files were removed after Bun verification passed.
- No commit has been made.

## Dirty Tree

Tracked migration modifications:

- `.gitignore`
- `README.md`
- `backend/.env.example`
- `backend/README.md`
- deleted legacy Python backend runtime files

All Bun backend workspace, planning, client, server, contract, migration, and
script files are currently untracked.

## Layout Update

- Root should stay clean: `backend/`, `frontend/`, docs/planning, and course
  reference files only.
- The active Bun workspace root is `backend/`.
- Backend internals live under `backend/client/`, `backend/server/`,
  `backend/contracts/`, `backend/db/`, and `backend/scripts/`.
- Root-level `package.json`, `bun.lock`, `node_modules/`, `client/`, `server/`,
  `packages/`, `drizzle/`, and `scripts/` should not be recreated.

## Suggested Skills

- `jayden-skills:jayden-workflow`
- `jayden-skills:tdd`
- `emil-design-eng` and `design-taste-frontend` for the transcript UI

Skills used:

- `jayden-workflow`
- `tdd`

Workflow gate: execution was explicitly authorized. Continue implementation,
then use `gsd-lite-verify`.
