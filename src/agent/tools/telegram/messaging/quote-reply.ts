import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api, helpers } from "telegram";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../../../constants/limits.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_quote_reply tool
 */
interface QuoteReplyParams {
  chatId: string;
  messageId: number;
  quoteText: string;
  text: string;
  quoteOffset?: number;
}

/**
 * Tool definition for sending a reply with a quote
 */
export const telegramQuoteReplyTool: Tool = {
  name: "telegram_quote_reply",
  description:
    "Highlight and reply to a specific excerpt within a message. Pass chatId + messageId of the target, and quoteText matching the exact substring to quote. When NOT to use: for full-message replies, use telegram_send_message with replyToId instead.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the message is",
    }),
    messageId: Type.Number({
      description: "The message ID to reply to and quote from",
    }),
    quoteText: Type.String({
      description: "The exact text to quote from the original message (must match exactly)",
    }),
    text: Type.String({
      description: "Your reply message text",
      maxLength: TELEGRAM_MAX_MESSAGE_LENGTH,
    }),
    quoteOffset: Type.Optional(
      Type.Number({
        description: "Character offset where the quote starts in the original message (default: 0)",
        minimum: 0,
      })
    ),
  }),
};

/**
 * Executor for telegram_quote_reply tool
 */
export const telegramQuoteReplyExecutor: ToolExecutor<QuoteReplyParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, messageId, quoteText, text, quoteOffset = 0 } = params;

    // Get the underlying GramJS client
    const client = context.bridge.getClient().getClient();

    // Resolve the peer (chat entity)
    const peer = await client.getInputEntity(chatId);

    // Create the InputReplyToMessage with quote
    const replyTo = new Api.InputReplyToMessage({
      replyToMsgId: messageId,
      quoteText: quoteText,
      quoteOffset: quoteOffset,
    });

    // Send the message with quote reply using raw API
    const result = await client.invoke(
      new Api.messages.SendMessage({
        peer: peer,
        message: text,
        replyTo: replyTo,
        randomId: helpers.generateRandomBigInt(),
      })
    );

    // Extract message ID from result
    let sentMessageId: number | undefined;
    if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
      for (const update of result.updates) {
        if (update instanceof Api.UpdateMessageID) {
          sentMessageId = update.id;
          break;
        }
      }
    }

    return {
      success: true,
      data: {
        messageId: sentMessageId,
        quotedText: quoteText,
        replyText: text,
        message: `Replied with quote: "${quoteText.slice(0, 50)}${quoteText.length > 50 ? "..." : ""}"`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error sending quote reply");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
