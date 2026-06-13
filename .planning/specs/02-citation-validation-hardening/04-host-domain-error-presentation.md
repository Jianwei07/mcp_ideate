# 04 Host Domain Error Presentation

## Context

- `backend/client/src/host/server.ts` converts MCP tool results into persisted turns and SSE events.
- Citation failure is a domain validation failure, not a transport failure.

## Action

- Store clear turn error fields when `result.status === "error"` and `citationValid === false`:
  - `errorCode: "CITATION_VALIDATION_FAILED"`
  - safe error message
  - `retryable: false`
- Change result SSE message conditionally:
  - success: `Research run completed`
  - citation failure: `Response withheld because citation validation failed`
- Keep protocol trace visible and distinct from domain failure.
- Update host tests.

## Verify

- `cd backend && bun test client/tests/host.test.ts`

## Done

- User sees a safe citation-validation refusal rather than a generic run error.
