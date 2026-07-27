import { describe, expect, it } from "vitest";
import { deliveredTelegramMessageId, type CompletedToolCall } from "../telegram-send-state.js";

describe("deliveredTelegramMessageId", () => {
  it("extracts the ID from the matching successful Telegram send", () => {
    const calls: CompletedToolCall[] = [
      {
        name: "telegram_send_message",
        input: { chatId: "42", text: "hello" },
        result: { success: true, data: { messageId: 99 } },
      },
    ];

    expect(deliveredTelegramMessageId(calls, "42", "hello")).toBe("99");
  });

  it("does not reuse an ID from another chat or failed send", () => {
    const calls: CompletedToolCall[] = [
      {
        name: "telegram_send_message",
        input: { chatId: "other", text: "hello" },
        result: { success: true, data: { messageId: 99 } },
      },
      {
        name: "telegram_send_message",
        input: { chatId: "42", text: "hello" },
        result: { success: false, data: { messageId: 100 } },
      },
    ];

    expect(deliveredTelegramMessageId(calls, "42", "hello")).toBeNull();
  });
});
