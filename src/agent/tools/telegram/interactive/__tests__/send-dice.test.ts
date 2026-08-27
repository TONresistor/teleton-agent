import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../types.js";
import { telegramSendDiceExecutor } from "../send-dice.js";

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
});
