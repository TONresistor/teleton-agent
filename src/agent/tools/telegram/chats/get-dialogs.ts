/* eslint-disable @typescript-eslint/no-explicit-any */
import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { getClient } from "../../../../sdk/telegram-utils.js";
import { resolveTelegramMessageText } from "../../../../telegram/rich-message.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_get_dialogs tool
 */
interface GetDialogsParams {
  limit?: number | string;
  archived?: boolean | string;
  unreadOnly?: boolean | string;
}

const BooleanLike = Type.Union([Type.Boolean(), Type.Literal("true"), Type.Literal("false")]);
const LimitLike = Type.Union([
  Type.Number({ minimum: 1, maximum: 100 }),
  Type.String({ pattern: "^(?:[1-9]|[1-9][0-9]|100)$" }),
]);

function asBoolean(value: boolean | string | undefined, defaultValue: boolean): boolean {
  return typeof value === "boolean"
    ? value
    : value === "true"
      ? true
      : value === "false"
        ? false
        : defaultValue;
}

function asLimit(value: number | string | undefined): number {
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : 50;
}

/**
 * Tool definition for getting all dialogs (chats/conversations)
 */
export const telegramGetDialogsTool: Tool = {
  name: "telegram_get_dialogs",
  description:
    "Enumerate all conversations (DMs, groups, channels) with unread counts, last message preview, and pinned status. Returns chat IDs needed by other tools. Filter by archived or unreadOnly.",
  category: "data-bearing",
  parameters: Type.Object({
    limit: Type.Optional(LimitLike),
    archived: Type.Optional(BooleanLike),
    unreadOnly: Type.Optional(BooleanLike),
  }),
};

/**
 * Executor for telegram_get_dialogs tool
 */
export const telegramGetDialogsExecutor: ToolExecutor<GetDialogsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const limit = asLimit(params.limit);
    const archived = asBoolean(params.archived, false);
    const unreadOnly = asBoolean(params.unreadOnly, false);

    // Get underlying GramJS client
    const gramJsClient = getClient(context.bridge);

    // Fetch dialogs
    const dialogs = await gramJsClient.getDialogs({
      limit,
      archived,
    });

    // Format dialogs
    let formattedDialogs = await Promise.all(
      dialogs.map(async (dialog: any) => ({
        id: dialog.id?.toString() || null,
        title: dialog.title || "Unknown",
        type: dialog.isChannel ? "channel" : dialog.isGroup ? "group" : "dm",
        unreadCount: dialog.unreadCount || 0,
        unreadMentionsCount: dialog.unreadMentionsCount || 0,
        isPinned: dialog.pinned || false,
        isArchived: dialog.archived || false,
        lastMessageDate: dialog.date || null,
        lastMessage: dialog.message
          ? (await resolveTelegramMessageText(gramJsClient, dialog.message)).substring(0, 100) ||
            null
          : null,
      }))
    );

    // Filter unread only if requested
    if (unreadOnly) {
      formattedDialogs = formattedDialogs.filter((d: any) => d.unreadCount > 0);
    }

    // Calculate summary stats
    const totalUnread = formattedDialogs.reduce((sum: any, d: any) => sum + d.unreadCount, 0);
    const totalMentions = formattedDialogs.reduce(
      (sum: any, d: any) => sum + d.unreadMentionsCount,
      0
    );

    return {
      success: true,
      data: {
        dialogs: formattedDialogs,
        count: formattedDialogs.length,
        totalUnread,
        totalMentions,
        summary: `${formattedDialogs.length} chats, ${totalUnread} unread messages, ${totalMentions} mentions`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error getting Telegram dialogs");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
