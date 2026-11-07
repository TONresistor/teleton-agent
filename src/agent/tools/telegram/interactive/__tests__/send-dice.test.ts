import { describe, expect, it, vi } from "vitest";
import { Value } from "@sinclair/typebox/value";
import type { ToolContext } from "../../../types.js";
import { telegramSendDiceExecutor, telegramSendDiceTool } from "../send-dice.js";

describe("telegram_send_dice", () => {
  it("returns the numeric outcome contained in the sent message", async () => {
    const sendDice = vi.fn().mockResolvedValue({
      id: 55,
      date: 1_750_000_000,
      chatId: "123",
      value: 6,
    });
    const context = {
      bridge: { sendDice },
      chatId: "123",
      senderId: 1,
      isGroup: false,
      db: {},
    } as unknown as ToolContext;

    const result = await telegramSendDiceExecutor(
      {
        chat_id: "123",
        emoticon: "🎲",
      },
      context
    );

    expect(sendDice).toHaveBeenCalledWith("123", "🎲");
    expect(result).toEqual({
      success: true,
      data: {
        chat_id: "123",
        emoticon: "🎲",
        message_id: 55,
        value: 6,
      },
    });
  });

  it("forwards the reply target and keeps the default dice emoticon", async () => {
    const sendDice = vi.fn().mockResolvedValue({ id: 56, value: 3 });
    const context = { bridge: { sendDice } } as unknown as ToolContext;

    const result = await telegramSendDiceExecutor({ chat_id: "123", replyToId: 42 }, context);

    expect(sendDice).toHaveBeenCalledWith("123", "🎲", 42);
    expect(result).toMatchObject({ success: true, data: { message_id: 56, value: 3 } });
  });

  it("exposes an optional positive integer reply target in the tool schema", () => {
    const schema = telegramSendDiceTool.parameters;
    expect(Value.Check(schema, { chat_id: "123" })).toBe(true);
    expect(Value.Check(schema, { chat_id: "123", replyToId: 42 })).toBe(true);
    for (const replyToId of [0, -1, 1.5, Number.NaN, "42"]) {
      expect(Value.Check(schema, { chat_id: "123", replyToId })).toBe(false);
    }
  });
});
