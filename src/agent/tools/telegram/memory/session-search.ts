import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getEffectiveApiKey } from "../../../client.js";
import { summarizeViaClaude } from "../../../../memory/ai-summarization.js";
import { escapeFts5Query } from "../../../../memory/search/fts-utils.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import type { SupportedProvider } from "../../../../config/providers.js";

const log = createLogger("Tools");

/** Two hours in seconds — clustering window. */
const CLUSTER_GAP_S = 2 * 60 * 60;

interface SessionSearchParams {
  query: string;
  limit?: number;
}

interface FtsRow {
  text: string;
  chat_id: string;
  sender_id: number;
  timestamp: number;
  rank: number;
}

interface Cluster {
  messages: FtsRow[];
  totalRank: number;
}

/**
 * Group messages into clusters where consecutive messages
 * are within CLUSTER_GAP_S of each other.
 */
function clusterMessages(rows: FtsRow[]): Cluster[] {
  if (rows.length === 0) return [];

  const sorted = [...rows].sort((a, b) => a.timestamp - b.timestamp);
  const clusters: Cluster[] = [];
  let current: Cluster = { messages: [sorted[0]], totalRank: Math.abs(sorted[0].rank) };

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].timestamp - sorted[i - 1].timestamp;
    if (gap <= CLUSTER_GAP_S) {
      current.messages.push(sorted[i]);
      current.totalRank += Math.abs(sorted[i].rank);
    } else {
      clusters.push(current);
      current = { messages: [sorted[i]], totalRank: Math.abs(sorted[i].rank) };
    }
  }
  clusters.push(current);
  return clusters;
}

/**
 * Format a cluster timestamp range as a human-readable string.
 */
function formatWhen(cluster: Cluster): string {
  const first = new Date(cluster.messages[0].timestamp * 1000);
  const last = new Date(cluster.messages[cluster.messages.length - 1].timestamp * 1000);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (first.toDateString() === last.toDateString()) {
    return fmt(first);
  }
  return `${fmt(first)} — ${fmt(last)}`;
}

export const sessionSearchTool: Tool = {
  name: "session_search",
  description:
    "Search locally stored agent-session history across ALL chats by keywords. Results are clustered by time and AI-summarized. Use to recall past discussions from previous sessions. NOT for live Telegram data — use telegram_search_messages for one chat, telegram_search_global for the account, or telegram_search_posts for public posts. NOT for knowledge/documents — use memory_search.",
  category: "data-bearing",
  parameters: Type.Object({
    query: Type.String({
      description: "Keywords to search for in past conversations.",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Max result clusters to return (default 3, max 5).",
        minimum: 1,
        maximum: 5,
      })
    ),
  }),
};

export const sessionSearchExecutor: ToolExecutor<SessionSearchParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const safeQuery = escapeFts5Query(params.query);
    if (!safeQuery) {
      return { success: false, error: "Query is empty after sanitization." };
    }

    const limit = Math.min(params.limit ?? 3, 5);
    // FTS5 search across tg_messages
    const rows = context.db
      .prepare(
        `SELECT m.text, m.chat_id, m.sender_id, m.timestamp, mf.rank
         FROM tg_messages_fts mf
         JOIN tg_messages m ON m.rowid = mf.rowid
         WHERE tg_messages_fts MATCH ?
         ORDER BY mf.rank
         LIMIT 50`
      )
      .all(safeQuery) as FtsRow[];

    if (rows.length === 0) {
      return {
        success: true,
        data: { results: [], message: "No matching conversations found." },
      };
    }

    // Keep conversations from different chats separate even when their
    // timestamps overlap.
    const rowsByChat = new Map<string, FtsRow[]>();
    for (const row of rows) {
      const chatRows = rowsByChat.get(row.chat_id) ?? [];
      chatRows.push(row);
      rowsByChat.set(row.chat_id, chatRows);
    }
    const clusters = [...rowsByChat.values()].flatMap(clusterMessages);

    // Sort by total FTS5 rank score (higher absolute rank = more relevant)
    clusters.sort((a, b) => b.totalRank - a.totalRank);

    const topClusters = clusters.slice(0, limit);

    // Resolve summarization config
    const provider = (context.config?.agent?.provider ?? "anthropic") as SupportedProvider;
    const apiKey = context.config?.agent?.api_key
      ? getEffectiveApiKey(provider, context.config.agent.api_key)
      : "";

    const results: Array<{
      chatId: string;
      when: string;
      summary: string;
      messageCount: number;
    }> = [];

    for (const cluster of topClusters) {
      const when = formatWhen(cluster);
      const transcript = cluster.messages.map((m) => m.text).join("\n");

      let summary: string;
      if (apiKey) {
        try {
          summary = await summarizeViaClaude({
            messages: [
              {
                role: "user" as const,
                content: transcript,
                timestamp: Date.now(),
              },
            ],
            apiKey,
            provider,
            utilityModel: context.config?.agent?.utility_model,
            maxSummaryTokens: 300,
            customInstructions:
              "Summarize this conversation excerpt in 2-3 sentences. Focus on the topic and key points discussed.",
          });
        } catch (err) {
          log.warn({ err }, "Session search summarization failed, using raw snippet");
          summary = transcript.slice(0, 500) + (transcript.length > 500 ? "…" : "");
        }
      } else {
        summary = transcript.slice(0, 500) + (transcript.length > 500 ? "…" : "");
      }

      results.push({
        chatId: cluster.messages[0].chat_id,
        when,
        summary,
        messageCount: cluster.messages.length,
      });
    }

    return {
      success: true,
      data: { query: params.query, count: results.length, results },
    };
  } catch (error) {
    log.error({ err: error }, "Error in session_search");
    return { success: false, error: getErrorMessage(error) };
  }
};
