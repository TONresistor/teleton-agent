/**
 * casino_balance - Check Teleton Casino bankroll and betting limits
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getWalletAddress, getWalletBalance } from "../../../ton/wallet-service.js";
import { CASINO_CONFIG } from "../../../casino/config.js";

/**
 * Tool definition for casino_balance
 */
export const casinoBalanceTool: Tool = {
  name: "casino_balance",
  description: `Check Teleton Casino bankroll status and betting limits.

Returns:
- Casino wallet address (where players send bets)
- Current balance
- Maximum allowed bet (5% of bankroll)
- Status (ok/warning/critical)
- Whether the casino can accept bets
- Minimum bet (0.1 TON)

Teleton Casino needs sufficient balance to cover potential payouts (up to 5x the bet).

IMPORTANT: When a player wants to bet, tell them to send TON to Teleton Casino address with their username as memo.
Example: "Send 2 TON to EQxxx with memo: john_doe"`,

  parameters: Type.Object({}),
};

/**
 * Executor for casino_balance tool
 */
export const casinoBalanceExecutor: ToolExecutor<{}> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const address = getWalletAddress();

    if (!address) {
      return {
        success: false,
        error: "Casino wallet not initialized. Contact admin.",
      };
    }

    const balanceInfo = await getWalletBalance(address);

    if (!balanceInfo) {
      return {
        success: false,
        error: "Failed to fetch balance from TON blockchain.",
      };
    }

    const balance = parseFloat(balanceInfo.balance);

    // Determine status
    let status: "ok" | "warning" | "critical";
    let message: string;
    let canAcceptBets: boolean;

    if (balance < CASINO_CONFIG.minBankroll * 0.5) {
      status = "critical";
      message = `🚨 CRITICAL: Bankroll is critically low (${balance.toFixed(2)} TON). Casino operations should be suspended.`;
      canAcceptBets = false;
    } else if (balance < CASINO_CONFIG.minBankroll) {
      status = "warning";
      message = `⚠️ WARNING: Bankroll is below minimum threshold (${balance.toFixed(2)} TON). Refill recommended.`;
      canAcceptBets = true;
    } else {
      status = "ok";
      message = `✅ Casino bankroll is healthy (${balance.toFixed(2)} TON)`;
      canAcceptBets = true;
    }

    // Calculate maximum bet
    // Max bet is limited by two factors:
    // 1. 5% of total bankroll
    // 2. Must be able to cover maximum payout (5x the bet)
    const jackpotMultiplier = CASINO_CONFIG.slot.jackpot.multiplier;
    const maxBetByPercent = balance * (CASINO_CONFIG.maxBetPercent / 100);
    const maxBetByCoverage = balance / jackpotMultiplier;
    const maxBet = Math.min(maxBetByPercent, maxBetByCoverage);

    return {
      success: true,
      data: {
        address,
        balance: balance.toFixed(2),
        balanceNano: balanceInfo.balanceNano,
        status,
        canAcceptBets,
        minBet: String(CASINO_CONFIG.minBet),
        maxBet: maxBet.toFixed(2),
        minBankroll: CASINO_CONFIG.minBankroll,
        maxBetPercent: CASINO_CONFIG.maxBetPercent,
        jackpotMultiplier,
        memoFormat: "{username}",
        message,
      },
    };
  } catch (error) {
    console.error("Error in casino_balance:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
