import { randomLong } from "../../../../utils/gramjs-bigint.js";
import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_forward_message tool
 */
interface ForwardMessageParams {
  fromChatId: string;
  toChatId: string;
  messageIds: number[];
  silent?: boolean;
  background?: boolean;
}

/**
 * Tool definition for forwarding Telegram messages
 */
export const telegramForwardMessageTool: Tool = {
  name: "telegram_forward_message",
  description:
    "Forward one or more messages from one chat to another. Shows original sender attribution.",
  parameters: Type.Object({
    fromChatId: Type.String({
      description: "The chat ID where the original message(s) are located",
    }),
    toChatId: Type.String({
      description: "The destination chat ID to forward messages to",
    }),
    messageIds: Type.Array(Type.Number(), {
      description: "Array of message IDs to forward (can forward multiple at once)",
    }),
    silent: Type.Optional(
      Type.Boolean({
        description: "Send message silently (no notification to recipients). Default: false",
      })
    ),
    background: Type.Optional(
      Type.Boolean({
        description: "Forward in background (don't mark chat as unread for sender). Default: false",
      })
    ),
  }),
};

/**
 * Executor for telegram_forward_message tool
 */
export const telegramForwardMessageExecutor: ToolExecutor<ForwardMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { fromChatId, toChatId, messageIds, silent = false, background = false } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Forward messages using GramJS API
    const result = await gramJsClient.invoke(
      new Api.messages.ForwardMessages({
        fromPeer: fromChatId,
        toPeer: toChatId,
        id: messageIds,
        silent,
        background,
        randomId: messageIds.map(() => randomLong()),
      })
    );

    return {
      success: true,
      data: {
        messageCount: messageIds.length,
        fromChatId,
        toChatId,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error forwarding Telegram messages");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
