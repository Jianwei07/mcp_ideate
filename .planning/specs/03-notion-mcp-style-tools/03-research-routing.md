# 03 Route Research Through Search/Fetch Evidence

Goal: make `research` use Notion search/fetch evidence for user queries instead of depending only on cached root-tree preload.

Files:
- `backend/server/src/tools/research.ts`
- `backend/server/src/retrieval/index.ts`
- `backend/server/tests/retrieval.test.ts`
- `backend/client/tests/mcp-connection.test.ts`

Actions:
- For research, search Notion for likely pages, fetch markdown, normalize to pages/chunks, rank, then sample.
- For explicit lecture queries, prefer search/fetch matches for that lecture.
- Preserve citation validation and fail-closed behavior.

Verification:
- `cd backend && bun test server/tests client/tests/mcp-connection.test.ts`

Done:
- `Tell me more about Lecture 2` samples with Lecture 2 evidence when Notion search exposes it.
