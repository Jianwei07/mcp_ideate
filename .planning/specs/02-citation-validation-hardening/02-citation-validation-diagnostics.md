# 02 Citation Validation Diagnostics

## Context

- `backend/server/src/retrieval/citations.ts` is the validator Interface.
- Current validation is strict but opaque.

## Action

- Extend `validateCitations` to return safe diagnostics:
  - `valid`
  - `citedSourceIds`
  - `invalidSourceIds`
  - `claimCount`
  - `uncitedClaimCount`
  - `hasCitations`
- Preserve strict rule: every claim-like sentence must include a valid selected `[S#]` marker.
- Do not include raw answer text or uncited claim text in diagnostics.
- Add tests in `backend/server/tests/retrieval.test.ts` for valid, missing, invalid, mixed, and uncited-sentence cases.

## Verify

- `cd backend && bun test server/tests`

## Done

- Citation failures explain why validation failed without weakening grounding.
