import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";

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
  description:
    "Send a photo/image to a Telegram chat. Provide the local file path to the image. Supports JPG, PNG, WEBP formats. Use this to share visual content, screenshots, or images with users.",
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
    console.error("Error sending photo:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
