/**
 * casino_spin - Teleton Casino slot machine spin
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { executeGame, type GameParams } from "../../../casino/game-engine.js";
import { CASINO_CONFIG, getSlotMultiplier, getSlotInterpretation } from "../../../casino/config.js";

export const casinoSpinTool: Tool = {
  name: "casino_spin",
  description: `Execute a Teleton Casino slot machine spin with full security checks.

Slot payout table (40% house edge):
- 🎰 64 (777) = JACKPOT (5x bet)
- 🎰 60-63 = Big win (2.5x bet)
- 🎰 55-59 = Medium win (1.8x bet)
- 🎰 43-54 = Small win (1.2x bet)
- 🎰 1-42 = No win

Process:
1. Validates bet amount (min 0.1 TON, max 5% of bankroll)
2. Checks user cooldown (30 seconds between spins)
3. Verifies TON payment with username as memo
4. Auto-discovers player wallet from transaction
5. Sends 🎰 slot machine animation
6. Processes house edge (5%) to daily jackpot
7. AUTO-PAYOUT if player wins

Tell the user: "Send X TON to [casino_address] with memo: your_username"`,

  parameters: Type.Object({
    chat_id: Type.String({
      description: "Telegram chat ID where to send the spin",
    }),
    bet_amount: Type.Number({
      description: "Bet amount in TON",
      minimum: 0.1,
    }),
    player_username: Type.String({
      description: "Player's Telegram username (without @)",
    }),
    reply_to: Type.Optional(
      Type.Number({
        description: "Message ID to reply to",
      })
    ),
  }),
};

export const casinoSpinExecutor: ToolExecutor<GameParams> = async (
  params,
  context
): Promise<ToolResult> => {
  return executeGame(
    {
      emoticon: "🎰",
      gameType: "slot",
      toolName: "casino_spin",
      assetLabel: "SPIN",
      maxMultiplier: CASINO_CONFIG.slot.jackpot.multiplier,
      getMultiplier: getSlotMultiplier,
      getInterpretation: getSlotInterpretation,
      maxValue: 64,
    },
    params,
    context
  );
};
