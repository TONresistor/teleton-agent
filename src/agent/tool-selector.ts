import type { Context, Tool as PiAiTool } from "@earendil-works/pi-ai";
import type { Config } from "../config/schema.js";
import { EMBEDDING_QUERY_MAX_CHARS } from "../constants/limits.js";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import { createLogger } from "../utils/logger.js";
import { enrichRAGQuery, isTrivialMessage } from "./runtime-utils.js";
import type { ToolRegistry } from "./tools/registry.js";

const log = createLogger("Agent");

/** Compute the enriched RAG embedding concurrently with the rest of turn preparation. */
export function computeRagEmbedding(
  embedder: EmbeddingProvider | null,
  effectiveMessage: string,
  context: Context
): Promise<number[]> | undefined {
  if (!embedder || isTrivialMessage(effectiveMessage)) return undefined;

  return (async () => {
    let searchQuery = effectiveMessage;
    const recentUserMessages = context.messages
      .filter((message) => message.role === "user" && typeof message.content === "string")
      .slice(-3)
      .map((message) => {
        const text = message.content as string;
        const bodyMatch = text.match(/\] (.+)/s);
        return (bodyMatch ? bodyMatch[1] : text).trim();
      })
      .filter((text) => text.length > 0);
    if (recentUserMessages.length > 0) {
      searchQuery = `${recentUserMessages.join(" ")} ${effectiveMessage}`;
    }
    const enrichedQuery = enrichRAGQuery(searchQuery);
    if (enrichedQuery !== searchQuery) {
      log.debug(
        { originalLength: searchQuery.length, enrichedLength: enrichedQuery.length },
        "RAG query enriched"
      );
    }
    return embedder.embedQuery(enrichedQuery.slice(0, EMBEDDING_QUERY_MAX_CHARS));
  })();
}

/** Select core, RAG-ranked, or context-filtered tools for one turn. */
export async function selectTools(
  config: Config,
  registry: ToolRegistry | null,
  effectiveMessage: string,
  effectiveIsGroup: boolean,
  chatId: string,
  isAdmin: boolean,
  senderId: number | undefined,
  toolLimit: number | null,
  queryEmbedding: number[] | undefined
): Promise<PiAiTool[] | undefined> {
  if (!registry) return undefined;
  const toolIndex = registry.getToolIndex();
  const useRag =
    toolIndex?.isIndexed &&
    config.tool_rag?.enabled !== false &&
    !isTrivialMessage(effectiveMessage) &&
    !(toolLimit === null && config.tool_rag?.skip_unlimited_providers !== false);

  if (config.tool_search?.enabled) {
    const tools = registry.getCoreTools(effectiveIsGroup, chatId, isAdmin, senderId);
    log.info(`ToolSearch: ${tools.length} core tools (${registry.count} total available)`);
    return tools;
  }
  if (useRag && queryEmbedding) {
    const tools = await registry.getForContextWithRAG(
      effectiveMessage,
      queryEmbedding,
      effectiveIsGroup,
      toolLimit,
      chatId,
      isAdmin,
      senderId
    );
    const searchTool = registry.getAll().find((tool) => tool.name === "tool_search");
    if (searchTool && !tools.some((tool) => tool.name === "tool_search")) tools.push(searchTool);
    log.info(`Tool RAG: ${tools.length}/${registry.count} tools selected`);
    log.debug(`Tool RAG selected: ${tools.map((tool) => tool.name).join(", ")}`);
    return tools;
  }
  return registry.getForContext(effectiveIsGroup, toolLimit, chatId, isAdmin, senderId);
}
