import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../types.js";
import { telegramEditMessageExecutor } from "../edit-message.js";

describe("telegram_edit_message", () => {
  it("passes raw Markdown to the bridge so each transport formats it once", async () => {
    const editMessage = vi.fn().mockResolvedValue({
      id: 44,
      date: 1_750_000_000,
      chatId: "123",
    });
    const context = {
      bridge: { editMessage },
    } as unknown as ToolContext;

    const result = await telegramEditMessageExecutor(
      {
        chatId: "123",
        messageId: 44,
        text: "**updated**",
      },
      context
    );

    expect(result.success).toBe(true);
    expect(editMessage).toHaveBeenCalledWith({
      chatId: "123",
      messageId: 44,
      text: "**updated**",
    });
  });
});
