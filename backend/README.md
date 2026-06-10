# Backend Workspace

Backend workspace for the localhost secure research console. The active Bun
implementation lives in `client/`, `server/`, `contracts/`, `db/`, and
`scripts/`.

# Secure MCP Research POC

A localhost research console demonstrating MCP sampling, logging, progress,
roots, and cancellation against an allowlisted Notion knowledge base.

The MCP server retrieves and ranks approved CS230 notes. It cannot call an LLM.
Instead, it sends the question and selected evidence back to the MCP client with
`sampling/createMessage`. The client calls the configured local Ollama model and
returns structured output for server-side citation validation.

## Security boundary

- Notion access is read-only and fixed to `NOTION_ROOT_PAGE_ID`.
- The server follows only child pages discovered beneath that root.
- Ollama inference runs only in the client.
- Local inference is limited to one active run, an 8K context window, and 1200
  generated tokens to fit a 24 GB Apple Silicon workstation comfortably.
- MCP roots grant the server one temporary cache directory for the session.
- Persistent SQLite state stores questions, answers, citations, and safe event
  metadata. JSONL audit logs contain event metadata only. Raw prompts, protocol
  payloads, native thinking, and Notion excerpts are not persisted.
- The Bun host binds to `127.0.0.1`.
- Answers without valid `[S1]`-style source markers are withheld.

## Prerequisites

- Bun 1.x
- Ollama
- A read-only Notion integration shared only with the CS230 root page

Install the configured local model explicitly. The default is `llama3.2:3b`:

```bash
ollama pull llama3.2:3b
```

The application never downloads a model automatically.

## Setup

```bash
cd backend
cp .env.example .env
bun install
```

Configure `.env`:

```dotenv
NOTION_TOKEN=ntn_your_read_only_integration_token
NOTION_ROOT_PAGE_ID=your_cs230_root_page_id
```

The page ID is deliberately not committed because the repository is public.

## Run

Start Ollama in another terminal if it is not already running:

```bash
ollama serve
```

Then start the research console:

```bash
bun run dev
```

This starts the Bun host on `127.0.0.1:8000` with backend code reload enabled.

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

For frontend development, run `bun run dev` from the repository's `frontend/`
directory; Vite proxies `/api` to the backend on port 8000.

## Request flow

```text
Browser
  -> Bun host/client
  -> research(query) over stdio
  -> MCP server fetches allowlisted Notion pages
  -> server requests sampling/createMessage
  -> MCP client calls local Ollama
  -> server validates citations
  -> Bun host streams trace and result events over SSE
```

## Tests

```bash
bun run check
```

Client integration tests launch the MCP server over stdio against fake Notion and
verify roots, logging, progress, sampling approval, and cited structured output.
Persistence tests verify restart recovery and metadata-only audit behavior.

Golden evaluation prompts live in `evals/golden_questions.json`.

## Production follow-ups

This POC intentionally uses localhost and stdio. A remote deployment would need
authenticated stateful Streamable HTTP, TLS, secret management, user identity,
authorization, retention controls, and centralized monitoring.
