# 07 Backend Workspace Capsule

Move the active Bun backend workspace out of the repository root and into
`backend/`, preserving verified server and client behavior while making the
root show only the product split: `backend/` and `frontend/`.

Verification: `cd backend && bun run typecheck && bun test server/tests && bun test client/tests`.

Done when root no longer contains backend workspace files, root `node_modules/`
is gone, backend commands run from `backend/`, and existing completed server and
client tests still pass.

Rollback: move the Bun workspace files back to root and restore previous path
references.
