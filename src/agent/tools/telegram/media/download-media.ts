import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import { writeFileSync } from "fs";
import { extname } from "path";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import {
  validateWritePath,
  WorkspaceSecurityError,
  WORKSPACE_PATHS,
} from "../../../../workspace/index.js";

/**
 * Parameters for telegram_download_media tool
 */
interface DownloadMediaParams {
  chatId: string;
  messageId: number;
  filename?: string;
}

/**
 * Tool definition for downloading media
 */
export const telegramDownloadMediaTool: Tool = {
  name: "telegram_download_media",
  description:
    "Download media (photo, video, document, voice, sticker, etc.) from a Telegram message. The file will be saved to ~/.teleton/downloads/. Use this to retrieve images, documents, or other files sent in conversations. Returns the local file path after download.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the message with media is located",
    }),
    messageId: Type.Number({
      description: "The message ID containing the media to download",
    }),
    filename: Type.Optional(
      Type.String({
        description:
          "Optional custom filename (without path). If not provided, uses original filename or generates one.",
      })
    ),
  }),
};

/**
 * Executor for telegram_download_media tool
 */
export const telegramDownloadMediaExecutor: ToolExecutor<DownloadMediaParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, messageId, filename } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get the message
    const messages = await gramJsClient.getMessages(chatId, {
      ids: [messageId],
    });

    if (!messages || messages.length === 0) {
      return {
        success: false,
        error: `Message ${messageId} not found in chat ${chatId}`,
      };
    }

    const message = messages[0];

    // Check if message has media
    if (!message.media) {
      return {
        success: false,
        error: "Message does not contain any media",
      };
    }

    // Determine file extension based on media type
    let extension = "";
    let mediaType = "unknown";

    if (message.photo) {
      extension = ".jpg";
      mediaType = "photo";
    } else if (message.video) {
      extension = ".mp4";
      mediaType = "video";
    } else if (message.audio) {
      extension = ".mp3";
      mediaType = "audio";
    } else if (message.voice) {
      extension = ".ogg";
      mediaType = "voice";
    } else if (message.videoNote) {
      extension = ".mp4";
      mediaType = "video_note";
    } else if (message.sticker) {
      const sticker = message.sticker as any;
      extension = sticker.isAnimated ? ".tgs" : ".webp";
      mediaType = "sticker";
    } else if (message.document) {
      // Try to get original filename
      const doc = message.document as any;
      if (doc.attributes) {
        for (const attr of doc.attributes) {
          if (attr.fileName) {
            extension = "";
            break;
          }
        }
      }
      if (!extension) {
        extension = ".bin";
      }
      mediaType = "document";
    } else if (message.gif) {
      extension = ".mp4";
      mediaType = "gif";
    }

    // Validate custom filename extension matches media type (security check)
    if (filename) {
      const providedExt = extname(filename).toLowerCase();
      const expectedExt = extension.toLowerCase();

      // Case 1: Media has extension but filename doesn't
      if (expectedExt && !providedExt) {
        return {
          success: false,
          error: `Missing extension: filename '${filename}' must have extension '${expectedExt}' for ${mediaType}`,
        };
      }

      // Case 2: Filename has extension but media doesn't expect one
      if (providedExt && !expectedExt) {
        return {
          success: false,
          error: `Unexpected extension: filename '${filename}' has extension '${providedExt}' but ${mediaType} does not require one`,
        };
      }

      // Case 3: Both have extensions but they don't match
      if (providedExt && expectedExt && providedExt !== expectedExt) {
        return {
          success: false,
          error:
            `Extension mismatch: '${providedExt}' does not match expected '${expectedExt}' for ${mediaType}. ` +
            `This prevents saving a ${mediaType} with a misleading extension.`,
        };
      }
    }

    // Generate filename
    const finalFilename = filename || `${chatId}_${messageId}_${Date.now()}${extension}`;

    // Validate workspace path for downloads/
    const downloadPath = `downloads/${finalFilename}`;
    let validatedPath;
    try {
      validatedPath = validateWritePath(downloadPath);
    } catch (error) {
      if (error instanceof WorkspaceSecurityError) {
        return {
          success: false,
          error: `Security Error: ${error.message}. Downloads must be saved to workspace downloads/.`,
        };
      }
      throw error;
    }

    // Download the media
    const buffer = await gramJsClient.downloadMedia(message, {});

    if (!buffer) {
      return {
        success: false,
        error: "Failed to download media - empty buffer returned",
      };
    }

    // Save to file
    writeFileSync(validatedPath.absolutePath, buffer);

    return {
      success: true,
      data: {
        filePath: validatedPath.relativePath,
        absolutePath: validatedPath.absolutePath,
        mediaType,
        size: buffer.length,
        filename: finalFilename,
      },
    };
  } catch (error) {
    console.error("Error downloading media:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
