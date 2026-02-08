import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";

/**
 * Parameters for telegram_get_participants tool
 */
interface GetParticipantsParams {
  chatId: string;
  filter?: "all" | "admins" | "banned" | "bots";
  limit?: number;
}

/**
 * Tool definition for getting channel/group participants
 */
export const telegramGetParticipantsTool: Tool = {
  name: "telegram_get_participants",
  description:
    "Get list of participants (members) in a Telegram group or channel. Use this to see who's in a chat, identify admins, check banned users, or find bots. Useful for moderation, member management, and group analytics.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat/channel/group ID to get participants from",
    }),
    filter: Type.Optional(
      Type.String({
        description: "Filter participants by type: 'all' (default), 'admins', 'banned', or 'bots'",
        enum: ["all", "admins", "banned", "bots"],
      })
    ),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of participants to return (default: 100, max: 200)",
        minimum: 1,
        maximum: 200,
      })
    ),
  }),
};

/**
 * Executor for telegram_get_participants tool
 */
export const telegramGetParticipantsExecutor: ToolExecutor<GetParticipantsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, filter = "all", limit = 100 } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Get chat entity
    const entity = await gramJsClient.getEntity(chatId);

    // Determine filter
    let participantFilter;
    switch (filter) {
      case "admins":
        participantFilter = new Api.ChannelParticipantsAdmins();
        break;
      case "banned":
        participantFilter = new Api.ChannelParticipantsBanned({ q: "" });
        break;
      case "bots":
        participantFilter = new Api.ChannelParticipantsBots();
        break;
      case "all":
      default:
        participantFilter = new Api.ChannelParticipantsRecent();
        break;
    }

    // Get participants using GramJS
    const result = await gramJsClient.invoke(
      new Api.channels.GetParticipants({
        channel: entity,
        filter: participantFilter,
        offset: 0,
        limit,
        hash: 0 as any,
      })
    );

    // Parse participants
    const resultData = result as any;
    const participants = resultData.participants.map((p: any) => {
      const user = resultData.users.find((u: any) => u.id?.toString() === p.userId?.toString());

      return {
        userId: p.userId?.toString(),
        username: user?.username || null,
        firstName: user?.firstName || null,
        lastName: user?.lastName || null,
        isBot: user?.bot || false,
        isAdmin:
          p.className === "ChannelParticipantAdmin" || p.className === "ChannelParticipantCreator",
        isBanned: p.className === "ChannelParticipantBanned",
        role: p.className?.replace("ChannelParticipant", "").toLowerCase() || "member",
      };
    });

    return {
      success: true,
      data: {
        chatId,
        filter,
        count: participants.length,
        totalCount: resultData.count || participants.length,
        participants,
      },
    };
  } catch (error) {
    console.error("Error getting Telegram participants:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
