# 01 Bun Workspace And Quality

Create the backend Bun workspace, shared Zod contracts, Drizzle SQLite schema,
Biome and TypeScript configuration, backend scripts, environment examples, and
the local development supervisor.

Verification: `cd backend && bun run typecheck`.

Done when `cd backend && bun install` yields one lockfile and backend commands
resolve all workspace modules.

Rollback: remove only newly added Bun workspace files.
