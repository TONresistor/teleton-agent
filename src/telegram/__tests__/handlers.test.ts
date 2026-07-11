import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock offset-store — controlable per-test
const mockReadOffset = vi.fn<(chatId?: string) => number | null>().mockReturnValue(null);
const mockWriteOffset = vi.fn();
vi.mock("../offset-store.js", () => ({
  readOffset: (...args: unknown[]) => mockReadOffset(args[0] as string | undefined),
  writeOffset: (...args: unknown[]) => mockWriteOffset(...args),
}));

// Mock feed stores — must be classes (used with `new`)
vi.mock("../../memory/feed/index.js", () => ({
  MessageStore: class {
    storeMessage = vi.fn().mockResolvedValue(undefined);
  },
  ChatStore: class {
    upsertChat = vi.fn();
  },
  UserStore: class {
    upsertUser = vi.fn();
    incrementMessageCount = vi.fn();
  },
}));

// Mock PendingHistory — must be a class
vi.mock("../../memory/pending-history.js", () => ({
  PendingHistory: class {
    addMessage = vi.fn();
    getAndClearPending = vi.fn().mockReturnValue(null);
    clearPending = vi.fn();
  },
}));

// Mock transcription
vi.mock("../../agent/tools/telegram/media/transcribe-audio.js", () => ({
  telegramTranscribeAudioExecutor: vi.fn().mockResolvedValue({ success: false }),
}));

import { MessageHandler, type MessageContext } from "../handlers.js";
import type { TelegramMessage } from "../bridge.js";
import type { TelegramConfig } from "../../config/schema.js";
import { TELEGRAM_SEND_TOOLS } from "../../constants/tools.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return {
    api_id: 1,
    api_hash: "test",
    session_name: "test",
    admin_ids: [111],
    dm_policy: "open",
    group_policy: "open",
    allow_from: [],
    group_allow_from: [],
    require_mention: false,
    max_message_length: 4096,
    typing_simulation: false,
    rate_limit_messages_per_second: 30,
    rate_limit_groups_per_minute: 20,
    ...overrides,
  } as TelegramConfig;
}

function makeMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    id: 100,
    chatId: "chat1",
    senderId: 222,
    text: "hello",
    isGroup: false,
    isChannel: false,
    isBot: false,
    mentionsMe: false,
    timestamp: new Date(),
    hasMedia: false,
    ...overrides,
  };
}

function makeBridge() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ id: 999, date: Math.floor(Date.now() / 1000) }),
    setTyping: vi.fn().mockResolvedValue(undefined),
    fetchReplyContext: vi.fn().mockResolvedValue(null),
    getMode: vi.fn().mockReturnValue("user"),
    requiresOffsetDedup: vi.fn().mockReturnValue(true),
  } as any;
}

function makeAgent() {
  return {
    processMessage: vi.fn().mockResolvedValue({ content: "response text", toolCalls: [] }),
  } as any;
}

function makeDb() {
  return {} as any;
}

function makeEmbedder() {
  return {} as any;
}

function createHandler(
  configOverrides: Partial<TelegramConfig> = {},
  deps?: {
    bridge?: any;
    agent?: any;
  }
) {
  const bridge = deps?.bridge ?? makeBridge();
  const agent = deps?.agent ?? makeAgent();
  const config = makeConfig(configOverrides);
  const handler = new MessageHandler(bridge, config, agent, makeDb(), makeEmbedder(), false);
  return { handler, bridge, agent, config };
}

// ── T6: analyzeMessage / shouldRespond policy routing ────────────────────────

describe("MessageHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadOffset.mockReturnValue(null);
  });

  describe("analyzeMessage()", () => {
    // ── DM policies ──

    it('dm_policy="disabled" → shouldRespond=false', () => {
      const { handler } = createHandler({ dm_policy: "disabled" });
      const ctx = handler.analyzeMessage(makeMessage());
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("DMs disabled");
    });

    it('dm_policy="admin-only" + non-admin → shouldRespond=false', () => {
      const { handler } = createHandler({
        dm_policy: "admin-only",
        admin_ids: [111],
      });
      const ctx = handler.analyzeMessage(makeMessage({ senderId: 999 }));
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.isAdmin).toBe(false);
      expect(ctx.reason).toBe("DMs restricted to admins");
    });

    it('dm_policy="admin-only" + admin → shouldRespond=true', () => {
      const { handler } = createHandler({
        dm_policy: "admin-only",
        admin_ids: [111],
      });
      const ctx = handler.analyzeMessage(makeMessage({ senderId: 111 }));
      expect(ctx.shouldRespond).toBe(true);
      expect(ctx.isAdmin).toBe(true);
    });

    it('dm_policy="allowlist" + sender in allow_from → shouldRespond=true', () => {
      const { handler } = createHandler({
        dm_policy: "allowlist",
        allow_from: [222],
        admin_ids: [],
      });
      const ctx = handler.analyzeMessage(makeMessage({ senderId: 222 }));
      expect(ctx.shouldRespond).toBe(true);
    });

    it('dm_policy="allowlist" + admin (not in allow_from) → shouldRespond=true', () => {
      const { handler } = createHandler({
        dm_policy: "allowlist",
        allow_from: [],
        admin_ids: [333],
      });
      const ctx = handler.analyzeMessage(makeMessage({ senderId: 333 }));
      expect(ctx.shouldRespond).toBe(true);
      expect(ctx.isAdmin).toBe(true);
    });

    it('dm_policy="allowlist" + sender NOT in allow_from and not admin → shouldRespond=false', () => {
      const { handler } = createHandler({
        dm_policy: "allowlist",
        allow_from: [555],
        admin_ids: [],
      });
      const ctx = handler.analyzeMessage(makeMessage({ senderId: 999 }));
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("Not in allowlist");
    });

    it('dm_policy="open" → shouldRespond=true', () => {
      const { handler } = createHandler({ dm_policy: "open" });
      const ctx = handler.analyzeMessage(makeMessage());
      expect(ctx.shouldRespond).toBe(true);
    });

    // ── Group policies ──

    it('group_policy="disabled" → shouldRespond=false', () => {
      const { handler } = createHandler({ group_policy: "disabled" });
      const ctx = handler.analyzeMessage(makeMessage({ isGroup: true }));
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("Groups disabled");
    });

    it('group_policy="admin-only" + non-admin in group → shouldRespond=false', () => {
      const { handler } = createHandler({
        group_policy: "admin-only",
        admin_ids: [111],
      });
      const ctx = handler.analyzeMessage(makeMessage({ isGroup: true, senderId: 999 }));
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("Groups restricted to admins");
    });

    it('group_policy="admin-only" + admin in group → shouldRespond=true', () => {
      const { handler } = createHandler({
        group_policy: "admin-only",
        admin_ids: [111],
      });
      const ctx = handler.analyzeMessage(makeMessage({ isGroup: true, senderId: 111 }));
      expect(ctx.shouldRespond).toBe(true);
    });

    it('group_policy="allowlist" + chatId in group_allow_from → shouldRespond=true', () => {
      const { handler } = createHandler({
        group_policy: "allowlist",
        group_allow_from: [-100123],
        require_mention: false,
      });
      const ctx = handler.analyzeMessage(makeMessage({ isGroup: true, chatId: "-100123" }));
      expect(ctx.shouldRespond).toBe(true);
    });

    it('group_policy="allowlist" + chatId NOT in group_allow_from → shouldRespond=false', () => {
      const { handler } = createHandler({
        group_policy: "allowlist",
        group_allow_from: [-100999],
      });
      const ctx = handler.analyzeMessage(makeMessage({ isGroup: true, chatId: "-100123" }));
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("Group not in allowlist");
    });

    it("require_mention=true + not mentioned in group → shouldRespond=false", () => {
      const { handler } = createHandler({
        group_policy: "open",
        require_mention: true,
      });
      const ctx = handler.analyzeMessage(makeMessage({ isGroup: true, mentionsMe: false }));
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("Not mentioned");
    });

    it("require_mention=true + mentioned in group → shouldRespond=true", () => {
      const { handler } = createHandler({
        group_policy: "open",
        require_mention: true,
      });
      const ctx = handler.analyzeMessage(makeMessage({ isGroup: true, mentionsMe: true }));
      expect(ctx.shouldRespond).toBe(true);
    });

    // ── Cross-cutting ──

    it("isBot=true → shouldRespond=false", () => {
      const { handler } = createHandler({ dm_policy: "open" });
      const ctx = handler.analyzeMessage(makeMessage({ isBot: true }));
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("Sender is a bot");
    });

    it("own user messages → shouldRespond=false", () => {
      const { handler } = createHandler({ dm_policy: "open" });
      handler.setOwnUserId("222");

      const ctx = handler.analyzeMessage(makeMessage({ senderId: 222 }));

      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("Sender is self");
    });

    it("message.id <= chatOffset → shouldRespond=false (already processed)", () => {
      mockReadOffset.mockReturnValue(100);
      const { handler } = createHandler({ dm_policy: "open" });
      const ctx = handler.analyzeMessage(makeMessage({ id: 99 }));
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("Already processed");
    });

    it("message.id == chatOffset → shouldRespond=false (already processed)", () => {
      mockReadOffset.mockReturnValue(100);
      const { handler } = createHandler({ dm_policy: "open" });
      const ctx = handler.analyzeMessage(makeMessage({ id: 100 }));
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("Already processed");
    });

    it("message.id > chatOffset → passes offset check", () => {
      mockReadOffset.mockReturnValue(50);
      const { handler } = createHandler({ dm_policy: "open" });
      const ctx = handler.analyzeMessage(makeMessage({ id: 51 }));
      expect(ctx.shouldRespond).toBe(true);
    });

    it("isAdmin is correctly set based on admin_ids", () => {
      const { handler } = createHandler({ admin_ids: [222], dm_policy: "open" });
      const ctx = handler.analyzeMessage(makeMessage({ senderId: 222 }));
      expect(ctx.isAdmin).toBe(true);
    });

    it("channel messages → shouldRespond=false (unknown type)", () => {
      const { handler } = createHandler();
      const ctx = handler.analyzeMessage(makeMessage({ isChannel: true, isGroup: false }));
      expect(ctx.shouldRespond).toBe(false);
      expect(ctx.reason).toBe("Unknown type");
    });
  });

  // ── T7: ChatQueue serialization ──────────────────────────────────────────

  describe("ChatQueue (via handleMessage serialization)", () => {
    // We test ChatQueue behavior indirectly through handleMessage, and also
    // directly by accessing the internal chatQueue via the drain() method.

    it("two messages for same chatId execute sequentially", async () => {
      const order: number[] = [];
      let resolveFirst!: () => void;

      const agent = makeAgent();
      agent.processMessage
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = () => {
                order.push(1);
                resolve({ content: "first", toolCalls: [] });
              };
            })
        )
        .mockImplementationOnce(async () => {
          order.push(2);
          return { content: "second", toolCalls: [] };
        });

      const { handler } = createHandler({ dm_policy: "open" }, { agent });

      const p1 = handler.handleMessage(makeMessage({ id: 101, chatId: "chatA" }));
      const p2 = handler.handleMessage(makeMessage({ id: 102, chatId: "chatA" }));

      // Let handleMessage pipeline settle (store → analyze → enqueue → processMessage)
      await new Promise((r) => setTimeout(r, 10));

      // First processMessage is blocked, second hasn't started yet
      expect(order).toEqual([]);

      resolveFirst();
      await p1;
      await p2;

      expect(order).toEqual([1, 2]);
    });

    it("two messages for different chatIds execute concurrently", async () => {
      const running: string[] = [];
      let resolveA!: () => void;
      let resolveB!: () => void;

      const agent = makeAgent();
      agent.processMessage
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              running.push("A-started");
              resolveA = () => resolve({ content: "a", toolCalls: [] });
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              running.push("B-started");
              resolveB = () => resolve({ content: "b", toolCalls: [] });
            })
        );

      const { handler } = createHandler({ dm_policy: "open" }, { agent });

      const pA = handler.handleMessage(makeMessage({ id: 101, chatId: "chatA" }));
      const pB = handler.handleMessage(makeMessage({ id: 102, chatId: "chatB" }));

      // Allow microtasks to settle so both processMessage calls start
      await new Promise((r) => setTimeout(r, 10));

      // Both should have started concurrently
      expect(running).toContain("A-started");
      expect(running).toContain("B-started");

      resolveA();
      resolveB();
      await pA;
      await pB;
    });

    it("a task that throws → next task still runs", async () => {
      const agent = makeAgent();
      agent.processMessage
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ content: "ok", toolCalls: [] });

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });

      await handler.handleMessage(makeMessage({ id: 101, chatId: "chatA" }));
      await handler.handleMessage(makeMessage({ id: 102, chatId: "chatA" }));

      // Second message should still be processed — bridge.sendMessage called for it
      expect(bridge.sendMessage).toHaveBeenCalled();
    });

    it("drain() resolves after all tasks complete", async () => {
      let resolveTask!: () => void;
      const agent = makeAgent();
      agent.processMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveTask = () => resolve({ content: "done", toolCalls: [] });
          })
      );

      const { handler } = createHandler({ dm_policy: "open" }, { agent });
      // Fire handleMessage without awaiting — it will block on processMessage
      const handlePromise = handler.handleMessage(makeMessage({ id: 101 }));

      // Let the handleMessage pipeline reach processMessage and enqueue
      await new Promise((r) => setTimeout(r, 20));

      // drain() should wait for the in-flight task
      let drained = false;
      const drainPromise = handler.drain().then(() => {
        drained = true;
      });

      // Give drain a chance to resolve (it shouldn't yet)
      await new Promise((r) => setTimeout(r, 10));
      expect(drained).toBe(false);

      resolveTask();
      await drainPromise;
      await handlePromise;
      expect(drained).toBe(true);
    });
  });

  // ── T8: Dedup recentMessageIds ───────────────────────────────────────────

  describe("dedup (recentMessageIds)", () => {
    it("same chatId+messageId arriving twice → second is ignored", async () => {
      const agent = makeAgent();
      const { handler } = createHandler({ dm_policy: "open" }, { agent });

      await handler.handleMessage(makeMessage({ id: 101, chatId: "chat1" }));
      await handler.handleMessage(makeMessage({ id: 101, chatId: "chat1" }));

      // processMessage should only be called once
      expect(agent.processMessage).toHaveBeenCalledTimes(1);
    });

    it("different messageId → both processed", async () => {
      const agent = makeAgent();
      const { handler } = createHandler({ dm_policy: "open" }, { agent });

      await handler.handleMessage(makeMessage({ id: 101, chatId: "chat1" }));
      await handler.handleMessage(makeMessage({ id: 102, chatId: "chat1" }));

      expect(agent.processMessage).toHaveBeenCalledTimes(2);
    });

    it("same messageId but different chatId → both processed", async () => {
      const agent = makeAgent();
      const { handler } = createHandler({ dm_policy: "open" }, { agent });

      await handler.handleMessage(makeMessage({ id: 101, chatId: "chatA" }));
      await handler.handleMessage(makeMessage({ id: 101, chatId: "chatB" }));

      expect(agent.processMessage).toHaveBeenCalledTimes(2);
    });
  });

  // ── T9: telegramSendCalled detection ─────────────────────────────────────

  describe("telegramSendCalled detection", () => {
    it("does not duplicate text successfully delivered to the current chat", async () => {
      const agent = makeAgent();
      agent.processMessage.mockResolvedValue({
        content: "sent via tool",
        toolCalls: [
          {
            name: "telegram_send_message",
            input: { chatId: "chat1", text: "sent via tool" },
            result: { success: true },
          },
        ],
      });

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 101 }));

      expect(bridge.sendMessage).not.toHaveBeenCalled();
    });

    it("sends the final response when the Telegram tool targeted another chat", async () => {
      const agent = makeAgent();
      agent.processMessage.mockResolvedValue({
        content: "Message sent to Alice",
        toolCalls: [
          {
            name: "telegram_send_message",
            input: { chatId: "alice", text: "hello" },
            result: { success: true },
          },
        ],
      });

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 102, chatId: "chat1" }));

      expect(bridge.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: "chat1", text: "Message sent to Alice" })
      );
    });

    it("sends the final response when the Telegram tool failed", async () => {
      const agent = makeAgent();
      agent.processMessage.mockResolvedValue({
        content: "I could not send the message",
        toolCalls: [
          {
            name: "telegram_send_message",
            input: { chatId: "chat1", text: "hello" },
            result: { success: false, error: "forbidden" },
          },
        ],
      });

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 103, chatId: "chat1" }));

      expect(bridge.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: "chat1", text: "I could not send the message" })
      );
    });

    it("sends a distinct confirmation after a successful current-chat send", async () => {
      const agent = makeAgent();
      agent.processMessage.mockResolvedValue({
        content: "Done",
        toolCalls: [
          {
            name: "telegram_send_message",
            input: { chatId: "chat1", text: "hello" },
            result: { success: true },
          },
        ],
      });

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 104, chatId: "chat1" }));

      expect(bridge.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: "chat1", text: "Done" })
      );
    });

    it("when processMessage has no send tool → bridge.sendMessage IS called", async () => {
      const agent = makeAgent();
      agent.processMessage.mockResolvedValue({
        content: "plain response",
        toolCalls: [{ name: "memory_search", args: {} }],
      });

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 101 }));

      expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
      expect(bridge.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: "chat1",
          text: "plain response",
        })
      );
    });

    it("when processMessage has no toolCalls at all → bridge.sendMessage IS called", async () => {
      const agent = makeAgent();
      agent.processMessage.mockResolvedValue({
        content: "response",
        toolCalls: [],
      });

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 101 }));

      expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("empty response content → bridge.sendMessage NOT called", async () => {
      const agent = makeAgent();
      agent.processMessage.mockResolvedValue({
        content: "  ",
        toolCalls: [],
      });

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 101 }));

      expect(bridge.sendMessage).not.toHaveBeenCalled();
    });

    for (const toolName of TELEGRAM_SEND_TOOLS) {
      if (toolName === "telegram_forward_message") continue;
      it(`recognizes ${toolName} as a send tool`, async () => {
        const agent = makeAgent();
        agent.processMessage.mockResolvedValue({
          content: "tool response",
          toolCalls: [
            {
              name: toolName,
              input: { chatId: "chat1", text: "tool response" },
              result: { success: true },
            },
          ],
        });

        const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
        await handler.handleMessage(makeMessage({ id: (200 + Math.random() * 1000) | 0 }));

        expect(bridge.sendMessage).not.toHaveBeenCalled();
      });
    }
  });

  // ── Silent reply suppression (scenarios 30-31) ──────────────────────────

  describe("__SILENT__ suppression", () => {
    // Scenario 30
    it('processMessage returns "__SILENT__" → bridge.sendMessage NOT called', async () => {
      const agent = makeAgent();
      agent.processMessage.mockResolvedValue({
        content: "__SILENT__",
        toolCalls: [],
      });

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 101 }));

      expect(bridge.sendMessage).not.toHaveBeenCalled();
    });

    // Scenario 31
    it("processMessage returns real text → bridge.sendMessage IS called", async () => {
      const agent = makeAgent();
      agent.processMessage.mockResolvedValue({
        content: "Here is a useful response",
        toolCalls: [],
      });

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 101 }));

      expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
      expect(bridge.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: "Here is a useful response" })
      );
    });
  });

  describe("provider failures", () => {
    it("replies with a safe quota message and marks the update processed", async () => {
      const agent = makeAgent();
      agent.processMessage.mockRejectedValue(
        new Error("API error: Codex error: The usage limit has been reached")
      );

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 201, chatId: "chat1" }));

      expect(bridge.sendMessage).toHaveBeenCalledWith({
        chatId: "chat1",
        text: "⚠️ The AI provider usage limit has been reached. Please try again later or switch providers.",
        replyToId: 201,
      });
      expect(mockWriteOffset).toHaveBeenCalledWith(201, "chat1");
    });

    it("does not expose unexpected provider details", async () => {
      const agent = makeAgent();
      agent.processMessage.mockRejectedValue(
        new Error("API error: upstream failed with secret diagnostic details")
      );

      const { handler, bridge } = createHandler({ dm_policy: "open" }, { agent });
      await handler.handleMessage(makeMessage({ id: 202, chatId: "chat1" }));

      expect(bridge.sendMessage).toHaveBeenCalledWith({
        chatId: "chat1",
        text: "⚠️ The AI provider is unavailable. Please try again later.",
        replyToId: 202,
      });
    });

    it("keeps the update retryable when the error notification cannot be delivered", async () => {
      const agent = makeAgent();
      agent.processMessage.mockRejectedValue(
        new Error("API error: Codex error: The usage limit has been reached")
      );
      const bridge = makeBridge();
      bridge.sendMessage.mockRejectedValue(new Error("Telegram unavailable"));

      const { handler } = createHandler({ dm_policy: "open" }, { agent, bridge });
      await handler.handleMessage(makeMessage({ id: 203, chatId: "chat1" }));

      expect(mockWriteOffset).not.toHaveBeenCalled();
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe("handleMessage edge cases", () => {
    it("truncates response exceeding max_message_length", async () => {
      const agent = makeAgent();
      const longText = "x".repeat(5000);
      agent.processMessage.mockResolvedValue({
        content: longText,
        toolCalls: [],
      });

      const { handler, bridge } = createHandler(
        { dm_policy: "open", max_message_length: 100 },
        { agent }
      );
      await handler.handleMessage(makeMessage({ id: 101 }));

      const sentText = bridge.sendMessage.mock.calls[0][0].text as string;
      expect(sentText.length).toBe(100);
      expect(sentText.endsWith("...")).toBe(true);
    });

    it("writes offset after successful processing", async () => {
      const { handler } = createHandler({ dm_policy: "open" });
      await handler.handleMessage(makeMessage({ id: 101, chatId: "chat1" }));

      expect(mockWriteOffset).toHaveBeenCalledWith(101, "chat1");
    });

    it("skipping a message (shouldRespond=false) does NOT call processMessage", async () => {
      const agent = makeAgent();
      const { handler } = createHandler({ dm_policy: "disabled" }, { agent });
      await handler.handleMessage(makeMessage({ id: 101 }));

      expect(agent.processMessage).not.toHaveBeenCalled();
    });
  });
});
