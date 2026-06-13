# 04 Verify Notion Tool Flow And Docs

Goal: lock behavior down and document the Notion MCP-inspired shape.

Files:
- `backend/client/tests/mcp-connection.test.ts`
- `backend/client/tests/host.test.ts`
- `backend/README.md`
- `.planning/current/HANDOFF.md`

Actions:
- Add tests proving search/fetch/knowledge tools work and protected excerpts are not persisted.
- Update README with search -> fetch -> knowledge_search -> research flow.
- Mark session complete after verification.

Verification:
- `cd backend && bun run check`

Done:
- Full gate passes and specs completion state is updated.
