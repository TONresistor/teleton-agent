import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";

/**
 * Parameters for telegram_send_gif tool
 */
interface SendGifParams {
  chatId: string;
  queryId?: string;
  resultId?: string;
  gifPath?: string;
  caption?: string;
  replyToId?: number;
}

/**
 * Tool definition for sending GIF animations
 */
export const telegramSendGifTool: Tool = {
  name: "telegram_send_gif",
  description:
    "Send an animated GIF to a Telegram chat. You can either: 1) Use queryId + resultId from telegram_search_gifs to send a GIF from Telegram's library, or 2) Provide a local file path to a GIF/MP4. For online GIFs, always use the search + send workflow.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to send the GIF to",
    }),
    queryId: Type.Optional(
      Type.String({
        description: "Query ID from telegram_search_gifs results. Use with resultId.",
      })
    ),
    resultId: Type.Optional(
      Type.String({
        description: "Result ID of the specific GIF from telegram_search_gifs. Use with queryId.",
      })
    ),
    gifPath: Type.Optional(
      Type.String({
        description: "Local file path to a GIF or MP4 file. Alternative to queryId + resultId.",
      })
    ),
    caption: Type.Optional(
      Type.String({
        description: "Optional caption/text to accompany the GIF",
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
 * Executor for telegram_send_gif tool
 */
export const telegramSendGifExecutor: ToolExecutor<SendGifParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, queryId, resultId, gifPath, caption, replyToId } = params;

    // Validate input
    const hasInlineResult = queryId !== undefined && resultId !== undefined;
    const hasPath = gifPath !== undefined;

    if (!hasInlineResult && !hasPath) {
      return {
        success: false,
        error: "Must provide either (queryId + resultId) from search, or gifPath",
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Method 1: Send GIF from inline bot result (@gif)
    if (hasInlineResult) {
      const result = await gramJsClient.invoke(
        new Api.messages.SendInlineBotResult({
          peer: chatId,
          queryId: BigInt(queryId!) as any,
          id: resultId!,
          randomId: BigInt(Math.floor(Math.random() * 1e16)) as any,
          replyTo: replyToId ? new Api.InputReplyToMessage({ replyToMsgId: replyToId }) : undefined,
        })
      );

      return {
        success: true,
        data: {
          sentVia: "inline_bot",
          queryId,
          resultId,
        },
      };
    }

    // Method 2: Send local GIF file
    // Validate workspace path
    let validatedPath;
    try {
      validatedPath = validateReadPath(gifPath!);
    } catch (error) {
      if (error instanceof WorkspaceSecurityError) {
        return {
          success: false,
          error: `Security Error: ${error.message}. GIFs must be in your workspace (downloads/ or uploads/).`,
        };
      }
      throw error;
    }

    const result = await gramJsClient.sendFile(chatId, {
      file: validatedPath.absolutePath,
      caption: caption,
      replyTo: replyToId,
      attributes: [new Api.DocumentAttributeAnimated()],
    });

    return {
      success: true,
      data: {
        messageId: result.id,
        date: result.date,
      },
    };
  } catch (error) {
    console.error("Error sending GIF:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
