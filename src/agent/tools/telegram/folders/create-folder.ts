import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");

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
    "Create a new chat folder. Can auto-include chat types or add specific chats later with telegram_add_chat_to_folder.",
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
    const dialogFilters = (await gramJsClient.invoke(
      new Api.messages.GetDialogFilters()
    )) as Api.messages.DialogFilters;
    const filters = dialogFilters.filters ?? [];
    // Only consider DialogFilter and DialogFilterChatlist (skip DialogFilterDefault which has no id)
    const usedIds = filters
      .filter((f): f is Api.DialogFilter => "id" in f && typeof f.id === "number")
      .map((f) => f.id);
    // Telegram reserves IDs 0-1; valid custom folder IDs start at 2
    const newId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 2;

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
    log.error({ err: error }, "Error creating folder");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
