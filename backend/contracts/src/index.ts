import { z } from "zod";

export const citationSourceSchema = z.object({
  sourceId: z.string(),
  pageId: z.string(),
  pageTitle: z.string(),
  pageUrl: z.string().url(),
  headingPath: z.array(z.string()),
  blockIds: z.array(z.string()),
  score: z.number(),
  excerpt: z.string(),
});

export type CitationSource = z.infer<typeof citationSourceSchema>;

export const researchResultSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence", "error"]),
  answer: z.string(),
  rationale: z.string(),
  sources: z.array(citationSourceSchema),
  citedSourceIds: z.array(z.string()),
  citationValid: z.boolean(),
});

export type ResearchResult = z.infer<typeof researchResultSchema>;

export const transcriptChannelSchema = z.enum(["application", "mcp", "model"]);
export const transcriptLevelSchema = z.enum(["debug", "info", "warning", "error"]);
export const transcriptStatusSchema = z.enum([
  "pending",
  "running",
  "complete",
  "error",
  "cancelled",
  "denied",
]);

export const transcriptEventSchema = z.object({
  id: z.string(),
  turnId: z.string(),
  sequence: z.number().int().positive(),
  timestamp: z.string(),
  channel: transcriptChannelSchema,
  origin: z.string(),
  direction: z.enum(["internal", "client_to_server", "server_to_client"]),
  kind: z.string(),
  method: z.string().nullable(),
  requestId: z.string().nullable(),
  parentRequestId: z.string().nullable(),
  level: transcriptLevelSchema,
  status: transcriptStatusSchema,
  summary: z.string(),
  durationMs: z.number().int().nonnegative().nullable(),
  metadata: z.record(z.unknown()),
  detailAvailable: z.boolean(),
});

export type TranscriptEvent = z.infer<typeof transcriptEventSchema>;

export const turnStatusSchema = z.enum([
  "pending",
  "running",
  "awaiting_approval",
  "complete",
  "error",
  "cancelled",
  "denied",
  "interrupted",
]);

export const turnSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  query: z.string(),
  answer: z.string().nullable(),
  rationale: z.string().nullable(),
  status: turnStatusSchema,
  model: z.string(),
  thinkingRequested: z.boolean(),
  thinkingSupported: z.boolean(),
  promptTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  contextTokens: z.number().int().positive(),
  totalDurationMs: z.number().int().nonnegative().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  retryable: z.boolean().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  citations: z.array(citationSourceSchema),
});

export type Turn = z.infer<typeof turnSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  turns: z.array(turnSchema).optional(),
});

export type Session = z.infer<typeof sessionSchema>;

export const createTurnSchema = z.object({
  query: z.string().trim().min(3).max(500),
  thinking: z.boolean().default(false),
});

export const samplingDecisionSchema = z.object({
  decision: z.enum(["approve", "approve_always", "deny"]),
});

export type SamplingDecision = z.infer<typeof samplingDecisionSchema>["decision"];

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  stage: z.string(),
  retryable: z.boolean(),
  correlationId: z.string(),
  httpStatus: z.number().int(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

const TRIVIAL_GREETING_QUERY_RE =
  /^(hi|hello|hey|yo|sup|thanks|thank you|good morning|good afternoon|good evening)$/;

export function isTrivialGreetingQuery(query: string): boolean {
  const normalized = query
    .trim()
    .toLowerCase()
    .replace(/[!?.]+$/g, "");
  return TRIVIAL_GREETING_QUERY_RE.test(normalized);
}
