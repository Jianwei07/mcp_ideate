# State

Status: refining MCP practice lab PR

Branch: `feat/sampling_ai_ops`

Current direction: keep a clean root with `backend/` and `frontend/`; Bun/TypeScript
is the canonical backend runtime with a host/client, independent stdio MCP server,
contracts, and SQLite persistence. The frontend is a chatbot-like MCP lab bench
for practicing sampling approvals, security boundaries, local inference, traces,
and future agent harnesses.

Existing dirty files are inside the approved migration surface and must not be
discarded. Legacy Python backend runtime files were removed after Bun checks
passed.

Next action: review PR feedback, verify the chatbot sampling/timeout flow, then
merge when the branch is stable.
