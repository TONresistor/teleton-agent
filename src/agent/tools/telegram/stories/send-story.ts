import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import bigInt from "big-integer";
import { CustomFile } from "telegram/client/uploads.js";
import { readFileSync, statSync } from "fs";
import { basename } from "path";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";

/**
 * Parameters for telegram_send_story tool
 */
interface SendStoryParams {
  mediaPath: string;
  caption?: string;
  privacy?: "everyone" | "contacts" | "close_friends";
  duration?: number;
}

/**
 * Tool definition for sending Telegram stories
 */
export const telegramSendStoryTool: Tool = {
  name: "telegram_send_story",
  description:
    "Post a story (ephemeral photo/video) to Telegram that disappears after 24 hours. Stories are displayed at the top of chats and provide high visibility. Use this for announcements, updates, or time-sensitive visual content. Supports photos (JPG, PNG) and videos (MP4).",
  parameters: Type.Object({
    mediaPath: Type.String({
      description:
        "Local file path to the media (photo or video) for the story (e.g., '/path/to/image.jpg' or '/path/to/video.mp4')",
    }),
    caption: Type.Optional(
      Type.String({
        description: "Optional caption/text to display on the story",
        maxLength: 200,
      })
    ),
    privacy: Type.Optional(
      Type.String({
        description: "Who can see the story: 'everyone' (default), 'contacts', or 'close_friends'",
        enum: ["everyone", "contacts", "close_friends"],
      })
    ),
    duration: Type.Optional(
      Type.Number({
        description:
          "Story duration in seconds for videos (default: video length, ignored for photos)",
        minimum: 1,
        maximum: 60,
      })
    ),
  }),
};

/**
 * Executor for telegram_send_story tool
 */
export const telegramSendStoryExecutor: ToolExecutor<SendStoryParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { mediaPath, caption, privacy = "everyone", duration } = params;

    // Validate workspace path
    let validatedPath;
    try {
      validatedPath = validateReadPath(mediaPath);
    } catch (error) {
      if (error instanceof WorkspaceSecurityError) {
        return {
          success: false,
          error: `Security Error: ${error.message}. Story media must be in your workspace (downloads/ or uploads/).`,
        };
      }
      throw error;
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Read media file
    const filePath = validatedPath.absolutePath;
    const fileName = basename(filePath);
    const fileSize = statSync(filePath).size;
    const fileBuffer = readFileSync(filePath);
    const isVideo = filePath.toLowerCase().match(/\.(mp4|mov|avi)$/);

    // Create CustomFile for upload
    const customFile = new CustomFile(fileName, fileSize, filePath, fileBuffer);

    // Upload media
    const uploadedFile = await gramJsClient.uploadFile({
      file: customFile,
      workers: 1,
    });

    // Determine media type and create InputMedia
    let inputMedia;
    if (isVideo) {
      inputMedia = new Api.InputMediaUploadedDocument({
        file: uploadedFile,
        mimeType: "video/mp4",
        attributes: [
          new Api.DocumentAttributeVideo({
            duration: duration || 0,
            w: 720,
            h: 1280,
            supportsStreaming: true,
          }),
          new Api.DocumentAttributeFilename({ fileName }),
        ],
      });
    } else {
      inputMedia = new Api.InputMediaUploadedPhoto({
        file: uploadedFile,
      });
    }

    // Determine privacy rules
    let privacyRules: Api.TypeInputPrivacyRule[];
    switch (privacy) {
      case "contacts":
        privacyRules = [new Api.InputPrivacyValueAllowContacts()];
        break;
      case "close_friends":
        privacyRules = [new Api.InputPrivacyValueAllowCloseFriends()];
        break;
      case "everyone":
      default:
        privacyRules = [new Api.InputPrivacyValueAllowAll()];
        break;
    }

    // Send story using GramJS
    const result = await gramJsClient.invoke(
      new Api.stories.SendStory({
        peer: "me",
        media: inputMedia,
        caption: caption || "",
        privacyRules,
        randomId: bigInt(Date.now().toString()),
      })
    );

    return {
      success: true,
      data: {
        storyId: (result as any).id || null,
        privacy,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      },
    };
  } catch (error) {
    console.error("Error sending Telegram story:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
