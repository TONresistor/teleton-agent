import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_react tool
 */
interface ReactParams {
  chatId: string;
  messageId: number;
  emoji: string;
}

/**
 * Tool definition for adding reactions to Telegram messages
 */
export const telegramReactTool: Tool = {
  name: "telegram_react",
  description:
    "Add an emoji reaction to a Telegram message. Use this to quickly acknowledge, approve, or express emotions without sending a full message. Common reactions: 👍 (like/approve), ❤️ (love), 🔥 (fire/hot), 😂 (funny), 😢 (sad), 🎉 (celebrate), 👎 (dislike), 🤔 (thinking). The message ID comes from the current conversation context or from telegram_get_history.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the message is located",
    }),
    messageId: Type.Number({
      description:
        "The message ID to react to. Use the ID from incoming messages or from get_history results.",
    }),
    emoji: Type.String({
      description:
        "Single emoji to react with. Examples: '👍', '❤️', '🔥', '😂', '🎉', '👀', '💯', '🙏'",
    }),
  }),
};

/**
 * Executor for telegram_react tool
 */
export const telegramReactExecutor: ToolExecutor<ReactParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, messageId, emoji } = params;

    // Send reaction via Telegram bridge
    await context.bridge.sendReaction(chatId, messageId, emoji);

    return {
      success: true,
      data: {
        chatId,
        messageId,
        emoji,
      },
    };
  } catch (error) {
    console.error("Error sending Telegram reaction:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
