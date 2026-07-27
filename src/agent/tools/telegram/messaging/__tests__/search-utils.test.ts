import { describe, expect, it } from "vitest";
import { Api } from "telegram";
import {
  createNextSearchCursor,
  createSearchRequestHash,
  decodeSearchCursor,
  extractSearchPage,
  getMessagesFilter,
  normalizeHashtag,
  normalizeSearchQuota,
  parseSearchDate,
  sortSearchHits,
} from "../search-utils.js";

function channel(id = 123n, username = "public_channel"): Api.Channel {
  return new Api.Channel({
    id,
    accessHash: id + 1n,
    title: "Public Channel",
    username,
    broadcast: true,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
  });
}

function user(id = 42n): Api.User {
  return new Api.User({
    id,
    accessHash: id + 1n,
    firstName: "Alice",
    lastName: "Example",
    username: "alice",
  });
}

function message(options: {
  id: number;
  date: number;
  views?: number;
  forwards?: number;
}): Api.Message {
  return new Api.Message({
    id: options.id,
    peerId: new Api.PeerChannel({ channelId: 123n }),
    fromId: new Api.PeerUser({ userId: 42n }),
    date: options.date,
    message: `message-${options.id}`,
    post: true,
    views: options.views,
    forwards: options.forwards,
    postAuthor: "Editor",
    media: new Api.MessageMediaPhoto({
      photo: new Api.PhotoEmpty({ id: BigInt(options.id) }),
    }),
    replies: new Api.MessageReplies({ replies: 4 }),
    reactions: new Api.MessageReactions({
      results: [
        new Api.ReactionCount({
          reaction: new Api.ReactionEmoji({ emoticon: "👍" }),
          count: 3,
        }),
      ],
    }),
  });
}

function slice(messages: Api.TypeMessage[], options: { count?: number; nextRate?: number } = {}) {
  return new Api.messages.MessagesSlice({
    count: options.count ?? messages.length,
    nextRate: options.nextRate,
    messages,
    topics: [],
    chats: [channel()],
    users: [user()],
  });
}

describe("Telegram search helpers", () => {
  it("maps supported message filters to GramJS constructors", () => {
    expect(getMessagesFilter("all")).toBeInstanceOf(Api.InputMessagesFilterEmpty);
    expect(getMessagesFilter("photo_video")).toBeInstanceOf(Api.InputMessagesFilterPhotoVideo);
    expect(getMessagesFilter("documents")).toBeInstanceOf(Api.InputMessagesFilterDocument);
    expect(getMessagesFilter("round_video")).toBeInstanceOf(Api.InputMessagesFilterRoundVideo);
    expect(getMessagesFilter("polls")).toBeInstanceOf(Api.InputMessagesFilterPoll);
  });

  it("parses ISO and Unix dates and rejects invalid ranges", () => {
    expect(parseSearchDate("2026-01-01T00:00:00Z", "after")).toEqual({
      ok: true,
      value: 1_767_225_600,
    });
    expect(parseSearchDate("1767225600", "after")).toEqual({
      ok: true,
      value: 1_767_225_600,
    });
    expect(parseSearchDate("not-a-date", "after")).toEqual({
      ok: false,
      error: "after must be an ISO 8601 date or Unix timestamp in seconds",
    });
  });

  it("normalizes leading hashtag markers and surrounding whitespace", () => {
    expect(normalizeHashtag("  #TON  ")).toBe("TON");
    expect(normalizeHashtag("##TON")).toBe("TON");
    expect(normalizeHashtag("#   ")).toBe("");
  });

  it("enriches messages with marked IDs, sender metadata, metrics, and links", () => {
    const page = extractSearchPage(slice([message({ id: 10, date: 1000, views: 9 })]));

    expect(page.hits).toEqual([
      expect.objectContaining({
        id: 10,
        chatId: "-100123",
        chatType: "channel",
        chatTitle: "Public Channel",
        chatUsername: "public_channel",
        senderId: "42",
        senderName: "Alice Example",
        senderUsername: "alice",
        postAuthor: "Editor",
        mediaType: "photo",
        views: 9,
        reactions: 3,
        replies: 4,
        link: "https://t.me/public_channel/10",
      }),
    ]);
  });

  it("filters service messages from display but retains them in raw pagination", () => {
    const service = new Api.MessageService({
      id: 11,
      peerId: new Api.PeerChannel({ channelId: 123n }),
      date: 1001,
      action: new Api.MessageActionEmpty(),
    });
    const page = extractSearchPage(slice([message({ id: 10, date: 1000 }), service], { count: 2 }));

    expect(page.hits).toHaveLength(1);
    expect(page.rawMessages).toHaveLength(2);
  });

  it.each([
    ["date_desc", [3, 2, 1]],
    ["date_asc", [1, 2, 3]],
    ["views_desc", [2, 3, 1]],
    ["forwards_desc", [3, 2, 1]],
  ] as const)("sorts a page by %s with stable ties", (sort, expectedIds) => {
    const page = extractSearchPage(
      slice([
        message({ id: 1, date: 100, views: 1, forwards: 1 }),
        message({ id: 2, date: 200, views: 5, forwards: 2 }),
        message({ id: 3, date: 300, views: 5, forwards: 3 }),
      ])
    );

    expect(sortSearchHits(page.hits, sort).map((hit) => hit.id)).toEqual(expectedIds);
  });

  it("encodes a self-contained cursor and reconstructs the input peer", () => {
    const page = extractSearchPage(
      slice([message({ id: 10, date: 1000 })], { count: 2, nextRate: 777 })
    );
    const requestHash = createSearchRequestHash({ query: "needle" });
    const next = createNextSearchCursor({
      kind: "global",
      requestHash,
      page,
      limit: 1,
      previousSeen: 0,
    });

    expect(next.hasMore).toBe(true);
    expect(next.nextCursor).toBeTypeOf("string");

    const decoded = decodeSearchCursor(next.nextCursor ?? undefined, "global", requestHash);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.offset).toMatchObject({
      offsetRate: 777,
      offsetId: 10,
      seen: 1,
    });
    expect(decoded.offset.offsetPeer).toBeInstanceOf(Api.InputPeerChannel);
    expect((decoded.offset.offsetPeer as Api.InputPeerChannel).channelId.toString()).toBe("123");
  });

  it("rejects a cursor reused with another query or search kind", () => {
    const page = extractSearchPage(slice([message({ id: 10, date: 1000 })], { nextRate: 777 }));
    const requestHash = createSearchRequestHash({ query: "needle" });
    const next = createNextSearchCursor({
      kind: "global",
      requestHash,
      page,
      limit: 1,
      previousSeen: 0,
    });

    expect(
      decodeSearchCursor(next.nextCursor ?? undefined, "global", "0".repeat(64))
    ).toMatchObject({ ok: false });
    expect(decodeSearchCursor(next.nextCursor ?? undefined, "posts", requestHash)).toMatchObject({
      ok: false,
    });
  });

  it("normalizes the post-search quota without losing long values", () => {
    const normalized = normalizeSearchQuota(
      new Api.SearchPostsFlood({
        queryIsFree: false,
        totalDaily: 10,
        remains: 0,
        waitTill: 1_767_225_600,
        starsAmount: 25n,
      })
    );

    expect(normalized).toEqual({
      queryIsFree: false,
      totalDaily: 10,
      remaining: 0,
      waitUntil: 1_767_225_600,
      waitUntilIso: "2026-01-01T00:00:00.000Z",
      starsRequired: "25",
    });
  });
});
