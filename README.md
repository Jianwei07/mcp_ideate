# MCP Ideate

Local secure-research POC split into independent backend and frontend projects.
The repository root stays clean; backend implementation details live under
`backend/`.

## Setup

```bash
cd backend
cp .env.example .env
bun install

cd ../frontend
bun install
bun run build
```

Configure the Notion integration in `backend/.env`, start Ollama, then run:

```bash
cd backend
bun run dev
```

`bun run dev` starts the local backend supervisor with backend code reload
enabled.

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

For frontend hot reload, use a second terminal:

```bash
cd frontend
bun run dev
```

## Checks

```bash
cd backend && bun run check
```

For frontend development, `bun run dev` from `frontend/` proxies `/api` to the
backend on port 8000.
