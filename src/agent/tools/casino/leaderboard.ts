/**
 * casino_leaderboard - Show top Teleton Casino players and stats
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";

interface LeaderboardParams {
  limit?: number;
  type?: "winners" | "losers" | "wagered";
}

/**
 * Tool definition for casino_leaderboard
 */
export const casinoLeaderboardTool: Tool = {
  name: "casino_leaderboard",
  description: `Show Teleton Casino leaderboard with top players.

Types:
- winners: Players who won the most TON
- losers: Players who lost the most TON
- wagered: Players who wagered the most TON

Shows:
- Total bets placed
- Total amount wagered
- Total wins/losses
- Win rate percentage`,

  parameters: Type.Object({
    limit: Type.Optional(
      Type.Number({
        description: "Number of players to show (default: 10)",
        minimum: 1,
        maximum: 50,
      })
    ),
    type: Type.Optional(
      Type.String({
        description: "Leaderboard type: winners, losers, or wagered",
        enum: ["winners", "losers", "wagered"],
      })
    ),
  }),
};

/**
 * Executor for casino_leaderboard tool
 */
export const casinoLeaderboardExecutor: ToolExecutor<LeaderboardParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { limit = 10, type = "winners" } = params;

    // Whitelist ORDER BY clause to prevent SQL injection
    const ORDER_BY: Record<string, string> = {
      winners: "total_pnl DESC",
      losers: "total_pnl ASC",
      wagered: "cu.total_wagered DESC",
    };
    const orderBy = ORDER_BY[type] ?? ORDER_BY.winners;

    // Query casino users and their stats from journal
    const query = `
      SELECT
        cu.telegram_id,
        cu.wallet_address,
        cu.total_bets,
        cu.total_wagered,
        cu.total_wins,
        cu.total_losses,
        COALESCE(SUM(CASE WHEN j.outcome = 'loss' THEN j.pnl_ton ELSE 0 END), 0) as total_pnl,
        ROUND(CAST(cu.total_wins AS REAL) / NULLIF(cu.total_bets, 0) * 100, 2) as win_rate
      FROM casino_users cu
      LEFT JOIN journal j ON j.user_id = cu.telegram_id AND j.type = 'trade' AND j.action = 'casino_spin'
      WHERE cu.total_bets > 0
      GROUP BY cu.telegram_id
      ORDER BY ${orderBy}
      LIMIT ?
    `;

    const leaderboard = context.db.prepare(query).all(limit) as Array<{
      telegram_id: string;
      wallet_address: string | null;
      total_bets: number;
      total_wagered: number;
      total_wins: number;
      total_losses: number;
      total_pnl: number;
      win_rate: number;
    }>;

    if (leaderboard.length === 0) {
      return {
        success: true,
        data: {
          type,
          players: [],
          message: "No casino players yet. Be the first to spin!",
        },
      };
    }

    // Get user info from Telegram
    const playersWithInfo = await Promise.all(
      leaderboard.map(async (player, index) => {
        let username = "Unknown";
        try {
          const userId = parseInt(player.telegram_id);
          if (!isNaN(userId)) {
            const userInfo = await context.bridge
              .getClient()
              .getClient()
              .invoke(
                new (await import("telegram")).Api.users.GetUsers({
                  id: [userId],
                })
              );
            if (userInfo.length > 0) {
              const user = userInfo[0];
              if ("username" in user && user.username) {
                username = `@${user.username}`;
              } else if ("firstName" in user) {
                username = user.firstName || "Unknown";
              }
            }
          }
        } catch (e) {
          // Ignore errors, keep "Unknown"
        }

        return {
          rank: index + 1,
          telegram_id: player.telegram_id,
          username,
          wallet_address: player.wallet_address,
          total_bets: player.total_bets,
          total_wagered: player.total_wagered.toFixed(2),
          total_wins: player.total_wins,
          total_losses: player.total_losses,
          total_pnl: player.total_pnl.toFixed(2),
          win_rate: player.win_rate || 0,
        };
      })
    );

    // Format message
    const title =
      type === "winners"
        ? "🏆 Teleton Casino - Top Winners"
        : type === "losers"
          ? "📉 Teleton Casino - Biggest Losers"
          : "💰 Teleton Casino - Top Wagerers";

    const formattedPlayers = playersWithInfo
      .map(
        (p) =>
          `${p.rank}. ${p.username}\n   💵 P&L: ${p.total_pnl} TON | 🎲 Bets: ${p.total_bets} | 📊 Win rate: ${p.win_rate}%`
      )
      .join("\n\n");

    return {
      success: true,
      data: {
        type,
        players: playersWithInfo,
        message: `${title}\n\n${formattedPlayers}`,
      },
    };
  } catch (error) {
    console.error("Error in casino_leaderboard:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
