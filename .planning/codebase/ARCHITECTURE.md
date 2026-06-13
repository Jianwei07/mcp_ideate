# Architecture

## Pattern

The repository is a local MCP host/server demonstration with a separate browser
UI. The backend Bun workspace owns process lifecycle, Ollama, API routes, the
MCP client, the protected MCP server, contracts, and local persistence. The
legacy Python runtime remains only until verified cutover.

## Modules

- `McpConnection`: lifecycle Module for the stdio session and callbacks.
- `research`: server tool Interface for fixed-corpus research.
- `RunManager`: application lifecycle and one-active-run policy.
- `NotionClient`: protected external API Adapter.
- `OllamaAdapter`: local model Adapter.
- `SessionStore`: Drizzle/SQLite persistence Module.
- `contracts`: shared Zod wire Interface Module.
- Retrieval and citation files: pure domain implementations.
- React `App`: browser state, API use, and rendering.

## Interfaces

- MCP `research(query)` returns a structured `ResearchResult`.
- HTTP host routes create and stream session turns.
- HTTP SSE streams ordered `TraceEvent` values.
- JSONL audit stores an allowlisted metadata projection.

## Seams

- MCP stdio is the strongest existing process Seam.
- Notion and Ollama adapters are testable external boundaries.
- `EventSink` bridges protocol callbacks to application events.
- `backend/contracts/` is the canonical TypeScript wire contract during Bun
  migration.

## Data Flow

Browser request -> Bun host RunEngine -> MCP tool call -> Notion retrieval ->
MCP sampling request -> Ollama -> server citation validation -> SSE result.

## Cross-Cutting Behavior

- Root validation limits cache access.
- Fixed Notion configuration limits corpus access.
- Audit projection redacts answer and evidence content.
- Exceptions are currently over-redacted before reaching the UI.
