/**
 * casino_my_stats - Show player's personal Teleton Casino statistics
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";

/**
 * Tool definition for casino_my_stats
 */
export const casinoMyStatsTool: Tool = {
  name: "casino_my_stats",
  description: `Show the current player's personal Teleton Casino statistics.

Returns:
- Total bets placed
- Total wins / losses
- Total amount wagered
- Total amount won
- Net profit/loss
- Win rate percentage
- Last bet timestamp`,

  parameters: Type.Object({}),
};

/**
 * Executor for casino_my_stats tool
 */
export const casinoMyStatsExecutor: ToolExecutor<{}> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const userId = context.senderId.toString();

    // Get player stats from casino_users table
    const playerStats = context.db
      .prepare(
        `SELECT
           telegram_id,
           wallet_address,
           total_bets,
           total_wins,
           total_losses,
           total_wagered,
           total_won,
           created_at,
           last_bet_at
         FROM casino_users
         WHERE telegram_id = ?`
      )
      .get(userId) as
      | {
          telegram_id: string;
          wallet_address: string | null;
          total_bets: number;
          total_wins: number;
          total_losses: number;
          total_wagered: number;
          total_won: number;
          created_at: number;
          last_bet_at: number | null;
        }
      | undefined;

    if (!playerStats) {
      return {
        success: true,
        data: {
          has_played: false,
          message:
            "🎰 You haven't played at Teleton Casino yet! Make your first spin to get started.",
        },
      };
    }

    // Calculate net profit/loss
    const netPnL = playerStats.total_won - playerStats.total_wagered;
    const winRate =
      playerStats.total_bets > 0
        ? ((playerStats.total_wins / playerStats.total_bets) * 100).toFixed(1)
        : "0";

    // Format dates
    const firstPlayDate = new Date(playerStats.created_at * 1000).toLocaleDateString();
    const lastPlayDate = playerStats.last_bet_at
      ? new Date(playerStats.last_bet_at * 1000).toLocaleDateString()
      : "Never";

    // Determine player status emoji
    let statusEmoji = "🎮";
    if (netPnL > 10) statusEmoji = "🤑";
    else if (netPnL > 0) statusEmoji = "😊";
    else if (netPnL < -10) statusEmoji = "😢";
    else if (netPnL < 0) statusEmoji = "😐";

    return {
      success: true,
      data: {
        has_played: true,
        telegram_id: playerStats.telegram_id,
        wallet_address: playerStats.wallet_address,
        total_bets: playerStats.total_bets,
        total_wins: playerStats.total_wins,
        total_losses: playerStats.total_losses,
        total_wagered: playerStats.total_wagered.toFixed(2),
        total_won: playerStats.total_won.toFixed(2),
        net_pnl: netPnL.toFixed(2),
        net_pnl_positive: netPnL >= 0,
        win_rate: winRate,
        first_play: firstPlayDate,
        last_play: lastPlayDate,
        status_emoji: statusEmoji,
        message: `${statusEmoji} Teleton Casino Stats:
🎲 Total bets: ${playerStats.total_bets}
✅ Wins: ${playerStats.total_wins} | ❌ Losses: ${playerStats.total_losses}
📊 Win rate: ${winRate}%
💰 Wagered: ${playerStats.total_wagered.toFixed(2)} TON
🏆 Won: ${playerStats.total_won.toFixed(2)} TON
${netPnL >= 0 ? "📈" : "📉"} Net P&L: ${netPnL >= 0 ? "+" : ""}${netPnL.toFixed(2)} TON`,
      },
    };
  } catch (error) {
    console.error("Error in casino_my_stats:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
