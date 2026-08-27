import { describe, expect, it } from "vitest";
import {
  deliveredTelegramMessageId,
  deliveredTelegramRichMessage,
  type CompletedToolCall,
} from "../telegram-send-state.js";

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

describe("deliveredTelegramRichMessage", () => {
  it("returns the successful rich-message send to the current chat", () => {
    const richCall: CompletedToolCall = {
      name: "telegram_send_rich_message",
      input: { chatId: "42", text: "hello", media: [] },
      result: { success: true, data: { messageId: 99 } },
    };

    expect(deliveredTelegramRichMessage([richCall], "42")).toBe(richCall);
  });

  it("ignores failed sends and sends to another chat", () => {
    const calls: CompletedToolCall[] = [
      {
        name: "telegram_send_rich_message",
        input: { chatId: "other", text: "hello", media: [] },
        result: { success: true },
      },
      {
        name: "telegram_send_rich_message",
        input: { chatId: "42", text: "hello", media: [] },
        result: { success: false },
      },
    ];

    expect(deliveredTelegramRichMessage(calls, "42")).toBeNull();
  });
});
