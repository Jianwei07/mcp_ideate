# Tests

Run the full cutover gate from the backend workspace:

```bash
cd backend
bun run check
```

Useful slices:

```bash
cd backend && bun test client/tests
cd backend && bun test server/tests
cd backend && bun run typecheck
cd frontend && bun run build
```

Coverage focus:

- MCP stdio client/server integration with fake Notion and client-side sampling.
- Sampling approval, cancellation, SSE lifecycle, and host API behavior.
- Session persistence, transcript replay, interrupted-run recovery, and metadata-only audit.
- Retrieval ranking, root enforcement, greeting rejection, and citation validation.
