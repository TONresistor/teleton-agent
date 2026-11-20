import { Type } from "@sinclair/typebox";
import type { Tool, ToolContext, ToolExecutor } from "../../types.js";
import { escapeFts5Query } from "../../../../memory/search/fts-utils.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/** Two hours in seconds — clustering window. */
const CLUSTER_GAP_S = 2 * 60 * 60;
const MAX_EXCERPT_CHARS = 400;
const MAX_MESSAGE_CHARS = 1000;
const MAX_NEIGHBORS = 5;
const FTS_EXCERPT = "snippet(tg_messages_fts, 0, '', '', '…', 24)";

interface SessionSearchParams {
  query: string;
  limit?: number;
}

interface MessageLocation {
  chatId: string;
  messageId: string;
}

interface SessionReadContextParams extends MessageLocation {
  direction?: "around" | "before" | "after" | "message";
  textOffset?: number;
  limit?: number;
}

interface MessageRow {
  id: string;
  chat_id: string;
  sender_id: string | null;
  username: string | null;
  author_name: string | null;
  is_from_agent: number | null;
  timestamp: number;
}

interface FtsRow extends MessageRow {
  preview: string;
  excerpt: string;
  excerpt_truncated: number;
  rank: number;
}

interface ContextRow extends MessageRow {
  text: string | null;
  text_truncated: number | null;
}

const MESSAGE_COLUMNS = `
  m.id, m.chat_id, m.sender_id, m.is_from_agent, m.timestamp, u.username,
  NULLIF(trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS author_name
`;

function messageSource(row: MessageRow) {
  return {
    chatId: row.chat_id,
    messageId: row.id,
    date: new Date(row.timestamp * 1000).toISOString(),
    author:
      row.sender_id === null
        ? null
        : { id: row.sender_id, username: row.username, name: row.author_name },
    isFromAgent: row.is_from_agent === 1,
  };
}

function historyScope(context: ToolContext): "dm" | "group" | null {
  if (context.isGuest || !context.chatId?.trim()) return null;
  if (context.telegramChatType === "group" && context.isGroup === true) return "group";
  if (
    context.telegramChatType === "dm" &&
    context.isGroup === false &&
    context.config?.telegram?.dm_policy !== "disabled"
  ) {
    return "dm";
  }
  return null;
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
    "Find source messages by keyword in local session history. Searches across stored chats for the owner in DMs and groups. Use a match's chatId and messageId with session_read_context to check surrounding replies and corrections before stating a past decision. For live Telegram data use telegram_search_messages, telegram_search_global, or telegram_search_posts. For indexed documents use memory_search.",
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

export const sessionSearchExecutor: ToolExecutor<SessionSearchParams> = async (params, context) => {
  const scope = historyScope(context);
  if (!scope) return { success: false, error: "Session history requires a Telegram DM or group." };

  try {
    const safeQuery = escapeFts5Query(params.query);
    if (!safeQuery) {
      return { success: false, error: "Query is empty after sanitization." };
    }

    const limit = Math.min(params.limit ?? 3, 5);
    const rows = context.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS}, mf.rank, substr(m.text, 1, 501) AS preview,
                substr(${FTS_EXCERPT}, 1, ${MAX_EXCERPT_CHARS}) AS excerpt,
                (substr(${FTS_EXCERPT}, 1, ${MAX_EXCERPT_CHARS}) != m.text) AS excerpt_truncated
         FROM tg_messages_fts mf
         JOIN tg_messages m ON m.rowid = mf.rowid
         LEFT JOIN tg_users u ON u.id = m.sender_id
         WHERE tg_messages_fts MATCH ?
         ORDER BY mf.rank, m.timestamp, m.chat_id, m.id
         LIMIT 50`
      )
      .all(safeQuery) as FtsRow[];

    if (rows.length === 0) {
      return {
        success: true,
        data: { results: [], message: "No matching conversations found in the available history." },
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

    const results = clusters.slice(0, limit).map((cluster) => {
      const preview = cluster.messages.map((message) => message.preview).join("\n");
      return {
        chatId: cluster.messages[0].chat_id,
        when: formatWhen(cluster),
        summary: preview.slice(0, 500) + (preview.length > 500 ? "…" : ""),
        summaryKind: "keyword-match preview",
        messageCount: cluster.messages.length,
        matches: [...cluster.messages]
          .sort((a, b) => a.rank - b.rank)
          .slice(0, 3)
          .map((message) => ({
            ...messageSource(message),
            excerpt: message.excerpt,
            excerptTruncated: Boolean(message.excerpt_truncated),
          })),
      };
    });

    return {
      success: true,
      data: { query: params.query, count: results.length, results },
    };
  } catch (error) {
    log.error({ err: error }, "Error in session_search");
    return { success: false, error: getErrorMessage(error) };
  }
};

export const sessionReadContextTool: Tool = {
  name: "session_read_context",
  description:
    "Read stored messages around a session_search match in the same chat, including replies without the search keywords. Null text means no text was stored. For more messages, reuse nextBefore or nextAfter as the chatId and messageId with direction 'before' or 'after'. Those pages exclude the boundary message. To continue truncated text, pass its nextTextOffset with the same chatId and messageId and direction 'message'. Text offsets count Unicode characters.",
  category: "data-bearing",
  parameters: Type.Object({
    chatId: Type.String({ minLength: 1, description: "Chat ID of the source or page boundary." }),
    messageId: Type.String({
      minLength: 1,
      description: "Stored message ID within that chat, as returned by the tool.",
    }),
    direction: Type.Optional(
      Type.Union(
        [
          Type.Literal("around"),
          Type.Literal("before"),
          Type.Literal("after"),
          Type.Literal("message"),
        ],
        {
          description: "Defaults to 'around', which includes the source message.",
        }
      )
    ),
    textOffset: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: 2147482647,
        description: "Character offset for direction message, from nextTextOffset.",
      })
    ),
    limit: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: MAX_NEIGHBORS,
        description: "Whole number of messages per requested side (default 3, max 5).",
      })
    ),
  }),
};

export const sessionReadContextExecutor: ToolExecutor<SessionReadContextParams> = async (
  { chatId, messageId, direction = "around", limit = 3, textOffset = 0 },
  context
) => {
  const scope = historyScope(context);
  if (!scope) return { success: false, error: "Session history requires a Telegram DM or group." };
  if (!chatId.trim() || !messageId.trim()) {
    return { success: false, error: "Provide a nonempty chat ID and message ID." };
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_NEIGHBORS) {
    return { success: false, error: `Limit must be a whole number from 1 to ${MAX_NEIGHBORS}.` };
  }

  if (
    !Number.isInteger(textOffset) ||
    textOffset < 0 ||
    textOffset > 2147482647 ||
    (textOffset !== 0 && direction !== "message")
  ) {
    return { success: false, error: "Use a nonnegative whole textOffset with direction message." };
  }

  try {
    const db = context.db;
    const select = `SELECT ${MESSAGE_COLUMNS}, substr(m.text, ${textOffset + 1}, ${MAX_MESSAGE_CHARS}) AS text,
                           length(m.text) > ${textOffset + MAX_MESSAGE_CHARS} AS text_truncated
                    FROM tg_messages m
                    LEFT JOIN tg_users u ON u.id = m.sender_id
                    WHERE m.chat_id = ?`;

    return db.transaction(() => {
      const anchor = db.prepare(`${select} AND m.id = ?`).get(chatId, messageId) as
        ContextRow | undefined;
      if (!anchor) {
        return { success: false, error: "Anchor message is unavailable in the local history." };
      }

      // IDs are stored as TEXT. Use the same SQLite order in both the boundary and sort.
      const readSide = (side: "before" | "after") => {
        const comparison = side === "before" ? "<" : ">";
        const order = side === "before" ? "DESC" : "ASC";
        const rows = db
          .prepare(
            `${select} AND (m.timestamp, m.id) ${comparison} (?, ?)
             ORDER BY m.timestamp ${order}, m.id ${order} LIMIT ?`
          )
          .all(chatId, anchor.timestamp, anchor.id, limit + 1) as ContextRow[];
        const hasMore = rows.length > limit;
        if (hasMore) rows.pop();
        const boundary = hasMore ? rows.at(-1) : undefined;
        return { rows, next: boundary ? { chatId, messageId: boundary.id } : null };
      };

      const before =
        direction === "after" || direction === "message"
          ? { rows: [], next: null }
          : readSide("before");
      const after =
        direction === "before" || direction === "message"
          ? { rows: [], next: null }
          : readSide("after");
      const rows = [
        ...before.rows.reverse(),
        ...(direction === "around" || direction === "message" ? [anchor] : []),
        ...after.rows,
      ];
      return {
        success: true,
        data: {
          messages: rows.map((row) => ({
            ...messageSource(row),
            text: row.text || null,
            textTruncated: Boolean(row.text_truncated),
            textOffset,
            nextTextOffset: row.text_truncated ? textOffset + MAX_MESSAGE_CHARS : null,
          })),
          nextBefore: before.next,
          nextAfter: after.next,
        },
      };
    })();
  } catch (error) {
    log.error({ err: error }, "Error in session_read_context");
    return { success: false, error: getErrorMessage(error) };
  }
};
