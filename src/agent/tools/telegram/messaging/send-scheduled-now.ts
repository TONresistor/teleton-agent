import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface SendScheduledNowParams {
  chatId: string;
  messageIds: number[];
}

export const telegramSendScheduledNowTool: Tool = {
  name: "telegram_send_scheduled_now",
  description:
    "Send one or more scheduled messages immediately instead of waiting for their scheduled time.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the scheduled messages are",
    }),
    messageIds: Type.Array(Type.Number(), {
      description: "Array of scheduled message IDs to send immediately",
      minItems: 1,
      maxItems: 30,
    }),
  }),
};

export const telegramSendScheduledNowExecutor: ToolExecutor<SendScheduledNowParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, messageIds } = params;
    const gramJsClient = context.bridge.getClient().getClient();
    const entity = await gramJsClient.getEntity(chatId);

    await gramJsClient.invoke(
      new Api.messages.SendScheduledMessages({
        peer: entity,
        id: messageIds,
      })
    );

    log.info(`🚀 send_scheduled_now: ${messageIds.length} messages sent in ${chatId}`);

    return {
      success: true,
      data: {
        chatId,
        sentIds: messageIds,
        sentCount: messageIds.length,
      },
    };
  } catch (error: any) {
    if (error.errorMessage === "MESSAGE_ID_INVALID") {
      return {
        success: false,
        error: "One or more message IDs are invalid or not scheduled messages.",
      };
    }
    log.error({ err: error }, "Error sending scheduled messages now");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
