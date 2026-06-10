import { z } from "zod";
import { HostError } from "../host/errors.ts";

const sampledAnswerSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence"]),
  answer: z.string(),
  rationale: z.string(),
});

type SamplingParams = {
  systemPrompt?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: { type: "text"; text: string } | Array<{ type: string; text?: string }>;
  }>;
  maxTokens: number;
  temperature?: number;
};

export type OllamaUsage = {
  promptTokens: number;
  outputTokens: number;
  totalDurationMs: number;
  loadDurationMs: number;
  promptEvalDurationMs: number;
  evalDurationMs: number;
};

export type OllamaSample = {
  content: string;
  thinking: string | null;
  usage: OllamaUsage;
};

export class OllamaAdapter {
  private thinkingSupported = false;

  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly contextTokens: number,
    private readonly maxOutputTokens: number,
    private readonly keepAlive: string,
  ) {}

  async preflight(): Promise<{ thinkingSupported: boolean }> {
    let tags: Response;
    try {
      tags = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      throw new HostError(
        `Ollama is not reachable at ${this.baseUrl}. Start it with 'ollama serve'.`,
        "OLLAMA_UNAVAILABLE",
        "model",
        true,
        503,
        { cause: error },
      );
    }
    if (!tags.ok) {
      throw new HostError(
        `Ollama preflight failed with HTTP ${tags.status}`,
        "OLLAMA_UNAVAILABLE",
        "model",
        true,
        503,
      );
    }
    const payload = (await tags.json()) as {
      models?: Array<{ name?: string }>;
    };
    const installed = new Set(payload.models?.map((item) => item.name) ?? []);
    if (!installed.has(this.model) && !installed.has(`${this.model}:latest`)) {
      throw new HostError(
        `Required model '${this.model}' is not installed. Run 'ollama pull ${this.model}'.`,
        "OLLAMA_MODEL_MISSING",
        "model",
        false,
        503,
      );
    }

    const show = await fetch(`${this.baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model }),
    });
    if (show.ok) {
      const model = (await show.json()) as { capabilities?: string[] };
      this.thinkingSupported = model.capabilities?.includes("thinking") ?? false;
    }
    return { thinkingSupported: this.thinkingSupported };
  }

  supportsThinking(): boolean {
    return this.thinkingSupported;
  }

  async sample(
    params: SamplingParams,
    thinkingRequested: boolean,
    signal?: AbortSignal,
  ): Promise<OllamaSample> {
    const messages: Array<{ role: string; content: string }> = [];
    if (params.systemPrompt) {
      messages.push({ role: "system", content: params.systemPrompt });
    }
    for (const message of params.messages) {
      const content = Array.isArray(message.content)
        ? message.content
            .filter((item) => item.type === "text")
            .map((item) => item.text ?? "")
            .join("\n")
        : message.content.type === "text"
          ? message.content.text
          : "";
      if (content) messages.push({ role: message.role, content });
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      format: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["answered", "insufficient_evidence"],
          },
          answer: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["status", "answer", "rationale"],
      },
      keep_alive: this.keepAlive,
      options: {
        temperature: params.temperature ?? 0.1,
        num_ctx: this.contextTokens,
        num_predict: Math.min(params.maxTokens, this.maxOutputTokens),
      },
    };
    if (this.thinkingSupported) payload.think = thinkingRequested;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      throw new HostError(
        "The Ollama request could not be completed.",
        "OLLAMA_REQUEST_FAILED",
        "model",
        true,
        502,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new HostError(
        `Ollama returned HTTP ${response.status}`,
        "OLLAMA_REQUEST_FAILED",
        "model",
        response.status >= 500,
        502,
      );
    }

    const body = (await response.json()) as {
      message?: { content?: string; thinking?: string };
      prompt_eval_count?: number;
      eval_count?: number;
      total_duration?: number;
      load_duration?: number;
      prompt_eval_duration?: number;
      eval_duration?: number;
    };
    const parsed = sampledAnswerSchema.parse(JSON.parse(body.message?.content ?? ""));
    return {
      content: JSON.stringify(parsed),
      thinking: body.message?.thinking?.trim() || null,
      usage: {
        promptTokens: body.prompt_eval_count ?? 0,
        outputTokens: body.eval_count ?? 0,
        totalDurationMs: nanosecondsToMilliseconds(body.total_duration),
        loadDurationMs: nanosecondsToMilliseconds(body.load_duration),
        promptEvalDurationMs: nanosecondsToMilliseconds(body.prompt_eval_duration),
        evalDurationMs: nanosecondsToMilliseconds(body.eval_duration),
      },
    };
  }
}

function nanosecondsToMilliseconds(value: number | undefined): number {
  return Math.round((value ?? 0) / 1_000_000);
}
