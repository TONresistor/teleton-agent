import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_set_bio tool
 */
interface SetBioParams {
  bio: string;
}

/**
 * Tool definition for setting user bio
 */
export const telegramSetBioTool: Tool = {
  name: "telegram_set_bio",
  description:
    "Set or update your Telegram bio (the 'About' section in your profile). This short text describes who you are or what you do, visible to anyone who views your profile. Max 70 characters. Use this to share a tagline, status, or brief description. Leave empty to remove bio entirely.",
  parameters: Type.Object({
    bio: Type.String({
      description:
        "Your new bio text (max 70 characters). Examples: 'Software Engineer 🚀', 'Crypto enthusiast', 'Building cool stuff'. Empty string to remove bio.",
      maxLength: 70,
    }),
  }),
};

/**
 * Executor for telegram_set_bio tool
 */
export const telegramSetBioExecutor: ToolExecutor<SetBioParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { bio } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Update bio using UpdateProfile
    await gramJsClient.invoke(
      new Api.account.UpdateProfile({
        about: bio,
      })
    );

    return {
      success: true,
      data: {
        bio,
        length: bio.length,
      },
    };
  } catch (error) {
    console.error("Error setting bio:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
