import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

interface GetScheduledMessagesParams {
  chatId: string;
}

export const telegramGetScheduledMessagesTool: Tool = {
  name: "telegram_get_scheduled_messages",
  description:
    "List all scheduled (pending) messages in a chat. Shows message text, scheduled send date, and message IDs for management.",
  category: "data-bearing",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to list scheduled messages for",
    }),
  }),
};

export const telegramGetScheduledMessagesExecutor: ToolExecutor<
  GetScheduledMessagesParams
> = async (params, context): Promise<ToolResult> => {
  try {
    const { chatId } = params;
    const gramJsClient = context.bridge.getClient().getClient();
    const entity = await gramJsClient.getEntity(chatId);

    const result = await gramJsClient.invoke(
      new Api.messages.GetScheduledHistory({
        peer: entity,
        hash: 0n as any,
      })
    );

    const messages = ("messages" in result ? result.messages : []) as Api.Message[];

    const scheduled = messages.map((msg) => ({
      id: msg.id,
      text: msg.message || null,
      scheduledFor: msg.date ? new Date(msg.date * 1000).toISOString() : null,
      hasMedia: !!msg.media,
    }));

    log.info(`📋 get_scheduled_messages: ${scheduled.length} scheduled in ${chatId}`);

    return {
      success: true,
      data: {
        chatId,
        count: scheduled.length,
        messages: scheduled,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error getting scheduled messages");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
