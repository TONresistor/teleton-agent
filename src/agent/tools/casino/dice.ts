/**
 * casino_dice - Teleton Casino dice game
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { executeGame, type GameParams } from "../../../casino/game-engine.js";
import { CASINO_CONFIG, getDiceMultiplier, getDiceInterpretation } from "../../../casino/config.js";

export const casinoDiceTool: Tool = {
  name: "casino_dice",
  description: `Execute a Teleton Casino dice roll with full security checks.

Dice payout table:
- 🎲 6 = JACKPOT (2.5x bet)
- 🎲 5 = Big win (1.8x bet)
- 🎲 4 = Small win (1.3x bet)
- 🎲 1-3 = No win

Same security as slot:
1. Validates bet amount
2. Checks cooldown (30 sec)
3. Verifies TON payment with username as memo
4. Auto-discovers player wallet
5. Sends 🎲 dice animation
6. AUTO-PAYOUT if player wins

Tell the user: "Send X TON to [casino_address] with memo: your_username"`,

  parameters: Type.Object({
    chat_id: Type.String({
      description: "Telegram chat ID where to send the dice",
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

export const casinoDiceExecutor: ToolExecutor<GameParams> = async (
  params,
  context
): Promise<ToolResult> => {
  return executeGame(
    {
      emoticon: "🎲",
      gameType: "dice",
      toolName: "casino_dice",
      assetLabel: "DICE",
      maxMultiplier: CASINO_CONFIG.dice.jackpot.multiplier,
      getMultiplier: getDiceMultiplier,
      getInterpretation: getDiceInterpretation,
      maxValue: 6,
    },
    params,
    context
  );
};
