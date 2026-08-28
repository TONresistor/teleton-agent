import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { HybridSearch, parseTemporalIntent, type HybridSearchResult } from "./hybrid.js";
import { MessageStore } from "../feed/messages.js";
import { createLogger } from "../../utils/logger.js";
import { FEED_MESSAGE_MAX_CHARS } from "../../constants/limits.js";
import type { VectorSearchResult } from "../workers/protocol.js";
import type { VectorSearchWorkerClient } from "../workers/vector-search-client.js";

const log = createLogger("Memory");

/** Put the highest-ranked chunks at the context edges to reduce lost-in-the-middle. */
function reorderForEdges<T>(items: T[]): T[] {
  if (items.length <= 2) return items;
  const result: T[] = new Array(items.length);
  let left = 0;
  let right = items.length - 1;
  for (let i = 0; i < items.length; i++) {
    if (i % 2 === 0) result[left++] = items[i];
    else result[right--] = items[i];
  }
  return result;
}

function truncateFeedMessage(text: string): string {
  if (text.length <= FEED_MESSAGE_MAX_CHARS) return text;
  return text.slice(0, FEED_MESSAGE_MAX_CHARS) + "... [truncated]";
}

function normalizeResultText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface ContextOptions {
  query: string;
  chatId: string;
  includeAgentMemory?: boolean;
  includeFeedHistory?: boolean;
  searchAllChats?: boolean;
  maxRecentMessages?: number;
  maxRelevantChunks?: number;
  maxTokens?: number;
  queryEmbedding?: number[];
  currentMessageId?: string;
}

export interface Context {
  recentMessages: Array<{ role: string; content: string }>;
  relevantKnowledge: string[];
  relevantFeed: string[];
  estimatedTokens: number;
}

export class ContextBuilder {
  private hybridSearch: HybridSearch;
  private messageStore: MessageStore;

  constructor(
    private db: Database.Database,
    private embedder: EmbeddingProvider,
    vectorEnabled: boolean,
    private vectorSearchWorker?: VectorSearchWorkerClient
  ) {
    this.hybridSearch = new HybridSearch(db, vectorEnabled);
    this.messageStore = new MessageStore(db, embedder, vectorEnabled);
  }

  async buildContext(options: ContextOptions): Promise<Context> {
    const {
      query,
      chatId,
      includeAgentMemory = true,
      includeFeedHistory = true,
      searchAllChats = false,
      maxRecentMessages = 20,
      maxRelevantChunks = 5,
      currentMessageId,
    } = options;

    const queryEmbedding = options.queryEmbedding ?? (await this.embedder.embedQuery(query));
    const recentTgMessages = this.messageStore
      .getRecentMessages(chatId, maxRecentMessages + (currentMessageId ? 1 : 0))
      .filter((message) => message.id !== currentMessageId)
      .slice(-maxRecentMessages);
    const recentMessages = recentTgMessages.map((message) => ({
      role: message.isFromAgent ? "assistant" : "user",
      content: message.text ?? "",
    }));
    const recentTexts = new Set(
      recentTgMessages
        .map((message) => message.text && normalizeResultText(message.text))
        .filter((text): text is string => Boolean(text))
    );

    const { afterTimestamp } = parseTemporalIntent(query);
    const searchResults = await this.searchContext({
      query,
      queryEmbedding,
      chatId,
      currentMessageId,
      afterTimestamp,
      includeAgentMemory,
      includeFeedHistory,
      searchAllChats,
      maxRelevantChunks,
    });

    const relevantKnowledge = reorderForEdges(searchResults.knowledge.map((result) => result.text));
    const relevantFeed: string[] = [];
    if (includeFeedHistory) {
      const seenIds = new Set<string>();
      const seenTexts = new Set(recentTexts);
      for (const result of [...searchResults.currentChat, ...searchResults.otherChats]) {
        const normalized = normalizeResultText(result.text);
        if (!normalized || seenIds.has(result.id) || seenTexts.has(normalized)) continue;
        seenIds.add(result.id);
        seenTexts.add(normalized);
        const text = truncateFeedMessage(result.text);
        relevantFeed.push(
          result.source === chatId ? text : `[From chat ${result.source}]: ${text}`
        );
      }

      if (relevantFeed.length === 0 && recentTgMessages.length > 0) {
        relevantFeed.push(
          ...recentTgMessages
            .filter((message) => message.text && message.text.length > 0)
            .slice(-maxRelevantChunks)
            .map((message) => `[${message.isFromAgent ? "Agent" : "User"}]: ${message.text}`)
        );
      }
    }

    const allText =
      recentMessages.map((message) => message.content).join(" ") +
      relevantKnowledge.join(" ") +
      relevantFeed.join(" ");
    return {
      recentMessages,
      relevantKnowledge,
      relevantFeed,
      estimatedTokens: Math.ceil(allText.length / 4),
    };
  }

  private async searchContext(options: {
    query: string;
    queryEmbedding: number[];
    chatId: string;
    currentMessageId?: string;
    afterTimestamp?: number;
    includeAgentMemory: boolean;
    includeFeedHistory: boolean;
    searchAllChats: boolean;
    maxRelevantChunks: number;
  }): Promise<Pick<VectorSearchResult, "knowledge" | "currentChat" | "otherChats">> {
    if (this.vectorSearchWorker && options.queryEmbedding.length > 0) {
      try {
        const result = await this.vectorSearchWorker.search({
          type: "search",
          query: options.query,
          queryEmbedding: options.queryEmbedding,
          chatId: options.chatId,
          currentMessageId: options.currentMessageId,
          afterTimestamp: options.afterTimestamp,
          includeKnowledge: options.includeAgentMemory,
          includeFeedHistory: options.includeFeedHistory,
          knowledgeLimit: options.maxRelevantChunks,
          messageLimit: options.maxRelevantChunks,
          searchAllChats: options.searchAllChats,
        });
        log.debug({ timingsMs: result.timingsMs }, "RAG vector worker search complete");
        this.trackKnowledgeAccess(result.knowledge);
        return result;
      } catch (error) {
        log.warn({ err: error }, "Vector search worker failed; falling back to FTS");
      }
    }

    const search = this.vectorSearchWorker ? new HybridSearch(this.db, false) : this.hybridSearch;
    const knowledge = options.includeAgentMemory
      ? await search.searchKnowledge(options.query, options.queryEmbedding, {
          limit: options.maxRelevantChunks,
        })
      : [];
    const currentChat = options.includeFeedHistory
      ? await search.searchMessages(options.query, options.queryEmbedding, {
          chatId: options.chatId,
          excludeMessageId: options.currentMessageId,
          limit: options.maxRelevantChunks,
          afterTimestamp: options.afterTimestamp,
        })
      : [];
    const otherChats =
      options.includeFeedHistory && options.searchAllChats
        ? await search.searchMessages(options.query, options.queryEmbedding, {
            excludeChatId: options.chatId,
            limit: options.maxRelevantChunks,
            afterTimestamp: options.afterTimestamp,
          })
        : [];
    return { knowledge, currentChat, otherChats };
  }

  private trackKnowledgeAccess(results: HybridSearchResult[]): void {
    if (results.length === 0) return;
    const ids = results.map((result) => result.id);
    setImmediate(() => {
      try {
        const placeholders = ids.map(() => "?").join(", ");
        this.db
          .prepare(
            `UPDATE knowledge SET access_count = access_count + 1, last_accessed_at = unixepoch()
             WHERE id IN (${placeholders})`
          )
          .run(...ids);
      } catch {
        // Best-effort metadata; search results remain valid.
      }
    });
  }
}
