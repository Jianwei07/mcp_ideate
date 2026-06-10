import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  CitationSource,
  Session,
  TranscriptEvent,
  Turn,
} from "@secure-research/contracts";
import { Database } from "bun:sqlite";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { citations, events, sessions, turns } from "./schema.ts";

type TurnUpdate = Partial<{
  answer: string | null;
  rationale: string | null;
  status: Turn["status"];
  thinkingSupported: boolean;
  promptTokens: number | null;
  outputTokens: number | null;
  totalDurationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean | null;
}>;

export class SessionStore {
  private readonly sqlite: Database;
  private readonly db: BunSQLiteDatabase;

  constructor(path: string, migrationsFolder = resolve("./db")) {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path, { create: true });
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec("PRAGMA journal_mode = WAL");
    this.db = drizzle(this.sqlite);
    migrate(this.db, { migrationsFolder });
    this.recoverInterruptedTurns();
  }

  close(): void {
    this.sqlite.close();
  }

  createSession(title = "New research session"): Session {
    const now = new Date().toISOString();
    const session = {
      id: crypto.randomUUID(),
      title: title.trim().slice(0, 120) || "New research session",
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(sessions).values(session).run();
    return session;
  }

  listSessions(): Session[] {
    return this.db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all();
  }

  getSession(sessionId: string): Session | null {
    const session = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();
    if (!session) return null;
    return {
      ...session,
      turns: this.listTurns(sessionId),
    };
  }

  createTurn(input: {
    sessionId: string;
    query: string;
    model: string;
    thinkingRequested: boolean;
    thinkingSupported: boolean;
    contextTokens: number;
  }): Turn {
    const now = new Date().toISOString();
    const row = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      query: input.query,
      answer: null,
      rationale: null,
      status: "pending" as const,
      model: input.model,
      thinkingRequested: input.thinkingRequested,
      thinkingSupported: input.thinkingSupported,
      promptTokens: null,
      outputTokens: null,
      contextTokens: input.contextTokens,
      totalDurationMs: null,
      errorCode: null,
      errorMessage: null,
      retryable: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(turns).values(row).run();
    this.db
      .update(sessions)
      .set({
        updatedAt: now,
        title: input.query.trim().slice(0, 72),
      })
      .where(eq(sessions.id, input.sessionId))
      .run();
    return { ...row, citations: [] };
  }

  updateTurn(turnId: string, update: TurnUpdate): void {
    this.db
      .update(turns)
      .set({ ...update, updatedAt: new Date().toISOString() })
      .where(eq(turns.id, turnId))
      .run();
  }

  getTurn(turnId: string): Turn | null {
    const row = this.db.select().from(turns).where(eq(turns.id, turnId)).get();
    return row ? this.mapTurn(row) : null;
  }

  listTurns(sessionId: string): Turn[] {
    return this.db
      .select()
      .from(turns)
      .where(eq(turns.sessionId, sessionId))
      .orderBy(asc(turns.createdAt))
      .all()
      .map((row) => this.mapTurn(row));
  }

  appendEvent(event: TranscriptEvent): void {
    this.db
      .insert(events)
      .values({
        ...event,
        metadataJson: JSON.stringify(event.metadata),
      })
      .run();
  }

  listEvents(turnId: string, afterSequence = 0): TranscriptEvent[] {
    return this.db
      .select()
      .from(events)
      .where(and(eq(events.turnId, turnId), gt(events.sequence, afterSequence)))
      .orderBy(asc(events.sequence))
      .all()
      .map((event) => ({
        ...event,
        channel: event.channel as TranscriptEvent["channel"],
        direction: event.direction as TranscriptEvent["direction"],
        level: event.level as TranscriptEvent["level"],
        status: event.status as TranscriptEvent["status"],
        metadata: JSON.parse(event.metadataJson) as Record<string, unknown>,
      }));
  }

  nextSequence(turnId: string): number {
    const latest = this.db
      .select({ sequence: events.sequence })
      .from(events)
      .where(eq(events.turnId, turnId))
      .orderBy(desc(events.sequence))
      .limit(1)
      .get();
    return (latest?.sequence ?? 0) + 1;
  }

  replaceCitations(turnId: string, sources: CitationSource[]): void {
    this.db.delete(citations).where(eq(citations.turnId, turnId)).run();
    if (sources.length === 0) return;
    this.db
      .insert(citations)
      .values(
        sources.map((source) => ({
          id: crypto.randomUUID(),
          turnId,
          sourceId: source.sourceId,
          pageId: source.pageId,
          pageTitle: source.pageTitle,
          pageUrl: source.pageUrl,
          headingPathJson: JSON.stringify(source.headingPath),
          blockIdsJson: JSON.stringify(source.blockIds),
          score: source.score,
        })),
      )
      .run();
  }

  private mapTurn(row: typeof turns.$inferSelect): Turn {
    const sourceRows = this.db
      .select()
      .from(citations)
      .where(eq(citations.turnId, row.id))
      .orderBy(asc(citations.sourceId))
      .all();
    return {
      ...row,
      status: row.status as Turn["status"],
      citations: sourceRows.map((source) => ({
        sourceId: source.sourceId,
        pageId: source.pageId,
        pageTitle: source.pageTitle,
        pageUrl: source.pageUrl,
        headingPath: JSON.parse(source.headingPathJson) as string[],
        blockIds: JSON.parse(source.blockIdsJson) as string[],
        score: source.score,
        excerpt: "",
      })),
    };
  }

  private recoverInterruptedTurns(): void {
    const now = new Date().toISOString();
    this.sqlite
      .query(
        `UPDATE turns
         SET status = 'interrupted',
             error_code = 'HOST_RESTARTED',
             error_message = 'The local host restarted before the turn completed.',
             retryable = 1,
             updated_at = ?
         WHERE status IN ('pending', 'running', 'awaiting_approval')`,
      )
      .run(now);
  }
}
