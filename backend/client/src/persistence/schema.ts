import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("sessions_updated_at_idx").on(table.updatedAt)],
);

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    answer: text("answer"),
    rationale: text("rationale"),
    status: text("status").notNull(),
    model: text("model").notNull(),
    thinkingRequested: integer("thinking_requested", { mode: "boolean" })
      .notNull()
      .default(false),
    thinkingSupported: integer("thinking_supported", { mode: "boolean" })
      .notNull()
      .default(false),
    promptTokens: integer("prompt_tokens"),
    outputTokens: integer("output_tokens"),
    contextTokens: integer("context_tokens").notNull(),
    totalDurationMs: integer("total_duration_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryable: integer("retryable", { mode: "boolean" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("turns_session_id_idx").on(table.sessionId),
    index("turns_status_idx").on(table.status),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    timestamp: text("timestamp").notNull(),
    channel: text("channel").notNull(),
    origin: text("origin").notNull(),
    direction: text("direction").notNull(),
    kind: text("kind").notNull(),
    method: text("method"),
    requestId: text("request_id"),
    parentRequestId: text("parent_request_id"),
    level: text("level").notNull(),
    status: text("status").notNull(),
    summary: text("summary").notNull(),
    durationMs: integer("duration_ms"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    detailAvailable: integer("detail_available", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    index("events_turn_sequence_idx").on(table.turnId, table.sequence),
    index("events_request_id_idx").on(table.requestId),
  ],
);

export const citations = sqliteTable(
  "citations",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    pageId: text("page_id").notNull(),
    pageTitle: text("page_title").notNull(),
    pageUrl: text("page_url").notNull(),
    headingPathJson: text("heading_path_json").notNull(),
    blockIdsJson: text("block_ids_json").notNull(),
    score: real("score").notNull(),
  },
  (table) => [index("citations_turn_id_idx").on(table.turnId)],
);
