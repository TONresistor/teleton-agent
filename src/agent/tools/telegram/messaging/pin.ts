/**
 * telegram_pin_message / telegram_unpin_message
 * Pin or unpin messages in chats
 */

import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

// ============================================
// PIN MESSAGE
// ============================================

interface PinMessageParams {
  chat_id: string;
  message_id: number;
  silent?: boolean;
  both_sides?: boolean;
}

export const telegramPinMessageTool: Tool = {
  name: "telegram_pin_message",
  description: `Pin a message in a chat. In groups/channels, pinned messages appear at the top. You need admin rights to pin in groups/channels.`,
  parameters: Type.Object({
    chat_id: Type.String({
      description: "Chat ID or username",
    }),
    message_id: Type.Number({
      description: "ID of the message to pin",
    }),
    silent: Type.Optional(
      Type.Boolean({
        description: "Pin silently without notification (default: false)",
      })
    ),
    both_sides: Type.Optional(
      Type.Boolean({
        description: "Pin for both sides in private chats (default: true)",
      })
    ),
  }),
};

export const telegramPinMessageExecutor: ToolExecutor<PinMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chat_id, message_id, silent = false, both_sides = true } = params;

    const client = context.bridge.getClient().getClient();

    await client.invoke(
      new Api.messages.UpdatePinnedMessage({
        peer: chat_id,
        id: message_id,
        silent,
        pmOneside: !both_sides,
      })
    );

    return {
      success: true,
      data: {
        chat_id,
        message_id,
        pinned: true,
        message: `📌 Message #${message_id} pinned`,
      },
    };
  } catch (error) {
    console.error("Error in telegram_pin_message:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// ============================================
// UNPIN MESSAGE
// ============================================

interface UnpinMessageParams {
  chat_id: string;
  message_id?: number;
  unpin_all?: boolean;
}

export const telegramUnpinMessageTool: Tool = {
  name: "telegram_unpin_message",
  description: `Unpin a message or all messages in a chat. You need admin rights in groups/channels.`,
  parameters: Type.Object({
    chat_id: Type.String({
      description: "Chat ID or username",
    }),
    message_id: Type.Optional(
      Type.Number({
        description:
          "ID of the message to unpin. If not provided and unpin_all is false, unpins the most recent pinned message.",
      })
    ),
    unpin_all: Type.Optional(
      Type.Boolean({
        description: "Unpin ALL pinned messages in the chat (default: false)",
      })
    ),
  }),
};

export const telegramUnpinMessageExecutor: ToolExecutor<UnpinMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chat_id, message_id, unpin_all = false } = params;

    const client = context.bridge.getClient().getClient();

    if (unpin_all) {
      await client.invoke(
        new Api.messages.UnpinAllMessages({
          peer: chat_id,
        })
      );

      return {
        success: true,
        data: {
          chat_id,
          unpinned_all: true,
          message: `📌 All messages unpinned`,
        },
      };
    } else {
      await client.invoke(
        new Api.messages.UpdatePinnedMessage({
          peer: chat_id,
          id: message_id ?? 0,
          unpin: true,
        })
      );

      return {
        success: true,
        data: {
          chat_id,
          message_id,
          unpinned: true,
          message: message_id
            ? `📌 Message #${message_id} unpinned`
            : `📌 Latest pinned message unpinned`,
        },
      };
    }
  } catch (error) {
    console.error("Error in telegram_unpin_message:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
