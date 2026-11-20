import Database from "better-sqlite3";
import type { ToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSchema } from "../../../../../memory/schema.js";
import { summarizeViaClaude } from "../../../../../memory/ai-summarization.js";
import { ToolRegistry } from "../../../registry.js";
import { registerAllTools } from "../../../register-all.js";
import type { ToolContext } from "../../../types.js";

vi.mock("../../../../../memory/ai-summarization.js", () => ({
  summarizeViaClaude: vi.fn(),
}));

const SEARCH = "session_search";
const READ = "session_read_context";

describe("local session history", () => {
  let db: Database.Database;
  let registry: ToolRegistry;
  let dm: ToolContext;
  let group: ToolContext;

  function addMessage(
    chatId: string,
    id: string,
    text: string | null,
    timestamp = 100,
    senderId: string | null = "42",
    isFromAgent = false
  ) {
    db.prepare(
      `INSERT INTO tg_messages (chat_id, id, text, timestamp, sender_id, is_from_agent)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(chatId, id, text, timestamp, senderId, Number(isFromAgent));
  }

  function execute(name: string, args: ToolCall["arguments"], context = dm) {
    return registry.execute({ type: "toolCall", id: name, name, arguments: args }, context);
  }

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    db.exec(`
      INSERT INTO tg_chats (id, type) VALUES ('-1', 'group'), ('-2', 'group'), ('42', 'dm');
      INSERT INTO tg_users (id, first_name, username) VALUES ('42', 'Alex', 'alex'), ('7', 'Agent', NULL);
    `);
    registry = new ToolRegistry();
    registerAllTools(registry);
    registry.setAdminIds([42]);
    dm = {
      bridge: {} as ToolContext["bridge"],
      db,
      senderId: 42,
      chatId: "42",
      isGroup: false,
      telegramChatType: "dm",
      config: {
        agent: { provider: "anthropic", api_key: "test-key" },
        telegram: { dm_policy: "allowlist" },
      } as ToolContext["config"],
    };
    group = { ...dm, chatId: "-1", isGroup: true, telegramChatType: "group" };
  });

  afterEach(() => db.close());

  it("preserves clustered results and reads the original correction without a model call", async () => {
    addMessage("-1", "1", "The price could be €12.", 100, "7", true);
    addMessage("-1", "2", "No, let's go with €9.", 101);
    addMessage("-2", "1", "The price here was €27.", 101);

    const search = await execute(SEARCH, { query: "price" });
    expect(search).toMatchObject({
      success: true,
      data: {
        query: "price",
        count: 2,
        results: expect.arrayContaining([
          expect.objectContaining({
            chatId: "-1",
            when: expect.any(String),
            summary: "The price could be €12.",
            summaryKind: "keyword-match preview",
            messageCount: 1,
            matches: [
              {
                chatId: "-1",
                messageId: "1",
                author: { id: "7", name: "Agent", username: null },
                isFromAgent: true,
                date: "1970-01-01T00:01:40.000Z",
                excerpt: "The price could be €12.",
                excerptTruncated: false,
              },
            ],
          }),
          expect.objectContaining({ chatId: "-2", messageCount: 1 }),
        ]),
      },
    });
    expect(await execute(SEARCH, { query: "price", limit: 1 })).toMatchObject({
      success: true,
      data: { count: 1 },
    });
    expect(await execute(SEARCH, { query: "unmatched" })).toMatchObject({
      success: true,
      data: { results: [] },
    });

    expect(await execute(READ, { chatId: "-1", messageId: "1" })).toMatchObject({
      success: true,
      data: {
        messages: [
          { messageId: "1", text: "The price could be €12.", isFromAgent: true },
          {
            messageId: "2",
            text: "No, let's go with €9.",
            author: { id: "42", name: "Alex", username: "alex" },
            isFromAgent: false,
          },
        ],
        nextBefore: null,
        nextAfter: null,
      },
    });
    expect(await execute(READ, { chatId: "-2", messageId: "1" })).toMatchObject({
      success: true,
      data: { messages: [{ chatId: "-2", messageId: "1", text: "The price here was €27." }] },
    });
    expect(summarizeViaClaude).not.toHaveBeenCalled();
  });

  it("continues on either side of equal timestamps in stable text-ID order", async () => {
    for (const id of ["2", "a", "1", "10", "20"]) addMessage("-1", id, id);
    const anchor = { chatId: "-1", messageId: "2" };
    const nextBefore = { chatId: "-1", messageId: "10" };
    const nextAfter = { chatId: "-1", messageId: "20" };
    expect(await execute(READ, { ...anchor, limit: 1 })).toMatchObject({
      success: true,
      data: {
        messages: [{ messageId: "10" }, { messageId: "2" }, { messageId: "20" }],
        nextBefore,
        nextAfter,
      },
    });
    expect(await execute(READ, { ...nextBefore, direction: "before", limit: 1 })).toMatchObject({
      success: true,
      data: { messages: [{ messageId: "1" }], nextBefore: null, nextAfter: null },
    });
    expect(await execute(READ, { ...nextAfter, direction: "after", limit: 1 })).toMatchObject({
      success: true,
      data: { messages: [{ messageId: "a" }], nextBefore: null, nextAfter: null },
    });
  });

  it("reports missing anchors, invalid inputs, unavailable content and truncation", async () => {
    addMessage("-1", "1", null, 100, null);
    const longText = "price " + "a".repeat(1200);
    addMessage("-1", "2", longText);
    expect(await execute(READ, { chatId: "-2", messageId: "1" })).toMatchObject({
      success: false,
      error: expect.stringContaining("Anchor message is unavailable"),
    });
    expect(await execute(READ, { chatId: "-1", messageId: "  " })).toMatchObject({
      success: false,
      error: expect.stringContaining("nonempty"),
    });
    expect(await execute(READ, { chatId: "-1", messageId: "1", limit: 1.5 })).toMatchObject({
      success: false,
      error: expect.stringContaining("whole number"),
    });
    const invalidArguments: ToolCall["arguments"][] = [{ limit: 6 }, { direction: "left" }];
    for (const args of invalidArguments) {
      expect(await execute(READ, { chatId: "-1", messageId: "1", ...args })).toMatchObject({
        success: false,
        error: expect.stringContaining("Validation failed"),
      });
    }
    expect(await execute(READ, { chatId: "-1", messageId: "1" })).toMatchObject({
      success: true,
      data: {
        messages: [
          { messageId: "1", author: null, text: null, textTruncated: false },
          { messageId: "2", text: longText.slice(0, 1000), textTruncated: true },
        ],
      },
    });
    expect(await execute(SEARCH, { query: "price" })).toMatchObject({
      success: true,
      data: {
        results: [{ matches: [{ excerpt: longText.slice(0, 400), excerptTruncated: true }] }],
      },
    });
  });

  it("continues long Unicode text without repeating neighbors or losing characters", async () => {
    const text = "🥚".repeat(2100) + " final correction";
    addMessage("-1", "long", text);
    addMessage("-1", "neighbor", "other message", 101);
    for (const offset of [0, 1000, 2000]) {
      expect(
        await execute(READ, {
          chatId: "-1",
          messageId: "long",
          direction: "message",
          textOffset: offset,
        })
      ).toMatchObject({
        success: true,
        data: {
          messages: [
            {
              messageId: "long",
              text: Array.from(text)
                .slice(offset, offset + 1000)
                .join(""),
              nextTextOffset: offset < 2000 ? offset + 1000 : null,
            },
          ],
          nextBefore: null,
          nextAfter: null,
        },
      });
    }
    expect(
      await execute(READ, {
        chatId: "-1",
        messageId: "long",
        direction: "message",
        textOffset: 0.5,
      })
    ).toMatchObject({ success: false });
    expect(
      await execute(READ, { chatId: "-1", messageId: "long", textOffset: 1000 })
    ).toMatchObject({ success: false });
  });

  it("enforces the admin floor and allows cross-chat history from groups", async () => {
    for (let id = 1; id <= 60; id++) {
      addMessage("-2", String(id), "price price price price price");
    }
    addMessage("-1", "1", "a discussion of the price with many other words");
    const query = { query: "price", chatId: "-2" };
    const anchor = { chatId: "-1", messageId: "1" };
    const outside = { ...anchor, chatId: "-2" };
    const nonAdmin = { ...dm, senderId: 7 };

    for (const [name, args] of [
      [SEARCH, query],
      [READ, anchor],
    ] as const) {
      expect(await execute(name, args, nonAdmin)).toMatchObject({
        success: false,
        error: expect.stringContaining("admin"),
      });
      expect(await execute(name, args, { ...dm, telegramChatType: undefined })).toMatchObject({
        success: false,
      });
      expect(await execute(name, args, { ...dm, telegramChatType: "channel" })).toMatchObject({
        success: false,
      });
      expect(await execute(name, args, { ...group, isGuest: true })).toMatchObject({
        success: false,
      });
    }
    expect(await execute(SEARCH, query, group)).toMatchObject({
      success: true,
      data: { results: [{ chatId: "-2", messageCount: 50 }] },
    });
    expect(await execute(READ, anchor, group)).toMatchObject({
      success: true,
      data: { messages: [{ chatId: "-1", messageId: "1" }] },
    });
    expect(await execute(READ, outside, group)).toMatchObject({
      success: true,
      data: {
        messages: expect.arrayContaining([
          expect.objectContaining({ chatId: "-2", messageId: "1" }),
        ]),
      },
    });

    const discover = (isAdmin: boolean, senderId: number) =>
      registry
        .getNamespaceCatalog(true, "-1", isAdmin, senderId)
        .find((entry) => entry.name === "telegram.memory")?.toolNames ?? [];
    expect(discover(true, 42)).toEqual(expect.arrayContaining([SEARCH, READ]));
    expect(discover(false, 7)).not.toContain(SEARCH);
    expect(discover(false, 7)).not.toContain(READ);
  });
});
