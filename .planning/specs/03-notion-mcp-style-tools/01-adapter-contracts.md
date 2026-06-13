# 01 Add Notion Read Adapter And Contracts

Goal: add small typed read Interfaces for Notion search, markdown fetch, knowledge search, and status.

Files:
- `backend/contracts/src/index.ts`
- `backend/server/src/notion/client.ts`
- `backend/server/src/types.ts`

Actions:
- Add Zod schemas/types for Notion search result, page fetch result, knowledge search result, and knowledge status result.
- Add `NotionAdapter.searchPages(query, limit, signal)` using `/v1/search` with `filter.object=page`.
- Add `NotionAdapter.fetchPageMarkdown(pageIdOrUrl, signal)` using `/v1/pages/{page_id}/markdown`.
- Keep existing page-tree walker intact.

Verification:
- `cd backend && bun run typecheck:contracts && bun run typecheck:server`

Done:
- New Interfaces compile and expose no credentials or protected excerpts in status metadata.
