import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_create_folder tool
 */
interface CreateFolderParams {
  title: string;
  emoji?: string;
  includeContacts?: boolean;
  includeNonContacts?: boolean;
  includeGroups?: boolean;
  includeBroadcasts?: boolean;
  includeBots?: boolean;
}

/**
 * Tool definition for creating chat folders
 */
export const telegramCreateFolderTool: Tool = {
  name: "telegram_create_folder",
  description:
    "Create a new chat folder to organize your conversations. Folders can auto-include chat types (contacts, groups, bots, etc.) or specific chats added later with telegram_add_chat_to_folder. Use this to categorize chats by topic, importance, or type. Examples: 'Work', 'Family', 'Projects', 'Crypto'.",
  parameters: Type.Object({
    title: Type.String({
      description: "Name of the folder (e.g., 'Work', 'Family', 'Projects'). Max 12 characters.",
      maxLength: 12,
    }),
    emoji: Type.Optional(
      Type.String({
        description:
          "Optional emoji icon for the folder (e.g., '💼', '👨\u200d👩\u200d👧', '🚀'). Single emoji.",
      })
    ),
    includeContacts: Type.Optional(
      Type.Boolean({
        description: "Auto-include all chats with contacts. Default: false.",
      })
    ),
    includeNonContacts: Type.Optional(
      Type.Boolean({
        description: "Auto-include all chats with non-contacts. Default: false.",
      })
    ),
    includeGroups: Type.Optional(
      Type.Boolean({
        description: "Auto-include all group chats. Default: false.",
      })
    ),
    includeBroadcasts: Type.Optional(
      Type.Boolean({
        description: "Auto-include all channels/broadcasts. Default: false.",
      })
    ),
    includeBots: Type.Optional(
      Type.Boolean({
        description: "Auto-include all bot chats. Default: false.",
      })
    ),
  }),
};

/**
 * Executor for telegram_create_folder tool
 */
export const telegramCreateFolderExecutor: ToolExecutor<CreateFolderParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const {
      title,
      emoji,
      includeContacts = false,
      includeNonContacts = false,
      includeGroups = false,
      includeBroadcasts = false,
      includeBots = false,
    } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get existing filters to determine next ID
    // GetDialogFilters returns messages.DialogFilters { filters: [] } (not a plain array)
    const result = await gramJsClient.invoke(new Api.messages.GetDialogFilters());
    const filters: any[] = Array.isArray(result) ? result : ((result as any).filters ?? []);
    const maxId = Math.max(0, ...filters.map((f: any) => f.id || 0));
    const newId = maxId + 1;

    // Create new folder (using any to bypass strict type checking)
    const filterData: any = {
      id: newId,
      title: new Api.TextWithEntities({ text: title, entities: [] }),
      pinnedPeers: [],
      includePeers: [],
      excludePeers: [],
      contacts: includeContacts,
      nonContacts: includeNonContacts,
      groups: includeGroups,
      broadcasts: includeBroadcasts,
      bots: includeBots,
      excludeMuted: false,
      excludeRead: false,
      excludeArchived: false,
    };
    if (emoji) filterData.emoticon = emoji;

    const filter = new Api.DialogFilter(filterData);

    await gramJsClient.invoke(
      new Api.messages.UpdateDialogFilter({
        id: newId,
        filter,
      })
    );

    return {
      success: true,
      data: {
        folderId: newId,
        title,
        emoji,
      },
    };
  } catch (error) {
    console.error("Error creating folder:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
