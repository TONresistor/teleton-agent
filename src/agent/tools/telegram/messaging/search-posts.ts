import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getClient } from "../../../../sdk/telegram-utils.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import {
  createNextSearchCursor,
  createSearchRequestHash,
  decodeSearchCursor,
  extractSearchPage,
  mapSearchTelegramError,
  normalizeHashtag,
  normalizeSearchQuota,
  normalizeSearchText,
  sortSearchHits,
  type TelegramSearchQuota,
  type TelegramSearchSort,
} from "./search-utils.js";

const log = createLogger("Tools");

interface SearchPostsParams {
  query?: string;
  hashtag?: string;
  limit?: number;
  sort?: TelegramSearchSort;
  cursor?: string;
}

export const telegramSearchPostsTool: Tool = {
  name: "telegram_search_posts",
  description:
    "Search posts across all public Telegram channels, including channels the account has not joined. Provide exactly one full-text query or hashtag. Full-text search may automatically consume one remaining free daily search slot, but this tool never spends Telegram Stars. Hashtags and cursor pagination are free. NOT for messages in the account's own chats (use telegram_search_global).",
  category: "data-bearing",
  parameters: Type.Object({
    query: Type.Optional(
      Type.String({
        description:
          "Full-text public post query. Mutually exclusive with hashtag. May consume one free daily search slot.",
      })
    ),
    hashtag: Type.Optional(
      Type.String({
        description:
          "Public post hashtag, with or without '#'. Mutually exclusive with query and does not use the full-text quota.",
      })
    ),
    limit: Type.Optional(
      Type.Integer({
        description: "Maximum posts for this page (default: 20, max: 100).",
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

function paymentRequiredResult(query: string, quota: TelegramSearchQuota): ToolResult {
  return {
    success: true,
    data: {
      status: "payment_required",
      searchExecuted: false,
      query,
      posts: [],
      count: 0,
      quota,
      summary: `Telegram's free public-post search quota is exhausted. Wait until ${quota.waitUntilIso ?? "the quota resets"}; this tool will not spend ${quota.starsRequired} Stars.`,
    },
  };
}

export const telegramSearchPostsExecutor: ToolExecutor<SearchPostsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  const query = normalizeSearchText(params.query);
  const hashtag = normalizeHashtag(params.hashtag);
  const hasQuery = query.length > 0;
  const hasHashtag = hashtag.length > 0;
  if (hasQuery === hasHashtag) {
    return {
      success: false,
      error: "Provide exactly one non-empty query or hashtag.",
    };
  }

  const limit = params.limit ?? 20;
  const sort = params.sort ?? "telegram";
  const requestHash = createSearchRequestHash({
    kind: "posts",
    query: hasQuery ? query : null,
    hashtag: hasHashtag ? hashtag : null,
    sort,
  });
  const decodedCursor = decodeSearchCursor(params.cursor, "posts", requestHash);
  if (!decodedCursor.ok) return { success: false, error: decodedCursor.error };

  try {
    const client = getClient(context.bridge);
    let quota: TelegramSearchQuota | null = null;

    if (hasQuery && !params.cursor) {
      const preflight = await client.invoke(new Api.channels.CheckSearchPostsFlood({ query }));
      quota = normalizeSearchQuota(preflight);
      if (!quota.queryIsFree && quota.remaining <= 0) {
        return paymentRequiredResult(query, quota);
      }
    }

    const response = await client.invoke(
      new Api.channels.SearchPosts({
        query: hasQuery ? query : undefined,
        hashtag: hasHashtag ? hashtag : undefined,
        offsetRate: decodedCursor.offset.offsetRate,
        offsetPeer: decodedCursor.offset.offsetPeer,
        offsetId: decodedCursor.offset.offsetId,
        limit,
      })
    );

    const page = extractSearchPage(response);
    const posts = sortSearchHits(page.hits, sort);
    if (page.searchFlood) quota = normalizeSearchQuota(page.searchFlood);
    const pagination = createNextSearchCursor({
      kind: "posts",
      requestHash,
      page,
      limit,
      previousSeen: decodedCursor.offset.seen,
    });

    return {
      success: true,
      data: {
        status: "ok",
        searchExecuted: true,
        ...(hasQuery ? { query } : { hashtag }),
        posts,
        count: posts.length,
        sort,
        sortScope: "page",
        pagination: {
          limit,
          returned: posts.length,
          total: page.total,
          inexact: page.inexact,
          hasMore: pagination.hasMore,
          nextCursor: pagination.nextCursor,
        },
        ...(quota ? { quota } : {}),
        summary: `Found ${posts.length} public Telegram post(s)${pagination.hasMore ? "; use nextCursor for more" : ""}.`,
      },
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    if (hasQuery && errorMessage.includes("STARS_PAYMENT_REQUIRED")) {
      try {
        const client = getClient(context.bridge);
        const refreshed = await client.invoke(new Api.channels.CheckSearchPostsFlood({ query }));
        return paymentRequiredResult(query, normalizeSearchQuota(refreshed));
      } catch (quotaError) {
        log.error({ err: quotaError }, "Error refreshing Telegram public post search quota");
      }
    }

    log.error({ err: error }, "Error searching public Telegram posts");
    return mapSearchTelegramError(error, {
      STARS_PAYMENT_REQUIRED:
        "Telegram requires Stars for this public post search. No Stars were spent.",
    });
  }
};
