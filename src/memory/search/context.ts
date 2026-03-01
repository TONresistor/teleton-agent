import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { HybridSearch } from "./hybrid.js";
import { MessageStore } from "../feed/messages.js";
import { createLogger } from "../../utils/logger.js";
import { FEED_MESSAGE_MAX_CHARS } from "../../constants/limits.js";

const log = createLogger("Memory");

/**
 * Reorder chunks using "edges-first" pattern to mitigate the "lost in the middle"
 * effect (Stanford, 2023; Chroma, 2025). Models attend best to the beginning and
 * end of context. Assumes input is sorted by descending relevance score.
 *
 * Input:  [best, 2nd, 3rd, 4th, 5th]  (by score)
 * Output: [best, 3rd, 5th, 4th, 2nd]  (best at start, 2nd-best at end)
 */
function reorderForEdges<T>(items: T[]): T[] {
  if (items.length <= 2) return items;
  const result: T[] = new Array(items.length);
  let left = 0;
  let right = items.length - 1;
  for (let i = 0; i < items.length; i++) {
    if (i % 2 === 0) {
      result[left++] = items[i];
    } else {
      result[right--] = items[i];
    }
  }
  return result;
}

function truncateFeedMessage(text: string): string {
  if (text.length <= FEED_MESSAGE_MAX_CHARS) return text;
  return text.slice(0, FEED_MESSAGE_MAX_CHARS) + "... [truncated]";
}

export interface ContextOptions {
  query: string;
  chatId: string;
  includeAgentMemory?: boolean;
  includeFeedHistory?: boolean;
  searchAllChats?: boolean; // Search across all chats, not just current
  maxRecentMessages?: number;
  maxRelevantChunks?: number;
  maxTokens?: number;
  queryEmbedding?: number[];
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
    vectorEnabled: boolean
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
    } = options;

    const queryEmbedding = options.queryEmbedding ?? (await this.embedder.embedQuery(query));

    const recentTgMessages = this.messageStore.getRecentMessages(chatId, maxRecentMessages);
    const recentMessages = recentTgMessages.map((m) => ({
      role: m.isFromAgent ? "assistant" : "user",
      content: m.text ?? "",
    }));

    const relevantKnowledge: string[] = [];
    if (includeAgentMemory) {
      try {
        const knowledgeResults = await this.hybridSearch.searchKnowledge(query, queryEmbedding, {
          limit: maxRelevantChunks,
        });
        relevantKnowledge.push(...reorderForEdges(knowledgeResults.map((r) => r.text)));
      } catch (error) {
        log.warn({ err: error }, "Knowledge search failed");
      }
    }

    const recentTextsSet = new Set(
      recentTgMessages.filter((m) => m.text && m.text.length > 0).map((m) => m.text!)
    );

    const relevantFeed: string[] = [];
    if (includeFeedHistory) {
      try {
        const feedResults = await this.hybridSearch.searchMessages(query, queryEmbedding, {
          chatId,
          limit: maxRelevantChunks,
        });
        for (const r of feedResults) {
          if (!recentTextsSet.has(r.text)) {
            relevantFeed.push(truncateFeedMessage(r.text));
          }
        }

        if (searchAllChats) {
          const globalResults = await this.hybridSearch.searchMessages(query, queryEmbedding, {
            limit: maxRelevantChunks,
          });
          const existingTexts = new Set(relevantFeed);
          for (const r of globalResults) {
            const truncated = truncateFeedMessage(r.text);
            if (!existingTexts.has(truncated)) {
              relevantFeed.push(`[From chat ${r.source}]: ${truncated}`);
            }
          }
        }
      } catch (error) {
        log.warn({ err: error }, "Feed search failed");
      }

      if (relevantFeed.length === 0 && recentTgMessages.length > 0) {
        const recentTexts = recentTgMessages
          .filter((m) => m.text && m.text.length > 0)
          .slice(-maxRelevantChunks)
          .map((m) => {
            const sender = m.isFromAgent ? "Agent" : "User";
            return `[${sender}]: ${m.text}`;
          });
        relevantFeed.push(...recentTexts);
      }
    }

    const allText =
      recentMessages.map((m) => m.content).join(" ") +
      relevantKnowledge.join(" ") +
      relevantFeed.join(" ");
    const estimatedTokens = Math.ceil(allText.length / 4);

    return {
      recentMessages,
      relevantKnowledge,
      relevantFeed,
      estimatedTokens,
    };
  }
}
