import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import bigInt from "big-integer";

/**
 * Parameters for telegram_get_replies tool
 */
interface GetRepliesParams {
  chatId: string;
  messageId: number;
  limit?: number;
}

/**
 * Tool definition for getting message replies/thread
 */
export const telegramGetRepliesTool: Tool = {
  name: "telegram_get_replies",
  description:
    "Get all replies to a specific message (reply thread/chain). Useful for reading conversation threads, forum discussions, or comment sections under channel posts. Returns messages sorted from oldest to newest.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the message is located",
    }),
    messageId: Type.Number({
      description: "The message ID to get replies for (the parent message)",
    }),
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of replies to fetch (default: 50, max: 100)",
        minimum: 1,
        maximum: 100,
      })
    ),
  }),
};

/**
 * Executor for telegram_get_replies tool
 */
export const telegramGetRepliesExecutor: ToolExecutor<GetRepliesParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, messageId, limit = 50 } = params;

    // Get the underlying GramJS client
    const client = context.bridge.getClient().getClient();

    // Resolve the peer (chat entity)
    const peer = await client.getInputEntity(chatId);

    // Get replies using raw API
    const result = await client.invoke(
      new Api.messages.GetReplies({
        peer: peer,
        msgId: messageId,
        offsetId: 0,
        offsetDate: 0,
        addOffset: 0,
        limit: limit,
        maxId: 0,
        minId: 0,
        hash: bigInt(0),
      })
    );

    // Extract messages from result
    const messages: Array<{
      id: number;
      text: string;
      senderId: string;
      senderName?: string;
      date: string;
      replyToId?: number;
    }> = [];

    // Build user map for sender names
    const userMap = new Map<string, string>();
    if ("users" in result) {
      for (const user of result.users) {
        if (user instanceof Api.User) {
          const name = user.firstName
            ? `${user.firstName}${user.lastName ? " " + user.lastName : ""}`
            : user.username || `User ${user.id}`;
          userMap.set(user.id.toString(), name);
        }
      }
    }

    // Process messages
    if ("messages" in result) {
      for (const msg of result.messages) {
        if (msg instanceof Api.Message) {
          const senderId = msg.fromId
            ? "userId" in msg.fromId
              ? msg.fromId.userId.toString()
              : "channelId" in msg.fromId
                ? msg.fromId.channelId.toString()
                : undefined
            : undefined;

          messages.push({
            id: msg.id,
            text: msg.message || "",
            senderId: senderId || "unknown",
            senderName: senderId ? userMap.get(senderId) : undefined,
            date: new Date(msg.date * 1000).toISOString(),
            replyToId: msg.replyTo?.replyToMsgId,
          });
        }
      }
    }

    // Sort by date (oldest first for thread reading)
    messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Get total count if available
    const totalCount = "count" in result ? result.count : messages.length;

    // Build summary
    let summary = `Found ${messages.length} replies`;
    if (totalCount > messages.length) {
      summary += ` (${totalCount} total)`;
    }
    summary += ` to message #${messageId}:\n\n`;

    for (const msg of messages.slice(0, 10)) {
      const sender = msg.senderName || msg.senderId;
      const preview = msg.text.length > 100 ? msg.text.slice(0, 100) + "..." : msg.text;
      summary += `[${sender}]: ${preview}\n`;
    }

    if (messages.length > 10) {
      summary += `\n... and ${messages.length - 10} more replies`;
    }

    return {
      success: true,
      data: {
        parentMessageId: messageId,
        totalReplies: totalCount,
        fetchedReplies: messages.length,
        replies: messages,
        message: summary,
      },
    };
  } catch (error) {
    console.error("Error getting replies:", error);

    // Handle specific errors
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes("MSG_ID_INVALID")) {
      return {
        success: false,
        error: `Message #${params.messageId} not found or has no replies`,
      };
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
};
