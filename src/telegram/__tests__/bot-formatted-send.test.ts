import { describe, expect, it, vi } from "vitest";
import { GrammyBotBridge } from "../bridges/bot.js";

describe("Bot formatted send", () => {
  it("sends decoded text with valid entities and returns all fragment IDs", async () => {
    const bridge = new GrammyBotBridge({ bot_token: "123:test" });
    let id = 0;
    const send = vi
      .spyOn(bridge.getBot().api, "sendMessage")
      .mockImplementation(async () => ({ message_id: ++id, date: 100 }) as never);
    const text = "😀 & <".repeat(1500);
    const result = await bridge.sendMessage({
      chatId: "1",
      text: "**" + text + "**",
      replyToId: 99,
      inlineKeyboard: [[{ text: "button", callback_data: "x" }]],
    });
    expect(result.messages).toHaveLength(3);
    expect(send.mock.calls.map((call) => call[1]).join("")).toBe(text);
    for (const call of send.mock.calls) {
      expect(call[2]?.parse_mode).toBeUndefined();
      expect(call[2]?.entities?.[0]).toEqual({ type: "bold", offset: 0, length: call[1].length });
      expect(call[1].length).toBeLessThanOrEqual(4096);
    }
    expect(send.mock.calls[0][2]?.reply_to_message_id).toBe(99);
    expect(send.mock.calls[1][2]?.reply_to_message_id).toBeUndefined();
    expect(send.mock.calls[0][2]?.reply_markup).toBeUndefined();
    expect(send.mock.calls.at(-1)![2]?.reply_markup).toBeDefined();
  });
});
