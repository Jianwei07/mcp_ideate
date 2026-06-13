import {
  isTrivialGreetingQuery,
  researchResultSchema,
  type ResearchResult,
} from "@secure-research/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServerConfig } from "../config.ts";
import { loadKnowledgeCorpus, searchKnowledgeChunks } from "../knowledge.ts";
import { SYSTEM_PROMPT, citationRepairPrompt, researchPrompt } from "../prompts.ts";
import { citationSources, validateCitations } from "../retrieval/citations.ts";
import { chunkPages, rankChunks } from "../retrieval/index.ts";
import { selectCacheRoot } from "../security/roots.ts";

const sampledAnswerSchema = z.object({
  status: z.enum(["answered", "insufficient_evidence"]),
  answer: z.string(),
  rationale: z.string(),
});

export function registerResearchTool(mcp: McpServer, config: ServerConfig): void {
  mcp.registerTool(
    "research",
    {
      title: "Research approved knowledge",
      description:
        "Retrieve evidence from the fixed CS230 Notion page tree and ask the client-side model for a grounded answer.",
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(3)
          .max(500)
          .describe("Standalone research question"),
      },
      outputSchema: researchResultSchema,
    },
    async ({ query }, extra) => {
      try {
        if (isTrivialGreetingQuery(query)) {
          return toolResult({
            status: "insufficient_evidence",
            answer:
              "Ask a standalone research question about the approved CS230 notes.",
            rationale: "The input was a greeting, not a research question.",
            sources: [],
            citedSourceIds: [],
            citationValid: true,
          });
        }

        await log(mcp, "info", "roots", "Validating client-provided cache root");
        await progress(extra, 5, "Validating approved cache root");
        const roots = await mcp.server.listRoots();
        const cacheRoot = await selectCacheRoot(roots.roots);

        await log(mcp, "info", "retrieval", "Loading approved Notion page tree");
        await progress(extra, 15, "Loading approved Notion corpus");
        const { pages, cacheHit } = await loadKnowledgeCorpus(
          cacheRoot,
          config,
          extra.signal,
        );
        await log(mcp, "info", "retrieval", "Approved corpus loaded", {
          cacheHit,
          pageCount: pages.length,
        });

        const chunks = chunkPages(pages);
        const selectedFromSearch = await searchKnowledgeChunks(
          query,
          config,
          extra.signal,
        ).catch(async (error) => {
          await log(
            mcp,
            "warning",
            "retrieval",
            "Notion search failed; using cached corpus",
            {
              error: safeServerError(error),
            },
          );
          return [];
        });
        const selected = selectedFromSearch.length
          ? selectedFromSearch
          : rankChunks(query, chunks);
        await progress(extra, 50, "Ranked approved evidence");
        await log(mcp, "info", "retrieval", "Evidence ranking complete", {
          chunkCount: chunks.length,
          selectedCount: selected.length,
          selectedSources: selected.map((source) => source.sourceId),
        });

        const sources = citationSources(selected);
        if (selected.length === 0) {
          const result: ResearchResult = {
            status: "insufficient_evidence",
            answer:
              "The approved CS230 notes do not contain enough evidence to answer this question.",
            rationale: "No allowlisted source chunk passed the retrieval threshold.",
            sources: [],
            citedSourceIds: [],
            citationValid: true,
          };
          await progress(extra, 100, "No supporting evidence found");
          return toolResult(result);
        }

        await log(mcp, "info", "sampling", "Requesting client-side model sampling", {
          sourceCount: selected.length,
        });
        await progress(extra, 65, "Waiting for sampling approval");
        let sampled = await sampleAnswer(mcp, extra, researchPrompt(query, selected));

        if (sampled.status === "insufficient_evidence") {
          await progress(extra, 100, "Model found insufficient evidence");
          return toolResult({
            status: "insufficient_evidence",
            answer: sampled.answer,
            rationale: sampled.rationale,
            sources,
            citedSourceIds: [],
            citationValid: true,
          });
        }

        let validation = validateCitations(sampled.answer, selected);
        if (!validation.valid) {
          await log(mcp, "warning", "validation", "Repairing missing citations", {
            citedSourceIds: validation.citedSourceIds,
          });
          sampled = await sampleAnswer(
            mcp,
            extra,
            citationRepairPrompt(query, selected, sampled.answer, validation),
          );
          if (sampled.status === "insufficient_evidence") {
            await progress(extra, 100, "Model found insufficient evidence");
            return toolResult({
              status: "insufficient_evidence",
              answer: sampled.answer,
              rationale: sampled.rationale,
              sources,
              citedSourceIds: [],
              citationValid: true,
            });
          }
          validation = validateCitations(sampled.answer, selected);
        }
        await log(mcp, "info", "validation", "Citation validation complete", {
          citationValid: validation.valid,
          citedSourceIds: validation.citedSourceIds,
          invalidSourceIds: validation.invalidSourceIds,
          claimCount: validation.claimCount,
          uncitedClaimCount: validation.uncitedClaimCount,
        });
        await progress(
          extra,
          100,
          validation.valid
            ? "Research response citation validation passed"
            : "Citation validation failed; withholding response",
        );

        return toolResult(
          validation.valid
            ? {
                status: "answered",
                answer: sampled.answer,
                rationale: sampled.rationale,
                sources,
                citedSourceIds: validation.citedSourceIds,
                citationValid: true,
              }
            : {
                status: "error",
                answer:
                  "The generated response was withheld because its source markers could not be validated.",
                rationale:
                  "At least one citation was missing or outside the approved evidence set.",
                sources,
                citedSourceIds: validation.citedSourceIds,
                citationValid: false,
              },
        );
      } catch (error) {
        if (isExpectedAbort(error)) {
          await log(
            mcp,
            "warning",
            "cancelled",
            "Research request cancelled by client",
          ).catch(() => undefined);
          return {
            content: [{ type: "text", text: "Research request cancelled." }],
            isError: true,
          };
        }
        const message = safeServerError(error);
        await log(mcp, "error", "error", message);
        console.error("[secure-research-server]", error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  );
}

async function sampleAnswer(
  mcp: McpServer,
  extra: { signal?: AbortSignal },
  prompt: string,
) {
  const sampledResult = await mcp.server.createMessage(
    {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: prompt,
          },
        },
      ],
      maxTokens: 1800,
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.1,
    },
    { signal: extra.signal },
  );
  if (sampledResult.content.type !== "text") {
    throw new Error("Client sampling returned non-text content");
  }
  return sampledAnswerSchema.parse(JSON.parse(sampledResult.content.text));
}

function toolResult(result: ResearchResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

async function log(
  mcp: McpServer,
  level: "debug" | "info" | "warning" | "error",
  stage: string,
  message: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await mcp.sendLoggingMessage({
    level,
    logger: "secure-research",
    data: { message, stage, ...data },
  });
}

async function progress(
  extra: {
    _meta?: { progressToken?: string | number };
    sendNotification: (notification: {
      method: "notifications/progress";
      params: {
        progressToken: string | number;
        progress: number;
        total: number;
        message: string;
      };
    }) => Promise<void>;
  },
  value: number,
  message: string,
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return;
  await extra.sendNotification({
    method: "notifications/progress",
    params: { progressToken, progress: value, total: 100, message },
  });
}

function safeServerError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown server error";
  const allowed = /Notion|root|cache|sampling|citation|configuration|abort/i;
  return allowed.test(message)
    ? message.slice(0, 300)
    : "The secure research server could not complete the request.";
}

function isExpectedAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /AbortError|operation was aborted|RequestTimeout|cancelled/i.test(
    error.message,
  );
}
