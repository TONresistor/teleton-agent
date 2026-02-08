import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_get_chat_info tool
 */
interface GetChatInfoParams {
  chatId: string;
}

/**
 * Tool definition for getting detailed chat information
 */
export const telegramGetChatInfoTool: Tool = {
  name: "telegram_get_chat_info",
  description:
    "Get detailed information about a Telegram chat, group, or channel. Returns title, description, member count, and other metadata. Use this to understand the context of a conversation.",
  parameters: Type.Object({
    chatId: Type.String({
      description:
        "The chat ID or username to get info about. Examples: '-1001234567890', '@channelname', '123456789'",
    }),
  }),
};

/**
 * Executor for telegram_get_chat_info tool
 */
export const telegramGetChatInfoExecutor: ToolExecutor<GetChatInfoParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId } = params;

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Resolve entity first
    let entity;
    try {
      entity = await gramJsClient.getEntity(chatId);
    } catch (error) {
      return {
        success: false,
        error: `Could not find chat "${chatId}"`,
      };
    }

    // Determine chat type and get full info
    const isChannel = entity.className === "Channel" || entity.className === "ChannelForbidden";
    const isChat = entity.className === "Chat" || entity.className === "ChatForbidden";
    const isUser = entity.className === "User";

    let chatInfo: Record<string, unknown> = {
      id: (entity as any).id?.toString() || chatId,
      type: isChannel ? "channel" : isChat ? "group" : isUser ? "user" : "unknown",
    };

    if (isUser) {
      // User info
      const user = entity as Api.User;
      chatInfo = {
        ...chatInfo,
        username: user.username || null,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        phone: user.phone || null,
        isBot: user.bot || false,
        isPremium: user.premium || false,
        isVerified: user.verified || false,
        fullName: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      };
    } else if (isChannel || isChat) {
      // Get full channel/chat info for groups and channels
      try {
        if (isChannel) {
          const fullChannel = await gramJsClient.invoke(
            new Api.channels.GetFullChannel({
              channel: entity as Api.Channel,
            })
          );

          const channel = entity as Api.Channel;
          const fullChat = fullChannel.fullChat as Api.ChannelFull;

          chatInfo = {
            ...chatInfo,
            title: channel.title || null,
            username: channel.username || null,
            description: fullChat.about || null,
            participantsCount: fullChat.participantsCount || null,
            adminsCount: fullChat.adminsCount || null,
            isBroadcast: channel.broadcast || false,
            isMegagroup: channel.megagroup || false,
            isVerified: channel.verified || false,
            isRestricted: channel.restricted || false,
            hasLink: !!fullChat.linkedChatId,
            linkedChatId: fullChat.linkedChatId?.toString() || null,
          };
        } else {
          // Regular group chat
          const chat = entity as Api.Chat;
          const fullChatResult = await gramJsClient.invoke(
            new Api.messages.GetFullChat({
              chatId: chat.id,
            })
          );

          const fullChat = fullChatResult.fullChat as Api.ChatFull;

          chatInfo = {
            ...chatInfo,
            title: chat.title || null,
            description: fullChat.about || null,
            participantsCount: chat.participantsCount || null,
            isDeactivated: chat.deactivated || false,
          };
        }
      } catch (error) {
        // If we can't get full info, return basic info
        const basicEntity = entity as Api.Channel | Api.Chat;
        chatInfo = {
          ...chatInfo,
          title: (basicEntity as any).title || null,
          username: (basicEntity as any).username || null,
          note: "Could not fetch full chat info (may lack permissions)",
        };
      }
    }

    return {
      success: true,
      data: chatInfo,
    };
  } catch (error) {
    console.error("Error getting chat info:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
