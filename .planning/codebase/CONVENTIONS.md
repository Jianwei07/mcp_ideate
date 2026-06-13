# Conventions

## Repository Rules

- Follow `AGENTS.md`.
- Prefer the smallest correct implementation.
- Use exact Module, Interface, Seam, Adapter, Depth, and Locality terms.
- Do not overwrite unrelated dirty work.
- Use composition instead of inheritance.

## TypeScript

- Zod defines public wire Interfaces.
- Classes are reserved for lifecycle-owning Modules.
- Pure functions implement retrieval, ranking, citation, and redaction logic.
- Biome owns linting and formatting.
- Bun test owns backend behavior tests under `backend/client/tests/` and
  `backend/server/tests/`.
- Backend workspaces use one `backend/bun.lock`.
- Frontend uses strict TypeScript and function components.
- Imports use ES modules.
- UI state is local React state.

## Logging

- Protocol events must be captured at their real boundary.
- Readable summaries may derive from events but cannot impersonate MCP traffic.
- stdout is reserved for MCP stdio in the server process.
- Full diagnostics use stderr.
