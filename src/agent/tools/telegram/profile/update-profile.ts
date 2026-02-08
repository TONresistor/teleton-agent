import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

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
    "Update your Telegram profile information including first name, last name, and bio (about text). Changes are visible to all users who view your profile. Use this to keep your public identity current, reflect life changes, or update your description. Leave fields undefined to keep current values.",
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
    console.error("Error updating profile:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
