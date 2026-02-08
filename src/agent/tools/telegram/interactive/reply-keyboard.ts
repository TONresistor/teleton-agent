import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_reply_keyboard tool
 */
interface ReplyKeyboardParams {
  chatId: string;
  text: string;
  buttons: string[][];
  oneTime?: boolean;
  resize?: boolean;
  selective?: boolean;
  replyToId?: number;
}

/**
 * Tool definition for sending messages with reply keyboards
 */
export const telegramReplyKeyboardTool: Tool = {
  name: "telegram_reply_keyboard",
  description:
    "Send a message with a custom reply keyboard that replaces the user's regular keyboard. Users can tap buttons to quickly send predefined responses. Each button sends its text as a message. Use this to create menus, quick replies, or guided conversations. Buttons are arranged in rows. Example: [['Yes', 'No'], ['Maybe']] creates 2 rows.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to send the message with keyboard to",
    }),
    text: Type.String({
      description: "The message text to send along with the keyboard",
    }),
    buttons: Type.Array(Type.Array(Type.String()), {
      description:
        "2D array of button labels. Each inner array is a row. Example: [['Option A', 'Option B'], ['Cancel']] creates 2 rows with 3 total buttons.",
      minItems: 1,
    }),
    oneTime: Type.Optional(
      Type.Boolean({
        description:
          "Hide keyboard after user taps a button (one-time use). Default: false (persistent keyboard).",
      })
    ),
    resize: Type.Optional(
      Type.Boolean({
        description:
          "Auto-resize keyboard to fit buttons (takes less screen space). Default: true. Set to false for full-height keyboard.",
      })
    ),
    selective: Type.Optional(
      Type.Boolean({
        description:
          "Show keyboard only to mentioned users or reply targets. Default: false (show to everyone).",
      })
    ),
    replyToId: Type.Optional(
      Type.Number({
        description: "Optional message ID to reply to",
      })
    ),
  }),
};

/**
 * Executor for telegram_reply_keyboard tool
 */
export const telegramReplyKeyboardExecutor: ToolExecutor<ReplyKeyboardParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const {
      chatId,
      text,
      buttons,
      oneTime = false,
      resize = true,
      selective = false,
      replyToId,
    } = params;

    if (buttons.length === 0 || buttons.some((row) => row.length === 0)) {
      return {
        success: false,
        error: "Buttons array cannot be empty",
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Create reply keyboard markup
    const keyboard = new Api.ReplyKeyboardMarkup({
      rows: buttons.map(
        (row) =>
          new Api.KeyboardButtonRow({
            buttons: row.map((label) => new Api.KeyboardButton({ text: label })),
          })
      ),
      resize,
      singleUse: oneTime,
      selective,
    });

    // Send message with keyboard
    const result: any = await gramJsClient.sendMessage(chatId, {
      message: text,
      replyTo: replyToId,
      buttons: keyboard, // GramJS uses 'buttons' instead of 'replyMarkup'
    });

    return {
      success: true,
      data: {
        messageId: result.id,
        buttonCount: buttons.reduce((sum, row) => sum + row.length, 0),
        rowCount: buttons.length,
      },
    };
  } catch (error) {
    console.error("Error sending message with reply keyboard:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
