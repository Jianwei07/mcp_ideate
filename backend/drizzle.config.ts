import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./client/src/persistence/schema.ts",
  out: "./db",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./runtime/research.db",
  },
});
