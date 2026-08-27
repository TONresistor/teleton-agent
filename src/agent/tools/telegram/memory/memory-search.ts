import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { HybridSearch } from "../../../../memory/search/hybrid.js";
import { getKnowledgeIndexer } from "../../../../memory/agent/knowledge.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface MemorySearchParams {
  query: string;
  limit?: number;
}

export const memorySearchTool: Tool = {
  name: "memory_search",
  description:
    "Search the agent's knowledge base (indexed files, ingested documents) by keyword. Returns relevant chunks with source paths. NOT for recent chat history — use session_search. NOT for structured memory blocks — use memory_read with target='core'.",
  category: "data-bearing",
  parameters: Type.Object({
    query: Type.String({
      description: "The search query — keywords or a natural-language question.",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of results to return (default: 5, max: 20).",
        minimum: 1,
        maximum: 20,
      })
    ),
  }),
};

export const memorySearchExecutor: ToolExecutor<MemorySearchParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { query } = params;
    const limit = Math.min(params.limit ?? 5, 20);

    const knowledge = getKnowledgeIndexer();
    const embedder = knowledge?.getEmbedder() ?? null;

    let queryEmbedding: number[] = [];
    if (embedder) {
      try {
        queryEmbedding = await embedder.embedQuery(query);
      } catch (error) {
        log.warn({ err: error }, "Embedding failed — falling back to keyword-only search");
      }
    }

    const results = knowledge
      ? await knowledge.search(query, queryEmbedding, limit)
      : await new HybridSearch(context.db, false).searchKnowledge(query, [], { limit });

    if (results.length === 0) {
      return {
        success: true,
        data: { results: [], message: "No matching knowledge found." },
      };
    }

    return {
      success: true,
      data: {
        query,
        count: results.length,
        results: results.map((r) => ({
          text: r.text,
          source: r.source,
          score: Math.round(r.score * 1000) / 1000,
        })),
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error searching memory");
    return { success: false, error: getErrorMessage(error) };
  }
};
