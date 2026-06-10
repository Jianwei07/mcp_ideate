# 06 Cutover And Verification

Run all behavior and quality checks, smoke-test `bun dev`, update README,
AGENTS.md, TESTS.md, planning verification, and remove superseded Python/Vite
runtime files only after parity succeeds.

Verification: `cd backend && bun run check`.

Done when Bun is the sole documented runtime and all acceptance criteria have
evidence.

Rollback: do not remove legacy paths when any parity check is red.
