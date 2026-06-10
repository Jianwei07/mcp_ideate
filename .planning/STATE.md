# State

Status: executing Bun cutover

Branch: `feat/sampling_ai_ops`

Current direction: keep a clean root with `backend/` and `frontend/`; Bun/TypeScript
is the canonical backend runtime with a host/client, independent stdio MCP server,
contracts, and SQLite persistence.

Existing dirty files are inside the approved migration surface and must not be
discarded. Legacy Python backend runtime files were removed after Bun checks
passed.

Next action: review the completed cutover diff, then commit or open a PR when
ready.
