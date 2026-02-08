import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Tool definition for getting chat folders
 */
export const telegramGetFoldersTool: Tool = {
  name: "telegram_get_folders",
  description:
    "List all your chat folders (also called 'filters' in Telegram). Folders organize chats into categories like 'Work', 'Personal', 'Groups', etc. Returns folder IDs, names, and included chat types. Use this to see your organization structure before adding chats to folders with telegram_add_chat_to_folder.",
  parameters: Type.Object({}), // No parameters needed
};

/**
 * Executor for telegram_get_folders tool
 */
export const telegramGetFoldersExecutor: ToolExecutor<{}> = async (
  _params,
  context
): Promise<ToolResult> => {
  try {
    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get dialog filters (folders)
    const result = await gramJsClient.invoke(new Api.messages.GetDialogFilters());

    if (!Array.isArray(result)) {
      return {
        success: false,
        error: "Unexpected result type from dialog filters",
      };
    }

    const folders = result
      .filter((filter: any) => filter.className === "DialogFilter")
      .map((filter: any) => ({
        id: filter.id,
        title: filter.title,
        emoji: filter.emoticon || null,
        pinnedPeersCount: filter.pinnedPeers?.length || 0,
        includedPeersCount: filter.includePeers?.length || 0,
        excludedPeersCount: filter.excludePeers?.length || 0,
        includeContacts: filter.contacts || false,
        includeNonContacts: filter.nonContacts || false,
        includeGroups: filter.groups || false,
        includeBroadcasts: filter.broadcasts || false,
        includeBots: filter.bots || false,
        excludeMuted: filter.excludeMuted || false,
        excludeRead: filter.excludeRead || false,
        excludeArchived: filter.excludeArchived || false,
      }));

    return {
      success: true,
      data: {
        folders,
        totalCount: folders.length,
      },
    };
  } catch (error) {
    console.error("Error getting folders:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
