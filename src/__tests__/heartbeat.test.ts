import { describe, expect, it, vi } from "vitest";
import { HeartbeatRunner } from "../heartbeat.js";
import type { Config } from "../config/schema.js";

vi.mock("../memory/index.js", () => ({
  getDatabase: () => ({ getDb: () => ({}) }),
}));

function config(): Config {
  return {
    heartbeat: { enabled: true, interval_ms: 60_000, prompt: "check", self_configurable: false },
    telegram: { admin_ids: [123] },
  } as Config;
}

describe("HeartbeatRunner", () => {
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
