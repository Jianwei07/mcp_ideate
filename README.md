# MCP Ideate

Local secure-research POC split into independent backend and frontend projects.

## Setup

```bash
cd backend
cp .env.example .env
uv sync --extra dev

cd ../frontend
bun install
bun run build
```

Configure the Notion integration in `backend/.env`, start Ollama, then run:

```bash
cd backend
uv run secure-research
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Checks

```bash
cd backend && uv run pytest
cd frontend && bun run build
```

The backend serves the production assets from the sibling `frontend/dist`
directory. For frontend development, `bun run dev` proxies `/api` to the
backend on port 8000.
