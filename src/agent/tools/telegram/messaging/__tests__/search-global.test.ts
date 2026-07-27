import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import type { ToolContext } from "../../../types.js";
import { telegramSearchGlobalExecutor, telegramSearchGlobalTool } from "../search-global.js";

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
    title: "Channel",
    username: "channel",
    broadcast: true,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
  });
}

function message(id: number, date: number, views = 0): Api.Message {
  return new Api.Message({
    id,
    peerId: new Api.PeerChannel({ channelId: 123n }),
    fromId: new Api.PeerChannel({ channelId: 123n }),
    date,
    message: `result-${id}`,
    post: true,
    views,
  });
}

function response(
  messages: Api.TypeMessage[],
  options: { count?: number; nextRate?: number } = {}
): Api.messages.MessagesSlice {
  return new Api.messages.MessagesSlice({
    count: options.count ?? messages.length,
    nextRate: options.nextRate,
    messages,
    topics: [],
    chats: [channel()],
    users: [],
  });
}

describe("telegram_search_global", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("declares a user-mode data-bearing search schema", () => {
    expect(telegramSearchGlobalTool).toMatchObject({
      name: "telegram_search_global",
      category: "data-bearing",
    });
  });

  it("uses the documented defaults for a keyword search", async () => {
    invoke.mockResolvedValue(response([]));

    const result = await telegramSearchGlobalExecutor({ query: "  needle  " }, context);

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    const request = invoke.mock.calls[0][0];
    expect(request).toBeInstanceOf(Api.messages.SearchGlobal);
    expect(request).toMatchObject({
      q: "needle",
      minDate: 0,
      maxDate: 0,
      offsetRate: 0,
      offsetId: 0,
      limit: 20,
    });
    expect(request.filter).toBeInstanceOf(Api.InputMessagesFilterEmpty);
    expect(request.offsetPeer).toBeInstanceOf(Api.InputPeerEmpty);
    expect(request.broadcastsOnly).toBeUndefined();
    expect(request.groupsOnly).toBeUndefined();
    expect(request.usersOnly).toBeUndefined();
  });

  it("maps account, media, date, and folder filters to SearchGlobal", async () => {
    invoke.mockResolvedValue(response([]));

    const result = await telegramSearchGlobalExecutor(
      {
        peerType: "channels",
        messageType: "photos",
        after: "2026-01-01T00:00:00Z",
        before: "1767312000",
        folderId: 2,
        limit: 5,
      },
      context
    );

    expect(result.success).toBe(true);
    const request = invoke.mock.calls[0][0] as Api.messages.SearchGlobal;
    expect(request).toMatchObject({
      q: "",
      broadcastsOnly: true,
      groupsOnly: undefined,
      usersOnly: undefined,
      folderId: 2,
      minDate: 1_767_225_600,
      maxDate: 1_767_312_000,
      limit: 5,
    });
    expect(request.filter).toBeInstanceOf(Api.InputMessagesFilterPhotos);
  });

  it("rejects an empty unfiltered search before calling Telegram", async () => {
    const result = await telegramSearchGlobalExecutor({}, context);

    expect(result).toEqual({
      success: false,
      error: "Provide a query, or select a messageType other than 'all'.",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects inverted date bounds before calling Telegram", async () => {
    const result = await telegramSearchGlobalExecutor(
      {
        query: "needle",
        after: "2026-01-02T00:00:00Z",
        before: "2026-01-01T00:00:00Z",
      },
      context
    );

    expect(result).toEqual({ success: false, error: "after must be earlier than before" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sorts only the returned page and keeps Telegram pagination offsets", async () => {
    invoke
      .mockResolvedValueOnce(
        response([message(10, 1000, 1), message(9, 900, 50)], { count: 3, nextRate: 777 })
      )
      .mockResolvedValueOnce(response([]));

    const first = await telegramSearchGlobalExecutor(
      { query: "needle", limit: 2, sort: "views_desc" },
      context
    );
    expect(first.success).toBe(true);
    const firstData = first.data as any;
    expect(firstData.messages.map((item: any) => item.id)).toEqual([9, 10]);
    expect(firstData.sortScope).toBe("page");
    expect(firstData.pagination).toMatchObject({
      total: 3,
      hasMore: true,
    });

    const second = await telegramSearchGlobalExecutor(
      {
        query: "needle",
        limit: 2,
        sort: "views_desc",
        cursor: firstData.pagination.nextCursor,
      },
      context
    );
    expect(second.success).toBe(true);
    const secondRequest = invoke.mock.calls[1][0] as Api.messages.SearchGlobal;
    expect(secondRequest.offsetRate).toBe(777);
    expect(secondRequest.offsetId).toBe(9);
    expect(secondRequest.offsetPeer).toBeInstanceOf(Api.InputPeerChannel);
  });

  it("rejects a cursor when search parameters change", async () => {
    invoke.mockResolvedValueOnce(response([message(10, 1000)], { count: 2, nextRate: 777 }));
    const first = await telegramSearchGlobalExecutor({ query: "needle", limit: 1 }, context);
    const cursor = (first.data as any).pagination.nextCursor as string;

    const changed = await telegramSearchGlobalExecutor(
      { query: "different", limit: 1, cursor },
      context
    );

    expect(changed.success).toBe(false);
    expect(changed.error).toContain("cursor does not match this search");
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("returns a readable FLOOD_WAIT without retrying", async () => {
    invoke.mockRejectedValue(new Error("FLOOD_WAIT_37"));

    const result = await telegramSearchGlobalExecutor({ query: "needle" }, context);

    expect(result).toEqual({
      success: false,
      error: "Telegram rate limit reached. Retry after 37 seconds.",
    });
    expect(invoke).toHaveBeenCalledOnce();
  });
});
