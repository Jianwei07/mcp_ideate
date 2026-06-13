export type Source = {
  source_id: string;
  page_id: string;
  page_title: string;
  page_url: string;
  heading_path: string[];
  block_ids: string[];
  score: number;
  excerpt: string;
};

export type ResearchResult = {
  status: "answered" | "insufficient_evidence" | "error";
  answer: string;
  rationale: string;
  sources: Source[];
  cited_source_ids: string[];
  citation_valid: boolean;
};

export type TraceEvent = {
  sequence: number;
  run_id: string;
  timestamp: string;
  type: "trace" | "result" | "error" | "cancelled";
  stage: string;
  level: "debug" | "info" | "warning" | "error";
  message: string;
  data: Record<string, unknown>;
};

export type RuntimeConfig = {
  knowledge: string;
  inference: string;
  transport: string;
  audit: string;
};

export type SessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionTurn = {
  id: string;
  sessionId: string;
  query: string;
  answer: string | null;
  rationale: string | null;
  status:
    | "pending"
    | "running"
    | "awaiting_approval"
    | "complete"
    | "error"
    | "cancelled"
    | "denied"
    | "interrupted";
  model: string;
  thinkingRequested: boolean;
  thinkingSupported: boolean;
  promptTokens: number | null;
  outputTokens: number | null;
  contextTokens: number;
  totalDurationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean | null;
  createdAt: string;
  updatedAt: string;
  citations: Array<{
    sourceId: string;
    pageId: string;
    pageTitle: string;
    pageUrl: string;
    headingPath: string[];
    blockIds: string[];
    score: number;
    excerpt: string;
  }>;
};

export type SessionDetail = SessionSummary & {
  turns?: SessionTurn[];
};
