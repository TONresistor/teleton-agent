import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getClient } from "../../../../sdk/telegram-utils.js";
import { createLogger } from "../../../../utils/logger.js";
import {
  createNextSearchCursor,
  createSearchRequestHash,
  decodeSearchCursor,
  extractSearchPage,
  getMessagesFilter,
  mapSearchTelegramError,
  normalizeSearchText,
  parseSearchDate,
  sortSearchHits,
  type TelegramSearchMessageType,
  type TelegramSearchPeerType,
  type TelegramSearchSort,
} from "./search-utils.js";

const log = createLogger("Tools");

interface SearchGlobalParams {
  query?: string;
  peerType?: TelegramSearchPeerType;
  messageType?: TelegramSearchMessageType;
  after?: string;
  before?: string;
  folderId?: number;
  limit?: number;
  sort?: TelegramSearchSort;
  cursor?: string;
}

export const telegramSearchGlobalTool: Tool = {
  name: "telegram_search_global",
  description:
    "Search live messages across all chats accessible to the Telegram account. Use query for keywords or messageType for a global media search. Filter by chat type, folder, or date and paginate with cursor. NOT for a known chat (use telegram_search_messages), public posts outside the account (use telegram_search_posts), or locally remembered conversations (use session_search).",
  category: "data-bearing",
  parameters: Type.Object({
    query: Type.Optional(
      Type.String({
        description:
          "Keyword or phrase. May be empty only when messageType is not 'all' (for example, all photos).",
      })
    ),
    peerType: Type.Optional(
      Type.Union(
        [
          Type.Literal("all"),
          Type.Literal("channels"),
          Type.Literal("groups"),
          Type.Literal("users"),
        ],
        {
          description: "Restrict results to channels, groups, or private chats. Default: all.",
        }
      )
    ),
    messageType: Type.Optional(
      Type.Union(
        [
          Type.Literal("all"),
          Type.Literal("photos"),
          Type.Literal("videos"),
          Type.Literal("photo_video"),
          Type.Literal("documents"),
          Type.Literal("links"),
          Type.Literal("gifs"),
          Type.Literal("voice"),
          Type.Literal("music"),
          Type.Literal("round_video"),
          Type.Literal("polls"),
          Type.Literal("pinned"),
        ],
        {
          description: "Telegram message filter. Default: all.",
        }
      )
    ),
    after: Type.Optional(
      Type.String({
        description: "Only messages after this ISO 8601 date or Unix timestamp in seconds.",
      })
    ),
    before: Type.Optional(
      Type.String({
        description: "Only messages before this ISO 8601 date or Unix timestamp in seconds.",
      })
    ),
    folderId: Type.Optional(
      Type.Integer({
        description: "Telegram dialog folder ID.",
        minimum: 0,
      })
    ),
    limit: Type.Optional(
      Type.Integer({
        description: "Maximum results for this page (default: 20, max: 100).",
        minimum: 1,
        maximum: 100,
      })
    ),
    sort: Type.Optional(
      Type.Union(
        [
          Type.Literal("telegram"),
          Type.Literal("date_desc"),
          Type.Literal("date_asc"),
          Type.Literal("views_desc"),
          Type.Literal("forwards_desc"),
        ],
        {
          description:
            "Sort this returned page only. Default 'telegram' preserves Telegram's server order.",
        }
      )
    ),
    cursor: Type.Optional(
      Type.String({
        description: "Opaque nextCursor returned by a previous identical search.",
        maxLength: 2048,
      })
    ),
  }),
};

export const telegramSearchGlobalExecutor: ToolExecutor<SearchGlobalParams> = async (
  params,
  context
): Promise<ToolResult> => {
  const query = normalizeSearchText(params.query);
  const peerType = params.peerType ?? "all";
  const messageType = params.messageType ?? "all";
  const limit = params.limit ?? 20;
  const sort = params.sort ?? "telegram";

  if (!query && messageType === "all") {
    return {
      success: false,
      error: "Provide a query, or select a messageType other than 'all'.",
    };
  }

  const after = parseSearchDate(params.after, "after");
  if (!after.ok) return { success: false, error: after.error };
  const before = parseSearchDate(params.before, "before");
  if (!before.ok) return { success: false, error: before.error };
  if (after.value > 0 && before.value > 0 && after.value >= before.value) {
    return { success: false, error: "after must be earlier than before" };
  }

  const requestHash = createSearchRequestHash({
    kind: "global",
    query,
    peerType,
    messageType,
    minDate: after.value,
    maxDate: before.value,
    folderId: params.folderId ?? null,
    sort,
  });
  const decodedCursor = decodeSearchCursor(params.cursor, "global", requestHash);
  if (!decodedCursor.ok) return { success: false, error: decodedCursor.error };

  try {
    const client = getClient(context.bridge);
    const response = await client.invoke(
      new Api.messages.SearchGlobal({
        broadcastsOnly: peerType === "channels" ? true : undefined,
        groupsOnly: peerType === "groups" ? true : undefined,
        usersOnly: peerType === "users" ? true : undefined,
        folderId: params.folderId,
        q: query,
        filter: getMessagesFilter(messageType),
        minDate: after.value,
        maxDate: before.value,
        offsetRate: decodedCursor.offset.offsetRate,
        offsetPeer: decodedCursor.offset.offsetPeer,
        offsetId: decodedCursor.offset.offsetId,
        limit,
      })
    );

    const page = extractSearchPage(response);
    const messages = sortSearchHits(page.hits, sort);
    const pagination = createNextSearchCursor({
      kind: "global",
      requestHash,
      page,
      limit,
      previousSeen: decodedCursor.offset.seen,
    });

    return {
      success: true,
      data: {
        status: "ok",
        query,
        filters: {
          peerType,
          messageType,
          after: after.value || null,
          before: before.value || null,
          folderId: params.folderId ?? null,
        },
        messages,
        count: messages.length,
        sort,
        sortScope: "page",
        pagination: {
          limit,
          returned: messages.length,
          total: page.total,
          inexact: page.inexact,
          hasMore: pagination.hasMore,
          nextCursor: pagination.nextCursor,
        },
        summary: `Found ${messages.length} Telegram message(s) across the account${pagination.hasMore ? "; use nextCursor for more" : ""}. Telegram global search may return at most one message per chat.`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error searching Telegram globally");
    return mapSearchTelegramError(error);
  }
};
