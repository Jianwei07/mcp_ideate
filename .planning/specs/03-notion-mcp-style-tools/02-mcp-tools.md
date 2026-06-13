# 02 Expose Notion-Style MCP Tools

Goal: expose Notion-like read tools alongside existing `research`.

Files:
- `backend/server/src/index.ts`
- `backend/server/src/tools/*.ts`
- `backend/client/src/mcp/connection.ts`

Actions:
- Register `notion_search`, `notion_fetch`, `knowledge_search`, and `knowledge_status`.
- Add typed client methods or generic tool call helpers for tests.
- Preserve MCP logging/progress semantics.

Verification:
- `cd backend && bun test client/tests/mcp-connection.test.ts`

Done:
- Real stdio tests can call new tools against fake Notion.
