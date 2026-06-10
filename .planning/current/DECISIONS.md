# Decisions

- The MCP host/client runs in the customer-controlled environment.
- The MCP server is the controlled gateway to protected data; it is not the
  data store itself.
- The host owns Ollama, approvals, sessions, observability, and future agents.
- The server owns Notion credentials, fixed allowlisting, retrieval, and
  citation validation.
- The POC uses MCP `2025-11-25` course features and labels their deprecation.
- Runs are deterministic and stateless; sessions organize history only.
- Native model thinking is optional, capability-gated, masked, and ephemeral.
- Use Drizzle with `bun:sqlite`; do not add Prisma or a remote database.
- Defer LangGraph until AI Ops requires branching, loops, and checkpoints.
