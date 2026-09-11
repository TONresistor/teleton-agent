import { describe, expect, it, vi } from "vitest";
import { HeartbeatRunner } from "../heartbeat.js";
import type { Config } from "../config/schema.js";

vi.mock("../memory/index.js", () => ({
  getDatabase: () => ({ getDb: () => ({}) }),
}));

function config(): Config {
  return {
    heartbeat: {
      enabled: true,
      interval_ms: 60_000,
      prompt: "check",
      self_configurable: false,
      min_interval_between_replies_ms: 0,
      reply_delay_ms: 0,
    },
    telegram: { admin_ids: [123] },
  } as Config;
}

describe("HeartbeatRunner", () => {
  it("runs a heartbeat immediately when started", async () => {
    const agent = { processMessage: vi.fn().mockResolvedValue({ content: "NO_ACTION" }) };
    const bridge = { sendMessage: vi.fn() };
    const runner = new HeartbeatRunner(agent as never, bridge as never, config());

    runner.start(123, 60_000);
    await vi.waitFor(() => expect(agent.processMessage).toHaveBeenCalledOnce());
    runner.stop();
  });

  it("uses the startup prompt once before recurring heartbeats", async () => {
    const agent = { processMessage: vi.fn().mockResolvedValue({ content: "NO_ACTION" }) };
    const bridge = { sendMessage: vi.fn() };
    const cfg = config();
    cfg.heartbeat.startup_prompt = "startup inbox recovery";
    const runner = new HeartbeatRunner(agent as never, bridge as never, cfg);

    await runner.runOnce(123);
    await runner.runOnce(123);

    expect(agent.processMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ userMessage: "startup inbox recovery" })
    );
    expect(agent.processMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ userMessage: "check" })
    );
  });

  it("skips the LLM when user-mode startup recovery finds no unread dialogs", async () => {
    const agent = { processMessage: vi.fn().mockResolvedValue({ content: "NO_ACTION" }) };
    const bridge = {
      sendMessage: vi.fn(),
      getUnreadDirectDialogs: vi.fn().mockResolvedValue([]),
    };
    const cfg = config();
    cfg.heartbeat.startup_prompt = "startup inbox recovery";
    const runner = new HeartbeatRunner(agent as never, bridge as never, cfg);

    await runner.runOnce(123);

    expect(bridge.getUnreadDirectDialogs).toHaveBeenCalledOnce();
    expect(agent.processMessage).not.toHaveBeenCalled();
  });

  it("feeds recent unread message context to the agent during startup recovery", async () => {
    const agent = { processMessage: vi.fn().mockResolvedValue({ content: "NO_ACTION" }) };
    const bridge = {
      sendMessage: vi.fn(),
      getUnreadDirectDialogs: vi.fn().mockResolvedValue([{ chatId: "456", unreadCount: 2 }]),
      getMessages: vi.fn().mockResolvedValue([
        {
          id: 1,
          chatId: "456",
          senderId: 789,
          senderFirstName: "Alice",
          text: "Напомни про встречу завтра в 10:00",
          timestamp: new Date("2026-08-16T08:00:00Z"),
        },
        {
          id: 2,
          chatId: "456",
          senderId: 789,
          senderFirstName: "Alice",
          text: "Спасибо!",
          timestamp: new Date("2026-08-16T08:05:00Z"),
        },
      ]),
    };
    const cfg = config();
    cfg.heartbeat.startup_prompt = "startup inbox recovery";
    const runner = new HeartbeatRunner(agent as never, bridge as never, cfg);

    await runner.runOnce(123);

    expect(bridge.getMessages).toHaveBeenCalledWith("456", 2);
    expect(agent.processMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "456",
        userMessage: expect.stringContaining("Alice: Напомни про встречу завтра в 10:00"),
      })
    );
  });

  it("delivers a normal alert to the real admin chat", async () => {
    const agent = { processMessage: vi.fn().mockResolvedValue({ content: "Alert" }) };
    const bridge = { sendMessage: vi.fn().mockResolvedValue({ id: 1, date: 1 }) };
    const runner = new HeartbeatRunner(agent as never, bridge as never, config());

    await runner.runOnce(123);

    expect(agent.processMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "123", sessionKey: "heartbeat:123" })
    );
    expect(bridge.sendMessage).toHaveBeenCalledWith({ chatId: "123", text: "Alert" });
  });

  it("does not deliver NO_ACTION or duplicate a tool-delivered alert", async () => {
    const agent = { processMessage: vi.fn().mockResolvedValueOnce({ content: "NO_ACTION" }) };
    const bridge = { sendMessage: vi.fn().mockResolvedValue({ id: 1, date: 1 }) };
    const runner = new HeartbeatRunner(agent as never, bridge as never, config());
    await runner.runOnce(123);
    expect(bridge.sendMessage).not.toHaveBeenCalled();

    agent.processMessage.mockResolvedValueOnce({
      content: "Delivered",
      toolCalls: [
        {
          name: "telegram_send_message",
          input: { chatId: "123", text: "Alert" },
          result: { success: true, data: { messageId: 7 } },
        },
      ],
    });
    await runner.runOnce(123);
    expect(bridge.sendMessage).not.toHaveBeenCalled();
  });

  it("sends a proactive suggestion when the model wraps its JSON in a code block", async () => {
    const agent = {
      processMessage: vi
        .fn()
        .mockResolvedValueOnce({ content: "NO_ACTION" })
        .mockResolvedValueOnce({
          content:
            '```json\n{"score":8,"reason":"A concrete unfinished question","draft":"Did you get a chance to decide?"}\n```',
        }),
    };
    const bridge = { sendMessage: vi.fn().mockResolvedValue({ id: 1, date: 1 }) };
    const cfg = config();
    cfg.telegram.owner_id = 123;
    cfg.heartbeat.proactive_enabled = true;
    cfg.heartbeat.proactive_mode = "suggestion";
    cfg.heartbeat.proactive_min_score = 7;
    cfg.heartbeat.proactive_chat_ids = [456];
    const runner = new HeartbeatRunner(agent as never, bridge as never, cfg);

    await runner.runOnce(123);

    expect(bridge.sendMessage).toHaveBeenCalledWith({
      chatId: "123",
      text: expect.stringContaining("Did you get a chance to decide?"),
    });
  });

  it("suppresses a heartbeat reply when it is too soon after the previous one", async () => {
    const agent = { processMessage: vi.fn().mockResolvedValue({ content: "Alert" }) };
    const bridge = { sendMessage: vi.fn().mockResolvedValue({ id: 1, date: 1 }) };
    const cfg = config();
    cfg.heartbeat.min_interval_between_replies_ms = 60_000;
    const runner = new HeartbeatRunner(agent as never, bridge as never, cfg);

    await runner.runOnce(123);
    expect(bridge.sendMessage).toHaveBeenCalledTimes(1);

    await runner.runOnce(123);
    expect(bridge.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("waits the configured human-like delay before sending a heartbeat reply", async () => {
    const agent = { processMessage: vi.fn().mockResolvedValue({ content: "Alert" }) };
    const bridge = { sendMessage: vi.fn().mockResolvedValue({ id: 1, date: 1 }) };
    const cfg = config();
    cfg.heartbeat.reply_delay_ms = 50;
    const runner = new HeartbeatRunner(agent as never, bridge as never, cfg);

    const startedAt = Date.now();
    await runner.runOnce(123);
    expect(bridge.sendMessage).toHaveBeenCalledOnce();
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
  });

  it("drains an active tick during shutdown", async () => {
    let release!: () => void;
    const agent = {
      processMessage: vi.fn(
        () =>
          new Promise<{ content: string }>(
            (resolve) => (release = () => resolve({ content: "NO_ACTION" }))
          )
      ),
    };
    const bridge = { sendMessage: vi.fn() };
    const runner = new HeartbeatRunner(agent as never, bridge as never, config());

    const tick = runner.runOnce(123);
    await vi.waitFor(() => expect(agent.processMessage).toHaveBeenCalledOnce());
    const drain = runner.stopAndDrain();
    let drained = false;
    void drain.then(() => (drained = true));
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await Promise.all([tick, drain]);
    expect(drained).toBe(true);
  });
});
