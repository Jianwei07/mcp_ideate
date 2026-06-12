# Secure MCP AI Ops Foundation

## Purpose

Build a small, security-first MCP laboratory that makes the relationship
between a customer-side MCP host/client and a protected MCP server visible.
Use it as a practice and ideation harness for advanced MCP client/server topics,
AI inference boundaries, security controls, and future agent test loops.

## Core Value

- The client owns local inference, approvals, sessions, and future agent loops.
- The server owns protected credentials, allowlisting, retrieval, and tools.
- Every run is observable through protocol-derived events and grounded citations.
- The frontend should feel like a chatbot-style lab bench: easy to practice
  sampling approvals, deny/allow policies, retries, traces, and security
  boundaries without hiding the protocol mechanics.

## Constraints

- Bind local services to `127.0.0.1`.
- Keep Notion credentials and page allowlists server-side.
- Keep Ollama inference client-side.
- Persist safe conversation history and metadata, never protected evidence,
  prompts, reasoning tokens, raw protocol payloads, or stack traces.
- Pin the course POC to MCP revision `2025-11-25`.
- Keep the implementation small enough to understand and extend toward AI Ops.

## Direction

Use a Bun/TypeScript workspace inside `backend/` with `backend/client/`,
`backend/server/`, `backend/contracts/`, and `backend/db/`. Use Drizzle with
`bun:sqlite`. Preserve `frontend/` as the browser application and
`roots_sample/` as course reference.
