# 02 Secure MCP Server

Port the allowlisted Notion adapter, normalization, lexical retrieval, cache
root enforcement, logging, progress, sampling request, and citation validation
to an independent stdio MCP server.

Verification: `cd backend && bun test server/tests`.

Done when the public `research` tool returns a validated contract and no server
module imports or calls Ollama.

Rollback: retain the verified Python server as the previous implementation.
