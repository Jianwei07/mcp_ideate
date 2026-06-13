# 03 Client Run Engine

Implement the customer-side MCP connection, deterministic RunEngine, explicit
sampling approval, Ollama capability detection and inference, cancellation,
and protocol/model/application transcript events.

Verification: `cd backend && bun test client/tests`.

Done when mocked integration proves the complete stdio call and the server
delegates inference to the client.

Rollback: keep the Python host available until cutover.

## Hotfix: Resilient Host Run Lifecycle

Fix the Bun host run path so a trivial query, slow retrieval, or interrupted SSE
stream cannot leave the browser stuck in `Run active`.

Scope:

- Add SSE keepalive and configure Bun for long-running event streams.
- Add a host-side run deadline with abort propagation.
- Reject obvious non-research greetings before MCP, Notion, or Ollama work starts.
- Emit terminal error/cancel/result events consistently and close stream clients.
- Ensure the React console leaves running state on stream interruption or cancel.
- Keep environment/runtime labels sourced from `/api/config`.

Verification:

- `cd backend && bun test client/tests server/tests`
- `cd backend && bun run typecheck`
- `cd frontend && bun run build`
- Smoke: `hello` returns a clear validation error without starting retrieval.
- Smoke: a real research query keeps SSE alive beyond 10 seconds.
- Smoke: cancel leaves `Run active` immediately.
