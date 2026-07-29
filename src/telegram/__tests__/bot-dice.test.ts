import { beforeEach, describe, expect, it, vi } from "vitest";
import { GrammyBotBridge } from "../bridges/bot.js";

describe("GrammyBotBridge dice", () => {
  let bridge: GrammyBotBridge;

  beforeEach(() => {
    bridge = new GrammyBotBridge({ bot_token: "123:test" });
  });

  it("returns the dice value from the message returned by grammY", async () => {
    vi.spyOn(bridge.getBot().api, "sendDice").mockResolvedValue({
      message_id: 42,
      date: 1_750_000_000,
      chat: { id: 123, type: "private" },
      dice: { emoji: "🎲", value: 5 },
    } as never);

    await expect(bridge.sendDice("123", "🎲")).resolves.toEqual({
      id: 42,
      date: 1_750_000_000,
      chatId: "123",
      value: 5,
    });
  });

  it("reads the value from an incoming dice message", () => {
    const parsed = bridge.parseMessage({
      message_id: 43,
      date: 1_750_000_001,
      chat: { id: 123, type: "private" },
      from: { id: 7, is_bot: false, first_name: "Alice" },
      dice: { emoji: "🎲", value: 4 },
    } as never);

    expect(parsed.text).toBe("[Dice: 🎲 = 4]");
  });

  it("subscribes to incoming dice messages", () => {
    const on = vi.spyOn(bridge.getBot(), "on").mockReturnValue(bridge.getBot());

    bridge.onNewMessage(vi.fn());

    expect(on.mock.calls[0][0]).toContain("message:dice");
  });
});
