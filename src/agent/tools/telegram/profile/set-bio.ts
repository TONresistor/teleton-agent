import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

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
    "Set or update your Telegram bio (About section). Max 70 chars. Empty string to remove.",
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
    log.error({ err: error }, "Error setting bio");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
