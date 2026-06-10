# Testing

## Current Backend

- Runner: Bun test.
- Tests: `backend/client/tests/` and `backend/server/tests/`.
- Command: `cd backend && bun test client/tests server/tests`.
- Integration coverage exercises MCP transport seams, retrieval, roots, sampling,
  and citation behavior.
- Security tests cover roots, retrieval, and citations.

## Current Frontend

- No browser or component test suite exists.
- Typecheck/build command: `cd frontend && bun run build`.
- No lint or format check command exists.

## Commands

- Backend FE lint: `cd backend && bun run lint:client`.
- Backend format check: `cd backend && bun run format:check`.
- Backend client typecheck: `cd backend && bun run typecheck:client`.
- Backend client test: `cd backend && bun test client/tests`.
- Backend server lint: `cd backend && bun run lint:server`.
- Backend server typecheck: `cd backend && bun run typecheck:server`.
- Backend server test: `cd backend && bun test server/tests`.
- Frontend build: `cd frontend && bun run build`.
- Full backend check: `cd backend && bun run check`.

## Placement

- Client tests live in `backend/client/tests/`.
- Server tests live in `backend/server/tests/`.
- Tests exercise public Interfaces rather than private functions.
- Mock only external Notion and Ollama boundaries.
- Keep golden questions under a documented eval path.

## Coverage Priorities

- Full stdio sampling flow.
- Approval, cancellation, and SSE replay.
- Allowlisting and root containment.
- Citation validation and insufficient evidence.
- Persistence and audit redaction.
- Structured errors and token metrics.
