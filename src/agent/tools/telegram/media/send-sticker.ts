import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";

/**
 * Parameters for telegram_send_sticker tool
 */
interface SendStickerParams {
  chatId: string;
  stickerSetShortName?: string;
  stickerIndex?: number;
  stickerPath?: string;
  replyToId?: number;
}

/**
 * Tool definition for sending stickers
 */
export const telegramSendStickerTool: Tool = {
  name: "telegram_send_sticker",
  description:
    "Send a sticker to a Telegram chat. You can either provide a sticker set's short name + index (position in the pack, starting from 0), or a local path to a WEBP/TGS file. To find sticker sets, use telegram_search_stickers first to get the shortName, then choose which sticker (by index 0-N) to send.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to send the sticker to",
    }),
    stickerSetShortName: Type.Optional(
      Type.String({
        description:
          "Short name of the sticker pack (from telegram_search_stickers results). Use with stickerIndex.",
      })
    ),
    stickerIndex: Type.Optional(
      Type.Number({
        description:
          "Index (0-based) of the sticker within the pack. First sticker = 0, second = 1, etc. Use with stickerSetShortName.",
        minimum: 0,
      })
    ),
    stickerPath: Type.Optional(
      Type.String({
        description:
          "Local file path to a sticker file (.webp or .tgs). Alternative to using stickerSetShortName + stickerIndex.",
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
 * Executor for telegram_send_sticker tool
 */
export const telegramSendStickerExecutor: ToolExecutor<SendStickerParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, stickerSetShortName, stickerIndex, stickerPath, replyToId } = params;

    // Validate input
    const hasSetInfo = stickerSetShortName !== undefined && stickerIndex !== undefined;
    const hasPath = stickerPath !== undefined;

    if (!hasSetInfo && !hasPath) {
      return {
        success: false,
        error: "Must provide either (stickerSetShortName + stickerIndex) or stickerPath",
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Method 1: Send sticker from a sticker set by name + index
    if (hasSetInfo) {
      // Get the sticker set to access individual stickers
      const stickerSet: any = await gramJsClient.invoke(
        new Api.messages.GetStickerSet({
          stickerset: new Api.InputStickerSetShortName({
            shortName: stickerSetShortName!,
          }),
          hash: 0,
        })
      );

      if (!stickerSet.documents || stickerSet.documents.length === 0) {
        return {
          success: false,
          error: `Sticker set '${stickerSetShortName}' is empty or not found`,
        };
      }

      if (stickerIndex! >= stickerSet.documents.length) {
        return {
          success: false,
          error: `Sticker index ${stickerIndex} out of range. Set has ${stickerSet.documents.length} stickers (0-${stickerSet.documents.length - 1})`,
        };
      }

      // Get the specific sticker document
      const stickerDoc = stickerSet.documents[stickerIndex!];

      // Send using SendMedia with the document
      const result = await gramJsClient.invoke(
        new Api.messages.SendMedia({
          peer: chatId,
          media: new Api.InputMediaDocument({
            id: new Api.InputDocument({
              id: stickerDoc.id,
              accessHash: stickerDoc.accessHash,
              fileReference: stickerDoc.fileReference,
            }),
          }),
          message: "",
          randomId: BigInt(Math.floor(Math.random() * 1e16)) as any,
          replyTo: replyToId ? new Api.InputReplyToMessage({ replyToMsgId: replyToId }) : undefined,
        })
      );

      return {
        success: true,
        data: {
          stickerSet: stickerSetShortName,
          stickerIndex,
          totalInSet: stickerSet.documents.length,
        },
      };
    }

    // Method 2: Send local sticker file
    // Validate workspace path
    let validatedPath;
    try {
      validatedPath = validateReadPath(stickerPath!);
    } catch (error) {
      if (error instanceof WorkspaceSecurityError) {
        return {
          success: false,
          error: `Security Error: ${error.message}. Stickers must be in your workspace (downloads/ or uploads/).`,
        };
      }
      throw error;
    }

    const result = await gramJsClient.sendFile(chatId, {
      file: validatedPath.absolutePath,
      replyTo: replyToId,
    });

    return {
      success: true,
      data: {
        messageId: result.id,
        date: result.date,
      },
    };
  } catch (error) {
    console.error("Error sending sticker:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
