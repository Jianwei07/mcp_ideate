# 05 Regression Tests And Quality Gate

## Action

- Run targeted tests after each seam change.
- Run full quality gate after all leaves are complete.

## Verify

- `cd backend && bun test server/tests`
- `cd backend && bun test client/tests`
- `cd backend && bun run check`

## Done

- Strict fail-closed citation behavior remains.
- Failed citations produce explicit withheld-response state.
- Repaired citations complete normally.
- Full quality gate passes.
