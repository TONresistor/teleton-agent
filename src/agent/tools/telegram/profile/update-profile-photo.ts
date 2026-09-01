import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getClient } from "../../../../sdk/telegram-utils.js";
import { validateReadPath, WorkspaceSecurityError } from "../../../../workspace/index.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { readFileSync } from "node:fs";
import bigInt from "big-integer";

const log = createLogger("Tools");

interface UpdateProfilePhotoParams {
  photoPath?: string;
  remove?: boolean;
}

export const telegramUpdateProfilePhotoTool: Tool = {
  name: "telegram_update_profile_photo",
  description:
    "Set or remove your personal Telegram profile avatar. Set photoPath to a JPG, PNG, or WEBP in the workspace, or set remove=true. User mode only.",
  parameters: Type.Object({
    photoPath: Type.Optional(
      Type.String({ description: "Workspace path to the new avatar image." })
    ),
    remove: Type.Optional(Type.Boolean({ description: "Remove the current profile avatar." })),
  }),
};

export const telegramUpdateProfilePhotoExecutor: ToolExecutor<UpdateProfilePhotoParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    if ((params.photoPath === undefined) === (params.remove !== true)) {
      return { success: false, error: "Provide exactly one of photoPath or remove=true." };
    }

    const client = getClient(context.bridge);
    if (params.remove) {
      const result = await client.invoke(
        new Api.photos.GetUserPhotos({ userId: "me", offset: 0, maxId: bigInt.zero, limit: 100 })
      );
      const ids = result.photos
        .filter(
          (photo): photo is Api.Photo =>
            photo instanceof Api.Photo && photo.accessHash !== undefined
        )
        .map(
          (photo) =>
            new Api.InputPhoto({
              id: photo.id,
              accessHash: photo.accessHash,
              fileReference: photo.fileReference,
            })
        );
      if (ids.length > 0) await client.invoke(new Api.photos.DeletePhotos({ id: ids }));
      return { success: true, data: { removed: ids.length } };
    }

    if (params.photoPath === undefined) {
      return { success: false, error: "photoPath is required when remove is not set." };
    }

    let validatedPath;
    try {
      validatedPath = validateReadPath(params.photoPath);
    } catch (error) {
      if (error instanceof WorkspaceSecurityError) {
        return { success: false, error: `Security Error: ${error.message}` };
      }
      throw error;
    }

    const buffer = readFileSync(validatedPath.absolutePath);
    const file = await client.uploadFile({
      file: new CustomFile(
        validatedPath.filename,
        buffer.length,
        validatedPath.absolutePath,
        buffer
      ),
      workers: 1,
    });
    await client.invoke(new Api.photos.UploadProfilePhoto({ file }));
    return { success: true, data: { photoPath: params.photoPath } };
  } catch (error) {
    log.error({ err: error }, "Error updating profile photo");
    return { success: false, error: getErrorMessage(error) };
  }
};

class CustomFile {
  constructor(
    readonly name: string,
    readonly size: number,
    readonly path: string,
    readonly buffer: Buffer
  ) {}

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    yield this.buffer;
  }
}
