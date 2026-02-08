import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import type { Deal } from "../../../deals/types.js";
import { formatAsset } from "../../../deals/utils.js";

interface DealListParams {
  status?: string;
  userId?: number;
  limit?: number;
}

export const dealListTool: Tool = {
  name: "deal_list",
  description: `List recent deals with optional filters.

Filters:
- status: Filter by status (proposed, accepted, verified, completed, declined, expired, cancelled, failed)
- userId: Filter by user's Telegram ID
- limit: Max results (default 20)

Returns summary of each deal with ID, status, parties, trade details, timestamps.`,
  parameters: Type.Object({
    status: Type.Optional(
      Type.String({
        description:
          "Filter by status: proposed, accepted, verified, completed, declined, expired, cancelled, failed",
      })
    ),
    userId: Type.Optional(Type.Number({ description: "Filter by user's Telegram ID" })),
    limit: Type.Optional(
      Type.Number({ description: "Max results to return (default 20)", minimum: 1, maximum: 100 })
    ),
  }),
};

export const dealListExecutor: ToolExecutor<DealListParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { status, userId, limit = 20 } = params;

    // Build query
    let query = `SELECT * FROM deals WHERE 1=1`;
    const queryParams: any[] = [];

    if (status) {
      query += ` AND status = ?`;
      queryParams.push(status);
    }

    if (userId) {
      query += ` AND user_telegram_id = ?`;
      queryParams.push(userId);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    queryParams.push(limit);

    // Execute query
    const deals = context.db.prepare(query).all(...queryParams) as Deal[];

    if (deals.length === 0) {
      return {
        success: true,
        data: {
          count: 0,
          deals: [],
          message: "No deals found matching the criteria.",
        },
      };
    }

    // Format deals
    const formattedDeals = deals.map((deal) => {
      const userGives = formatAsset(
        deal.user_gives_type,
        deal.user_gives_ton_amount,
        deal.user_gives_gift_slug
      );
      const agentGives = formatAsset(
        deal.agent_gives_type,
        deal.agent_gives_ton_amount,
        deal.agent_gives_gift_slug
      );

      let statusEmoji = "⏳";
      if (deal.status === "completed") statusEmoji = "✅";
      else if (deal.status === "verified") statusEmoji = "🔄";
      else if (deal.status === "accepted") statusEmoji = "👍";
      else if (deal.status === "declined") statusEmoji = "❌";
      else if (deal.status === "expired") statusEmoji = "⏰";
      else if (deal.status === "failed") statusEmoji = "💥";
      else if (deal.status === "cancelled") statusEmoji = "🚫";

      return {
        id: deal.id,
        status: deal.status,
        statusEmoji,
        userGives,
        agentGives,
        profit: deal.profit_ton,
        userTelegramId: deal.user_telegram_id,
        userUsername: deal.user_username,
        createdAt: new Date(deal.created_at * 1000).toISOString(),
        expiresAt: new Date(deal.expires_at * 1000).toISOString(),
        completedAt: deal.completed_at ? new Date(deal.completed_at * 1000).toISOString() : null,
        summary: `${statusEmoji} #${deal.id} - ${deal.status} - User gives: ${userGives}, Agent gives: ${agentGives}, Profit: ${deal.profit_ton?.toFixed(2) || 0} TON`,
      };
    });

    // Calculate totals
    const totalProfit = deals
      .filter((d) => d.status === "completed")
      .reduce((sum, d) => sum + (d.profit_ton || 0), 0);

    const statusCounts = deals.reduce(
      (acc, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      success: true,
      data: {
        count: deals.length,
        deals: formattedDeals,
        stats: {
          totalProfit,
          statusCounts,
        },
        filters: {
          status: status || "all",
          userId: userId || "all",
          limit,
        },
      },
    };
  } catch (error) {
    console.error("Error listing deals:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
