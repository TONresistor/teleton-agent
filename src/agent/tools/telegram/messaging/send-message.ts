import { Type } from "@sinclair/typebox";
import type { RichMessageContent } from "../../../../telegram/bridge-interface.js";
import {
  compileRichMessageMarkdown,
  RICH_MESSAGE_MAX_BYTES,
} from "../../../../telegram/outgoing-rich-message.js";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { prepareRichMessageContent, richMessageContentSchema } from "./rich-content.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_send_message tool
 */
interface SendMessageParams {
  chatId?: string;
  text?: string;
  replyToId?: number;
  rich?: RichMessageContent;
}

/**
 * Tool definition for sending Telegram messages
 */
export const telegramSendMessageTool: Tool = {
  name: "telegram_send_message",
  description:
    "Send a Telegram message. Omit chatId to use the current chat. Use text alone for a normal message, or add rich for one native user-mode Rich Message with structured blocks, local attachments, URL/copy buttons, alignment, and styles. Do not write tg:// references yourself.",
  parameters: Type.Object({
    chatId: Type.Optional(
      Type.String({
        description: "Destination chat ID. Defaults to the current chat.",
      })
    ),
    text: Type.Optional(
      Type.String({
        description: "Plain text or Rich Markdown content",
        maxLength: RICH_MESSAGE_MAX_BYTES,
      })
    ),
    replyToId: Type.Optional(
      Type.Number({
        description: "Optional message ID to reply to",
      })
    ),
    rich: Type.Optional(richMessageContentSchema),
  }),
};

/**
 * Executor for telegram_send_message tool
 */
export const telegramSendMessageExecutor: ToolExecutor<SendMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const chatId = params.chatId ?? context.chatId;
    const text = params.text ?? "";
    const rich = prepareRichMessageContent(params.rich, context);
    if (!text.trim() && !rich) {
      return { success: false, error: "Message content cannot be empty" };
    }

    const compiled = rich ? compileRichMessageMarkdown(text, rich) : null;

    const sentMessage = await context.bridge.sendMessage({
      chatId,
      text,
      replyToId: params.replyToId,
      rich,
    });

    const firstAttachment = rich?.attachments?.[0];

    return {
      success: true,
      data: {
        messageId: sentMessage?.id ?? null,
        date: sentMessage?.date ?? null,
        chatId,
        deliveryKind: rich ? "rich" : "text",
        renderedText: compiled?.markdown ?? text,
        hasMedia: Boolean(rich?.attachments?.length),
        mediaType: firstAttachment?.type,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error sending Telegram message");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
