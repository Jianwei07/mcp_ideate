# 03 Repair And Progress Semantics

## Context

- `backend/server/src/tools/research.ts` sends progress and logs validation.
- `backend/server/src/prompts.ts` builds the repair prompt.
- Current progress can say validation succeeded even when the response is withheld.

## Action

- Pass safe validator diagnostics into `citationRepairPrompt`.
- Strengthen repair instructions so every answer sentence or bullet cites listed sources only.
- Change progress/log wording:
  - success: `Research response citation validation passed`
  - failure: `Citation validation failed; withholding response`
- Keep failed citation validation as a domain result with `status: "error"` and `citationValid: false`, not an MCP transport error.
- Add/update integration tests for repair success and failed repair behavior.

## Verify

- `cd backend && bun test server/tests client/tests/mcp-connection.test.ts`

## Done

- Failed citation validation reads as a guarded refusal, not a misleading completed validation.
