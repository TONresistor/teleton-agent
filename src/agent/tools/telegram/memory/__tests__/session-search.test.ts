import { describe, expect, it } from "vitest";
import { sessionSearchExecutor } from "../session-search.js";

describe("session_search", () => {
  it("searches every stored chat without merging conversations across chats", async () => {
    const rows = [
      { text: "alpha", chat_id: "chat-a", sender_id: 1, timestamp: 100, rank: -1 },
      { text: "beta", chat_id: "chat-b", sender_id: 2, timestamp: 101, rank: -2 },
    ];
    const db = { prepare: () => ({ all: () => rows }) };

    const result = await sessionSearchExecutor(
      { query: "launch" },
      {
        bridge: {} as never,
        db: db as never,
        chatId: "chat-current",
        senderId: 1,
        isGroup: true,
        config: { agent: { provider: "anthropic", api_key: "" } } as never,
      }
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      count: 2,
      results: expect.arrayContaining([
        expect.objectContaining({ chatId: "chat-a", messageCount: 1 }),
        expect.objectContaining({ chatId: "chat-b", messageCount: 1 }),
      ]),
    });
  });
});
