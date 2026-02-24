import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_send_photo tool
 */
interface SendPhotoParams {
  chatId: string;
  photoPath: string;
  caption?: string;
  replyToId?: number;
}

/**
 * Tool definition for sending photos
 */
export const telegramSendPhotoTool: Tool = {
  name: "telegram_send_photo",
  description: "Send a photo from a local file path to a Telegram chat. Supports JPG, PNG, WEBP.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to send the photo to",
    }),
    photoPath: Type.String({
      description:
        "Local file path to the photo (e.g., '/path/to/image.jpg'). Must be accessible from the filesystem.",
    }),
    caption: Type.Optional(
      Type.String({
        description: "Optional caption/text to accompany the photo",
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
 * Executor for telegram_send_photo tool
 */
export const telegramSendPhotoExecutor: ToolExecutor<SendPhotoParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, photoPath, caption, replyToId } = params;

    // Validate workspace path
    let validatedPath;
    try {
      validatedPath = validateReadPath(photoPath);
    } catch (error) {
      if (error instanceof WorkspaceSecurityError) {
        return {
          success: false,
          error: `Security Error: ${error.message}. Photos must be in your workspace (downloads/ or uploads/).`,
        };
      }
      throw error;
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Send photo using GramJS sendFile
    const result = await gramJsClient.sendFile(chatId, {
      file: validatedPath.absolutePath,
      caption: caption,
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
    log.error({ err: error }, "Error sending photo");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
