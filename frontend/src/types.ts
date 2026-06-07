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
