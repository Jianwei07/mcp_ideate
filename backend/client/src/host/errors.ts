import type { ApiError } from "@secure-research/contracts";

export class HostError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly stage: string,
    readonly retryable: boolean,
    readonly httpStatus = 500,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HostError";
  }
}

export function classifyError(error: unknown, correlationId: string): ApiError {
  if (error instanceof HostError) {
    return {
      code: error.code,
      message: error.message,
      stage: error.stage,
      retryable: error.retryable,
      correlationId,
      httpStatus: error.httpStatus,
    };
  }

  const message = error instanceof Error ? error.message : "Unknown failure";
  const lower = message.toLowerCase();
  if (lower.includes("notion")) {
    return safe(
      "NOTION_REQUEST_FAILED",
      message,
      "retrieval",
      true,
      502,
      correlationId,
    );
  }
  if (lower.includes("ollama") || lower.includes("model")) {
    return safe("OLLAMA_REQUEST_FAILED", message, "model", true, 502, correlationId);
  }
  if (lower.includes("root")) {
    return safe("MCP_ROOT_REJECTED", message, "roots", false, 400, correlationId);
  }
  if (lower.includes("denied")) {
    return safe(
      "SAMPLING_DENIED",
      "The client denied the sampling request.",
      "sampling",
      false,
      409,
      correlationId,
    );
  }
  if (lower.includes("citation")) {
    return safe(
      "CITATION_VALIDATION_FAILED",
      message,
      "validation",
      false,
      422,
      correlationId,
    );
  }
  if (lower.includes("mcp") || lower.includes("transport") || lower.includes("stdio")) {
    return safe("MCP_TRANSPORT_FAILED", message, "mcp", true, 502, correlationId);
  }

  return safe(
    "INTERNAL_ERROR",
    "The local research run failed unexpectedly.",
    "host",
    false,
    500,
    correlationId,
  );
}

function safe(
  code: string,
  message: string,
  stage: string,
  retryable: boolean,
  httpStatus: number,
  correlationId: string,
): ApiError {
  return {
    code,
    message: message.slice(0, 300),
    stage,
    retryable,
    correlationId,
    httpStatus,
  };
}

export function printCauseChain(error: unknown, correlationId: string): void {
  const chain: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    chain.push(`${current.name}: ${current.message}\n${current.stack ?? ""}`);
    current = current.cause;
  }
  console.error(`[${correlationId}] ${chain.join("\nCaused by:\n")}`);
}
