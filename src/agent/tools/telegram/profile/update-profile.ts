import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_update_profile tool
 */
interface UpdateProfileParams {
  firstName?: string;
  lastName?: string;
  about?: string;
}

/**
 * Tool definition for updating user profile
 */
export const telegramUpdateProfileTool: Tool = {
  name: "telegram_update_profile",
  description:
    "Update your profile (first name, last name, bio). Omit fields to keep current values.",
  parameters: Type.Object({
    firstName: Type.Optional(
      Type.String({
        description: "Your first name (max 64 characters). If omitted, current first name is kept.",
        maxLength: 64,
      })
    ),
    lastName: Type.Optional(
      Type.String({
        description:
          "Your last name (max 64 characters). Set to empty string '' to remove. If omitted, current last name is kept.",
        maxLength: 64,
      })
    ),
    about: Type.Optional(
      Type.String({
        description:
          "Your bio/about text (max 70 characters). Visible in your profile. If omitted, current bio is kept.",
        maxLength: 70,
      })
    ),
  }),
};

/**
 * Executor for telegram_update_profile tool
 */
export const telegramUpdateProfileExecutor: ToolExecutor<UpdateProfileParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { firstName, lastName, about } = params;

    if (!firstName && !lastName && about === undefined) {
      return {
        success: false,
        error: "At least one field must be provided to update",
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    const updates: any = {};

    // Update name if provided
    if (firstName !== undefined || lastName !== undefined) {
      const nameResult = await gramJsClient.invoke(
        new Api.account.UpdateProfile({
          firstName,
          lastName,
        })
      );
      updates.name = true;
    }

    // Update about/bio if provided
    if (about !== undefined) {
      await gramJsClient.invoke(
        new Api.account.UpdateProfile({
          about,
        })
      );
      updates.about = true;
    }

    return {
      success: true,
      data: {
        updated: updates,
        firstName,
        lastName,
        about,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error updating profile");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
