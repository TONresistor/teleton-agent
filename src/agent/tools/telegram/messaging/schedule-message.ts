import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../../../constants/limits.js";

/**
 * Parameters for telegram_schedule_message tool
 */
interface ScheduleMessageParams {
  chatId: string;
  text: string;
  scheduleDate: string; // ISO 8601 string
}

/**
 * Tool definition for scheduling Telegram messages
 */
export const telegramScheduleMessageTool: Tool = {
  name: "telegram_schedule_message",
  description:
    "Schedule a message to be sent at a specific future time in a Telegram chat. Useful for reminders, delayed announcements, or time-sensitive messages. The message will be sent automatically at the scheduled time.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID to send the scheduled message to",
    }),
    text: Type.String({
      description: "The message text to send (max 4096 characters)",
      maxLength: TELEGRAM_MAX_MESSAGE_LENGTH,
    }),
    scheduleDate: Type.String({
      description:
        "When to send the message (ISO 8601 format, e.g., '2024-12-25T10:00:00Z' or Unix timestamp as string)",
    }),
  }),
};

/**
 * Executor for telegram_schedule_message tool
 */
export const telegramScheduleMessageExecutor: ToolExecutor<ScheduleMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, text, scheduleDate } = params;

    // Parse schedule date to Unix timestamp
    let scheduleTimestamp: number;

    // Try to parse as ISO 8601 date
    const parsedDate = new Date(scheduleDate);
    if (!isNaN(parsedDate.getTime())) {
      scheduleTimestamp = Math.floor(parsedDate.getTime() / 1000);
    } else {
      // Try as Unix timestamp
      scheduleTimestamp = parseInt(scheduleDate, 10);
      if (isNaN(scheduleTimestamp)) {
        return {
          success: false,
          error:
            "Invalid scheduleDate format. Use ISO 8601 (e.g., '2024-12-25T10:00:00Z') or Unix timestamp.",
        };
      }
    }

    // Validate future date
    const now = Math.floor(Date.now() / 1000);
    if (scheduleTimestamp <= now) {
      return {
        success: false,
        error: "Schedule date must be in the future",
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get chat entity
    const entity = await gramJsClient.getEntity(chatId);

    // Send scheduled message using GramJS
    const result = await gramJsClient.invoke(
      new Api.messages.SendMessage({
        peer: entity,
        message: text,
        scheduleDate: scheduleTimestamp,
        randomId: Date.now() as any,
      })
    );

    const resultData = result as any;
    return {
      success: true,
      data: {
        chatId,
        scheduledFor: new Date(scheduleTimestamp * 1000).toISOString(),
        messageId: resultData.updates?.[0]?.id || null,
      },
    };
  } catch (error) {
    console.error("Error scheduling Telegram message:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
