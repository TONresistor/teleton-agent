/**
 * telegram_set_chat_photo - Set or delete chat/group/channel photo
 */

import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import { readFileSync } from "fs";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";

interface SetChatPhotoParams {
  chat_id: string;
  photo_path?: string;
  delete_photo?: boolean;
}

export const telegramSetChatPhotoTool: Tool = {
  name: "telegram_set_chat_photo",
  description: `Set or delete a group/channel profile photo. You need admin rights with change info permission. Provide a local image path to set, or use delete_photo to remove.`,
  parameters: Type.Object({
    chat_id: Type.String({
      description: "Group/channel ID or username",
    }),
    photo_path: Type.Optional(
      Type.String({
        description: "Local path to the image file (JPG, PNG)",
      })
    ),
    delete_photo: Type.Optional(
      Type.Boolean({
        description: "Set to true to delete the current photo",
      })
    ),
  }),
};

export const telegramSetChatPhotoExecutor: ToolExecutor<SetChatPhotoParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chat_id, photo_path, delete_photo = false } = params;

    const client = context.bridge.getClient().getClient();

    // Get entity to determine if it's a channel or regular chat
    const entity = await client.getEntity(chat_id);
    const isChannel = entity instanceof Api.Channel || entity instanceof Api.ChannelForbidden;

    if (delete_photo) {
      // Delete photo
      if (isChannel) {
        await client.invoke(
          new Api.channels.EditPhoto({
            channel: chat_id,
            photo: new Api.InputChatPhotoEmpty(),
          })
        );
      } else {
        await client.invoke(
          new Api.messages.EditChatPhoto({
            chatId: BigInt(chat_id) as any,
            photo: new Api.InputChatPhotoEmpty(),
          })
        );
      }

      return {
        success: true,
        data: {
          chat_id,
          photo_deleted: true,
          message: `🖼️ Chat photo deleted`,
        },
      };
    }

    if (!photo_path) {
      return {
        success: false,
        error: "Must provide either photo_path or delete_photo=true",
      };
    }

    // Validate workspace path
    let validatedPath;
    try {
      validatedPath = validateReadPath(photo_path);
    } catch (error) {
      if (error instanceof WorkspaceSecurityError) {
        return {
          success: false,
          error: `Security Error: ${error.message}. Photos must be in your workspace (downloads/ or uploads/).`,
        };
      }
      throw error;
    }

    // Read and upload the file
    const fileBuffer = readFileSync(validatedPath.absolutePath);

    // Upload file
    const file = await client.uploadFile({
      file: new CustomFile(
        validatedPath.filename,
        fileBuffer.length,
        validatedPath.absolutePath,
        fileBuffer
      ),
      workers: 1,
    });

    // Set photo
    if (isChannel) {
      await client.invoke(
        new Api.channels.EditPhoto({
          channel: chat_id,
          photo: new Api.InputChatUploadedPhoto({
            file,
          }),
        })
      );
    } else {
      await client.invoke(
        new Api.messages.EditChatPhoto({
          chatId: BigInt(chat_id) as any,
          photo: new Api.InputChatUploadedPhoto({
            file,
          }),
        })
      );
    }

    return {
      success: true,
      data: {
        chat_id,
        photo_set: true,
        photo_path,
        message: `🖼️ Chat photo updated`,
      },
    };
  } catch (error) {
    console.error("Error in telegram_set_chat_photo:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Custom file class for GramJS upload
 */
class CustomFile {
  name: string;
  size: number;
  path: string;
  buffer: Buffer;

  constructor(name: string, size: number, path: string, buffer: Buffer) {
    this.name = name;
    this.size = size;
    this.path = path;
    this.buffer = buffer;
  }

  async *[Symbol.asyncIterator]() {
    yield this.buffer;
  }
}
