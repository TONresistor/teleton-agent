import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import bigInt from "big-integer";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../../../constants/limits.js";

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
    "Reply to a message while quoting a specific part of it. The quoted text will be highlighted in the reply. Use this when you want to respond to a specific part of someone's message.",
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
        randomId: bigInt(Date.now().toString() + Math.floor(Math.random() * 1000)),
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
    console.error("Error sending quote reply:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
