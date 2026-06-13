import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

const path = resolve(process.env.DATABASE_PATH ?? "./runtime/research.db");
await mkdir(dirname(path), { recursive: true });

const sqlite = new Database(path, { create: true });
sqlite.exec("PRAGMA foreign_keys = ON");
sqlite.exec("PRAGMA journal_mode = WAL");

try {
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: resolve("./db") });
  console.log(`Database ready: ${path}`);
} finally {
  sqlite.close();
}
