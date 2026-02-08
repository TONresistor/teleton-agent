import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_get_dialogs tool
 */
interface GetDialogsParams {
  limit?: number;
  archived?: boolean;
  unreadOnly?: boolean;
}

/**
 * Tool definition for getting all dialogs (chats/conversations)
 */
export const telegramGetDialogsTool: Tool = {
  name: "telegram_get_dialogs",
  description:
    "Get the list of all your Telegram conversations (DMs, groups, channels). Returns chat info with unread message counts. Use this to see your inbox and find chats that need attention.",
  parameters: Type.Object({
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of dialogs to retrieve (default: 50, max: 100)",
        minimum: 1,
        maximum: 100,
      })
    ),
    archived: Type.Optional(
      Type.Boolean({
        description:
          "If true, get archived chats. If false, get active chats. Default: false (active chats)",
      })
    ),
    unreadOnly: Type.Optional(
      Type.Boolean({
        description: "If true, only return dialogs with unread messages. Default: false",
      })
    ),
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
    const { limit = 50, archived = false, unreadOnly = false } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Fetch dialogs
    const dialogs = await gramJsClient.getDialogs({
      limit,
      archived,
    });

    // Format dialogs
    let formattedDialogs = dialogs.map((dialog) => ({
      id: dialog.id?.toString() || null,
      title: dialog.title || "Unknown",
      type: dialog.isChannel ? "channel" : dialog.isGroup ? "group" : "dm",
      unreadCount: dialog.unreadCount || 0,
      unreadMentionsCount: dialog.unreadMentionsCount || 0,
      isPinned: dialog.pinned || false,
      isArchived: dialog.archived || false,
      lastMessageDate: dialog.date || null,
      lastMessage: dialog.message?.message?.substring(0, 100) || null,
    }));

    // Filter unread only if requested
    if (unreadOnly) {
      formattedDialogs = formattedDialogs.filter((d) => d.unreadCount > 0);
    }

    // Calculate summary stats
    const totalUnread = formattedDialogs.reduce((sum, d) => sum + d.unreadCount, 0);
    const totalMentions = formattedDialogs.reduce((sum, d) => sum + d.unreadMentionsCount, 0);

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
    console.error("Error getting Telegram dialogs:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
