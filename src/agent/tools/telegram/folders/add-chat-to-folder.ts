import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

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
    "Add a specific chat to an existing folder. The chat will appear in that folder's view for easy access. Use telegram_get_folders first to see available folder IDs. This helps organize important or related conversations together. Example: Add a project group to your 'Work' folder.",
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
    const filtersResult = await gramJsClient.invoke(new Api.messages.GetDialogFilters());
    const filterList: any[] = Array.isArray(filtersResult)
      ? filtersResult
      : ((filtersResult as any).filters ?? []);

    // Find the target folder
    const folder = filterList.find((f: any) => f.id === folderId);

    if (!folder || folder.className !== "DialogFilter") {
      return {
        success: false,
        error: `Folder with ID ${folderId} not found`,
      };
    }

    // Get chat entity
    const chatEntity = await gramJsClient.getEntity(chatId);

    // Add chat to folder's includePeers
    const updatedIncludePeers = [...(folder.includePeers || [])];
    updatedIncludePeers.push(chatEntity);

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
    console.error("Error adding chat to folder:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
