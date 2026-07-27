import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import type { ToolContext } from "../../../types.js";
import { telegramSearchPostsExecutor, telegramSearchPostsTool } from "../search-posts.js";

const invoke = vi.fn();

const context = {
  bridge: {
    getMode: () => "user",
    getClient: () => ({
      getClient: () => ({ invoke }),
    }),
  },
  chatId: "123",
  senderId: 456,
  isGroup: false,
} as unknown as ToolContext;

function channel(): Api.Channel {
  return new Api.Channel({
    id: 123n,
    accessHash: 456n,
    title: "Public Channel",
    username: "public_channel",
    broadcast: true,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
  });
}

function post(id: number, date = 1000): Api.Message {
  return new Api.Message({
    id,
    peerId: new Api.PeerChannel({ channelId: 123n }),
    fromId: new Api.PeerChannel({ channelId: 123n }),
    date,
    message: `post-${id}`,
    post: true,
    views: id,
    forwards: id - 1,
  });
}

function quota(remains: number, queryIsFree = false): Api.SearchPostsFlood {
  return new Api.SearchPostsFlood({
    queryIsFree,
    totalDaily: 10,
    remains,
    waitTill: 1_767_225_600,
    starsAmount: 25n,
  });
}

function response(
  posts: Api.TypeMessage[],
  options: {
    count?: number;
    nextRate?: number;
    searchFlood?: Api.SearchPostsFlood;
  } = {}
): Api.messages.MessagesSlice {
  return new Api.messages.MessagesSlice({
    count: options.count ?? posts.length,
    nextRate: options.nextRate,
    searchFlood: options.searchFlood,
    messages: posts,
    topics: [],
    chats: [channel()],
    users: [],
  });
}

describe("telegram_search_posts", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("declares a user-mode data-bearing search schema", () => {
    expect(telegramSearchPostsTool).toMatchObject({
      name: "telegram_search_posts",
      category: "data-bearing",
    });
  });

  it.each([
    [{}, "missing both"],
    [{ query: "text", hashtag: "tag" }, "both provided"],
    [{ query: "   " }, "blank query"],
    [{ hashtag: "#" }, "blank hashtag"],
  ])("rejects $1 before Telegram when %s", async (params) => {
    const result = await telegramSearchPostsExecutor(params, context);

    expect(result).toEqual({
      success: false,
      error: "Provide exactly one non-empty query or hashtag.",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("normalizes hashtags and bypasses the full-text quota preflight", async () => {
    invoke.mockResolvedValue(response([post(10)]));

    const result = await telegramSearchPostsExecutor({ hashtag: " #TON " }, context);

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    const request = invoke.mock.calls[0][0] as Api.channels.SearchPosts;
    expect(request).toBeInstanceOf(Api.channels.SearchPosts);
    expect(request.hashtag).toBe("TON");
    expect(request.query).toBeUndefined();
    expect((result.data as any).hashtag).toBe("TON");
  });

  it("automatically consumes an available free full-text slot", async () => {
    invoke
      .mockResolvedValueOnce(quota(3))
      .mockResolvedValueOnce(response([post(10)], { searchFlood: quota(2) }));

    const result = await telegramSearchPostsExecutor({ query: "telegram search" }, context);

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0]).toBeInstanceOf(Api.channels.CheckSearchPostsFlood);
    const request = invoke.mock.calls[1][0] as Api.channels.SearchPosts;
    expect(request).toBeInstanceOf(Api.channels.SearchPosts);
    expect(request.query).toBe("telegram search");
    expect(request.allowPaidStars).toBeUndefined();
    expect((result.data as any).quota.remaining).toBe(2);
  });

  it("executes a server-cached free query even with no remaining daily slots", async () => {
    invoke.mockResolvedValueOnce(quota(0, true)).mockResolvedValueOnce(response([post(10)]));

    const result = await telegramSearchPostsExecutor({ query: "cached" }, context);

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("returns payment_required without searching or spending Stars", async () => {
    invoke.mockResolvedValue(quota(0));

    const result = await telegramSearchPostsExecutor({ query: "limited" }, context);

    expect(result).toMatchObject({
      success: true,
      data: {
        status: "payment_required",
        searchExecuted: false,
        query: "limited",
        posts: [],
        quota: {
          remaining: 0,
          starsRequired: "25",
        },
      },
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0][0]).toBeInstanceOf(Api.channels.CheckSearchPostsFlood);
  });

  it("paginates a full-text search without spending another free slot", async () => {
    invoke
      .mockResolvedValueOnce(quota(3))
      .mockResolvedValueOnce(
        response([post(10)], { count: 2, nextRate: 777, searchFlood: quota(2) })
      )
      .mockResolvedValueOnce(response([]));

    const first = await telegramSearchPostsExecutor({ query: "needle", limit: 1 }, context);
    const cursor = (first.data as any).pagination.nextCursor as string;
    const second = await telegramSearchPostsExecutor(
      { query: "needle", limit: 1, cursor },
      context
    );

    expect(second.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(3);
    const secondRequest = invoke.mock.calls[2][0] as Api.channels.SearchPosts;
    expect(secondRequest).toBeInstanceOf(Api.channels.SearchPosts);
    expect(secondRequest.offsetRate).toBe(777);
    expect(secondRequest.offsetId).toBe(10);
    expect(secondRequest.allowPaidStars).toBeUndefined();
  });

  it("turns a quota race into payment_required", async () => {
    invoke
      .mockResolvedValueOnce(quota(1))
      .mockRejectedValueOnce(new Error("STARS_PAYMENT_REQUIRED"))
      .mockResolvedValueOnce(quota(0));

    const result = await telegramSearchPostsExecutor({ query: "race" }, context);

    expect(result).toMatchObject({
      success: true,
      data: {
        status: "payment_required",
        searchExecuted: false,
        quota: { remaining: 0 },
      },
    });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("maps Premium and frozen-account errors clearly", async () => {
    invoke.mockRejectedValueOnce(new Error("PREMIUM_ACCOUNT_REQUIRED"));
    const premium = await telegramSearchPostsExecutor({ query: "premium" }, context);
    expect(premium).toEqual({
      success: false,
      error: "Telegram Premium is required for this public post search.",
    });

    invoke.mockRejectedValueOnce(new Error("FROZEN_METHOD_INVALID"));
    const frozen = await telegramSearchPostsExecutor({ query: "frozen" }, context);
    expect(frozen).toEqual({
      success: false,
      error: "This Telegram account is frozen and cannot search public posts.",
    });
  });
});
