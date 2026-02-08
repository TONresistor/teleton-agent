/**
 * telegram_create_group - Create a new group chat
 */

import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

interface CreateGroupParams {
  title: string;
  users: string[];
}

export const telegramCreateGroupTool: Tool = {
  name: "telegram_create_group",
  description: `Create a new group chat with specified users. You will be the admin of the created group.`,
  parameters: Type.Object({
    title: Type.String({
      description: "Name/title of the group",
    }),
    users: Type.Array(Type.String(), {
      description: "List of user IDs or usernames to add to the group",
      minItems: 1,
    }),
  }),
};

export const telegramCreateGroupExecutor: ToolExecutor<CreateGroupParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { title, users } = params;

    const client = context.bridge.getClient().getClient();

    // Resolve user entities
    const userEntities: Api.TypeInputUser[] = [];
    for (const user of users) {
      try {
        const entity = await client.getInputEntity(user);
        if (entity instanceof Api.InputPeerUser) {
          userEntities.push(
            new Api.InputUser({
              userId: entity.userId,
              accessHash: entity.accessHash,
            })
          );
        }
      } catch (e) {
        console.warn(`Could not resolve user ${user}:`, e);
      }
    }

    if (userEntities.length === 0) {
      return {
        success: false,
        error: "Could not resolve any of the specified users",
      };
    }

    const result = await client.invoke(
      new Api.messages.CreateChat({
        title,
        users: userEntities,
      })
    );

    // Extract chat info from result (InvitedUsers contains updates)
    let chatId: string | undefined;
    let chatTitle: string | undefined;

    // Result is InvitedUsers which has updates property
    const updates = (result as any).updates;
    if (updates && updates.chats) {
      for (const chat of updates.chats) {
        if (chat instanceof Api.Chat) {
          chatId = chat.id.toString();
          chatTitle = chat.title;
          break;
        }
      }
    }

    return {
      success: true,
      data: {
        chat_id: chatId,
        title: chatTitle ?? title,
        members_added: userEntities.length,
        message: `👥 Group "${title}" created with ${userEntities.length} members`,
      },
    };
  } catch (error) {
    console.error("Error in telegram_create_group:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
