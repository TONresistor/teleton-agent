import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_delete_message tool
 */
interface DeleteMessageParams {
  chatId: string;
  messageIds: number[];
  revoke?: boolean;
}

/**
 * Tool definition for deleting messages
 */
export const telegramDeleteMessageTool: Tool = {
  name: "telegram_delete_message",
  description:
    "Delete messages from a chat. Own messages in any chat, or any message with admin rights. Deletion is permanent.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the messages are located",
    }),
    messageIds: Type.Array(Type.Number(), {
      description: "Array of message IDs to delete. Can delete multiple at once.",
    }),
    revoke: Type.Optional(
      Type.Boolean({
        description:
          "If true, delete for everyone (both sides). If false, delete only for yourself. Default: true",
      })
    ),
  }),
};

/**
 * Executor for telegram_delete_message tool
 */
export const telegramDeleteMessageExecutor: ToolExecutor<DeleteMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, messageIds, revoke = true } = params;

    if (messageIds.length === 0) {
      return {
        success: false,
        error: "No message IDs provided",
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Check if it's a channel/supergroup (negative ID starting with -100)
    const isChannel = chatId.startsWith("-100");

    if (isChannel) {
      // Use channels.DeleteMessages for channels/supergroups
      const channel = await gramJsClient.getEntity(chatId);
      await gramJsClient.invoke(
        new Api.channels.DeleteMessages({
          channel: channel,
          id: messageIds,
        })
      );
    } else {
      // Use messages.DeleteMessages for regular chats
      await gramJsClient.invoke(
        new Api.messages.DeleteMessages({
          id: messageIds,
          revoke,
        })
      );
    }

    return {
      success: true,
      data: {
        deletedCount: messageIds.length,
        messageIds,
        revoked: revoke,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error deleting messages");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
