/**
 * casino_jackpot_info - View Teleton Casino daily jackpot status
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import {
  getJackpot,
  shouldAwardDailyJackpot,
  awardJackpot,
} from "../../../casino/jackpot-manager.js";
import { sendPayout } from "../../../casino/payout-sender.js";

/**
 * Tool definition for casino_jackpot_info
 */
export const casinoJackpotInfoTool: Tool = {
  name: "casino_jackpot_info",
  description: `View the current Teleton Casino daily jackpot status.

Returns:
- Current jackpot amount (accumulated from 5% house edge)
- Last winner and award date
- Whether jackpot is ready to be awarded (100+ TON, 24h+ since last award)
- Jackpot creation and update timestamps

The jackpot accumulates 5% of every bet. Once it reaches 100 TON and 24 hours have passed since last award, it can be distributed.`,

  parameters: Type.Object({}),
};

/**
 * Executor for casino_jackpot_info tool
 */
export const casinoJackpotInfoExecutor: ToolExecutor<{}> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const jackpot = getJackpot(context.db);
    const shouldAward = shouldAwardDailyJackpot(context.db);

    const lastWinner = jackpot.lastWinnerId
      ? `User ${jackpot.lastWinnerId} (${new Date(jackpot.lastWonAt! * 1000).toLocaleString()})`
      : "Never awarded";

    return {
      success: true,
      data: {
        current_amount: jackpot.amount.toFixed(2),
        last_winner: lastWinner,
        ready_to_award: shouldAward,
        min_threshold: "100 TON",
        award_frequency: "24 hours",
        created_at: new Date(jackpot.createdAt * 1000).toISOString(),
        updated_at: new Date(jackpot.updatedAt * 1000).toISOString(),
        message: shouldAward
          ? `🎰 Jackpot ready! ${jackpot.amount.toFixed(2)} TON can be awarded now.`
          : `💰 Current jackpot: ${jackpot.amount.toFixed(2)} TON`,
      },
    };
  } catch (error) {
    console.error("Error in casino_jackpot_info:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

interface AwardJackpotParams {
  winner_telegram_id: string;
  winner_wallet: string;
}

/**
 * Tool definition for casino_award_jackpot
 */
export const casinoAwardJackpotTool: Tool = {
  name: "casino_award_jackpot",
  description: `Award the Teleton Casino daily jackpot to a winner.

Process:
1. Checks if jackpot is ready (100+ TON, 24h+ elapsed)
2. Awards entire jackpot amount to winner's wallet
3. Resets jackpot to 0
4. Records winner in jackpot history
5. Logs to journal

Requirements:
- Jackpot must be >= 100 TON
- Must be 24+ hours since last award (or never awarded)

Use this to manually award the jackpot or implement automated daily draws.`,

  parameters: Type.Object({
    winner_telegram_id: Type.String({
      description: "Winner's Telegram user ID",
    }),
    winner_wallet: Type.String({
      description: "Winner's TON wallet address for payout",
    }),
  }),
};

/**
 * Executor for casino_award_jackpot tool
 */
export const casinoAwardJackpotExecutor: ToolExecutor<AwardJackpotParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { winner_telegram_id, winner_wallet } = params;

    // Check if jackpot is ready to award
    if (!shouldAwardDailyJackpot(context.db)) {
      const jackpot = getJackpot(context.db);
      return {
        success: false,
        error: `Jackpot not ready yet. Current: ${jackpot.amount.toFixed(2)} TON (minimum: 100 TON, 24h since last award required)`,
      };
    }

    // Award jackpot in DB
    const { amount, winnerId } = awardJackpot(context.db, winner_telegram_id);

    if (amount === 0) {
      return {
        success: false,
        error: "Jackpot amount is 0 TON, nothing to award.",
      };
    }

    // Send payout to winner
    const payoutResult = await sendPayout(
      winner_wallet,
      amount,
      `🎰🎰🎰 TELETON CASINO DAILY JACKPOT! You won ${amount.toFixed(2)} TON! 🎰🎰🎰`
    );

    if (!payoutResult.success) {
      // Rollback jackpot award if payout failed
      context.db
        .prepare(
          "UPDATE casino_jackpot SET amount = ?, last_winner_id = NULL, last_won_at = NULL WHERE id = 1"
        )
        .run(amount);

      return {
        success: false,
        error: `Failed to send payout: ${payoutResult.error}`,
      };
    }

    // Log to journal
    context.db
      .prepare(
        `INSERT INTO journal (
          type, action, asset_from, asset_to, amount_from, amount_to,
          platform, reasoning, outcome, pnl_ton, tx_hash, tool_used,
          chat_id, user_id, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
      )
      .run(
        "trade",
        "casino_jackpot_award",
        "JACKPOT",
        "TON",
        amount,
        amount,
        "telegram_casino",
        `Daily jackpot awarded to ${winner_telegram_id}`,
        "loss", // Casino lost (paid out jackpot)
        -amount,
        payoutResult.txHash,
        "casino_award_jackpot",
        null, // No specific chat
        winner_telegram_id
      );

    return {
      success: true,
      data: {
        amount: amount.toFixed(2),
        winner_id: winnerId,
        winner_wallet,
        payout_tx: payoutResult.txHash,
        message: `🎰 Jackpot awarded! ${amount.toFixed(2)} TON sent to ${winner_wallet}`,
      },
    };
  } catch (error) {
    console.error("Error in casino_award_jackpot:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
