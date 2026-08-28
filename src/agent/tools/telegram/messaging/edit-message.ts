import { Type } from "@sinclair/typebox";
import type { RichMessageContent } from "../../../../telegram/bridge-interface.js";
import { RICH_MESSAGE_MAX_BYTES } from "../../../../telegram/outgoing-rich-message.js";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { prepareRichMessageContent, richMessageContentSchema } from "./rich-content.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_edit_message tool
 */
interface EditMessageParams {
  chatId: string;
  messageId: number;
  text?: string;
  rich?: RichMessageContent;
}

/**
 * Tool definition for editing Telegram messages
 */
export const telegramEditMessageTool: Tool = {
  name: "telegram_edit_message",
  description:
    "Modify a previously sent message in-place. Use text alone for a normal edit or add rich to replace it with the same native Rich Message structure supported by telegram_send_message.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the message was sent",
    }),
    messageId: Type.Number({
      description: "The ID of the message to edit",
    }),
    text: Type.Optional(
      Type.String({
        description: "New plain text or Rich Markdown content",
        maxLength: RICH_MESSAGE_MAX_BYTES,
      })
    ),
    rich: Type.Optional(richMessageContentSchema),
  }),
};

/**
 * Executor for telegram_edit_message tool
 */
export const telegramEditMessageExecutor: ToolExecutor<EditMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const text = params.text ?? "";
    const rich = prepareRichMessageContent(params.rich, context);
    if (!text.trim() && !rich) {
      return { success: false, error: "Message content cannot be empty" };
    }
    const result = await context.bridge.editMessage({
      chatId: params.chatId,
      messageId: params.messageId,
      text,
      rich,
    });

    return {
      success: true,
      data: {
        messageId: result.id,
        chatId: result.chatId,
        edited: true,
        date: result.date,
        deliveryKind: rich ? "rich" : "text",
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error editing Telegram message");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
