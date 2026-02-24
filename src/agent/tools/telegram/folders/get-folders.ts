import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Tool definition for getting chat folders
 */
export const telegramGetFoldersTool: Tool = {
  name: "telegram_get_folders",
  description: "List all your chat folders with IDs, names, and included chat types.",
  category: "data-bearing",
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
    // GetDialogFilters returns messages.DialogFilters { filters: [] } (not a plain array)
    const dialogFilters = (await gramJsClient.invoke(
      new Api.messages.GetDialogFilters()
    )) as Api.messages.DialogFilters;
    const filterList = dialogFilters.filters ?? [];

    const folders = filterList
      .filter((filter): filter is Api.DialogFilter => filter.className === "DialogFilter")
      .map((filter) => ({
        id: filter.id,
        title: (filter.title as any)?.text ?? filter.title,
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
    log.error({ err: error }, "Error getting folders");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
