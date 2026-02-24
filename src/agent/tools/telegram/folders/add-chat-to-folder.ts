import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_add_chat_to_folder tool
 */
interface AddChatToFolderParams {
  folderId: number;
  chatId: string;
}

/**
 * Tool definition for adding chat to folder
 */
export const telegramAddChatToFolderTool: Tool = {
  name: "telegram_add_chat_to_folder",
  description:
    "Add a chat to an existing folder. Use telegram_get_folders first to get folder IDs.",
  parameters: Type.Object({
    folderId: Type.Number({
      description:
        "ID of the folder to add the chat to (obtainable from telegram_get_folders). Must be an existing folder.",
    }),
    chatId: Type.String({
      description: "The chat ID to add to the folder",
    }),
  }),
};

/**
 * Executor for telegram_add_chat_to_folder tool
 */
export const telegramAddChatToFolderExecutor: ToolExecutor<AddChatToFolderParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { folderId, chatId } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get existing filters
    // GetDialogFilters returns messages.DialogFilters { filters: [] } (not a plain array)
    const filtersResult = (await gramJsClient.invoke(
      new Api.messages.GetDialogFilters()
    )) as Api.messages.DialogFilters;
    const filterList = filtersResult.filters ?? [];

    // Find the target folder
    const folder = filterList.find((f) => "id" in f && f.id === folderId);

    if (!folder || folder.className !== "DialogFilter") {
      return {
        success: false,
        error: `Folder with ID ${folderId} not found`,
      };
    }

    // Get chat entity
    const chatEntity = await gramJsClient.getEntity(chatId);

    // Add chat to folder's includePeers
    const inputPeer = await gramJsClient.getInputEntity(chatId);
    const updatedIncludePeers = [...(folder.includePeers || [])];
    updatedIncludePeers.push(inputPeer);

    // Update folder
    const updatedFilter = new Api.DialogFilter({
      ...folder,
      includePeers: updatedIncludePeers,
    });

    await gramJsClient.invoke(
      new Api.messages.UpdateDialogFilter({
        id: folderId,
        filter: updatedFilter,
      })
    );

    return {
      success: true,
      data: {
        folderId,
        folderTitle: folder.title?.text ?? folder.title,
        chatId,
        totalChatsInFolder: updatedIncludePeers.length,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error adding chat to folder");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
