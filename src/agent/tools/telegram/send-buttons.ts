import { Type } from "@sinclair/typebox";
import type { ToolEntry } from "../types.js";
import { callbackRouter } from "../../../bot/callback-router.js";

const tool = {
  name: "telegram_send_buttons",
  description:
    "Send a message with interactive inline keyboard buttons. Use for confirmations (Confirm/Cancel), pagination (Previous/Next), or quick actions.",
  parameters: Type.Object({
    text: Type.String({ description: "Message text above the buttons" }),
    buttons: Type.Array(
      Type.Object({
        label: Type.String({ description: "Text shown on the button" }),
      }),
      { description: "Buttons to display" }
    ),
    columns: Type.Optional(Type.Number({ description: "Buttons per row (default: 2)" })),
  }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool executors accept varied param shapes
const executor = async (params: any, context: any) => {
  const { text, buttons, columns = 2 } = params;
  const chatId = context.chatId;
  const senderId = context.senderId;

  if (buttons.length > 100) {
    return { success: false, error: "Too many buttons (Telegram limit: 100)" };
  }
  const effectiveColumns = Math.max(1, Math.min(8, Math.floor(columns)));

  // Build inline keyboard with nonce-based callback data
  const inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  let currentRow: Array<{ text: string; callback_data: string }> = [];

  for (const btn of buttons) {
    const callbackData = callbackRouter.registerNonce(btn.label, chatId, senderId);
    currentRow.push({ text: btn.label, callback_data: callbackData });
    if (currentRow.length >= effectiveColumns) {
      inlineKeyboard.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) {
    inlineKeyboard.push(currentRow);
  }

  const sent = await context.bridge.sendMessage({
    chatId,
    text,
    inlineKeyboard,
  });

  return { success: true, message_id: sent.id };
};

export const sendButtonsEntry: ToolEntry = {
  tool,
  executor,
  scope: "always",
  mode: "bot",
  tags: ["social", "bot"],
};
