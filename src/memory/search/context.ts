import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { HybridSearch } from "./hybrid.js";
import { MessageStore } from "../feed/messages.js";

export interface ContextOptions {
  query: string;
  chatId: string;
  includeAgentMemory?: boolean;
  includeFeedHistory?: boolean;
  searchAllChats?: boolean; // Search across all chats, not just current
  maxRecentMessages?: number;
  maxRelevantChunks?: number;
  maxTokens?: number;
}

export interface Context {
  recentMessages: Array<{ role: string; content: string }>;
  relevantKnowledge: string[];
  relevantFeed: string[];
  estimatedTokens: number;
}

/**
 * Build context for Claude from memory + feed
 */
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

    // Embed query for semantic search (if embeddings are enabled)
    const queryEmbedding = await this.embedder.embedQuery(query);

    // Get recent messages from current chat
    const recentTgMessages = this.messageStore.getRecentMessages(chatId, maxRecentMessages);
    const recentMessages = recentTgMessages.map((m) => ({
      role: m.isFromAgent ? "assistant" : "user",
      content: m.text ?? "",
    }));

    // Search agent memory (from knowledge base)
    const relevantKnowledge: string[] = [];
    if (includeAgentMemory) {
      try {
        const knowledgeResults = await this.hybridSearch.searchKnowledge(query, queryEmbedding, {
          limit: maxRelevantChunks,
        });
        relevantKnowledge.push(...knowledgeResults.map((r) => r.text));
      } catch (error) {
        console.warn("Knowledge search failed:", error);
      }
    }

    // Search feed history (semantic search on past messages)
    const relevantFeed: string[] = [];
    if (includeFeedHistory) {
      try {
        // Search current chat
        const feedResults = await this.hybridSearch.searchMessages(query, queryEmbedding, {
          chatId,
          limit: maxRelevantChunks,
        });
        relevantFeed.push(...feedResults.map((r) => r.text));

        // Also search all chats if requested (for cross-group context)
        if (searchAllChats) {
          const globalResults = await this.hybridSearch.searchMessages(query, queryEmbedding, {
            // No chatId = search all chats
            limit: maxRelevantChunks,
          });
          // Add results from other chats (avoiding duplicates)
          const existingTexts = new Set(relevantFeed);
          for (const r of globalResults) {
            if (!existingTexts.has(r.text)) {
              relevantFeed.push(`[From chat ${r.source}]: ${r.text}`);
            }
          }
        }
      } catch (error) {
        console.warn("Feed search failed:", error);
      }

      // If semantic search returned nothing, include recent messages as feed context
      // This ensures the agent always has some memory even without embeddings
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

    // Estimate tokens (rough: 1 token ≈ 4 chars)
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
