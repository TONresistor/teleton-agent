/**
 * casino_payout - Process Teleton Casino winnings and send payouts
 */

import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1, TonClient, toNano, internal } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { getSlotMultiplier, getSlotInterpretation } from "../../../casino/config.js";

interface PayoutParams {
  player_address: string;
  bet_amount: number;
  slot_value: number;
  journal_entry_id?: number;
}

/**
 * Tool definition for casino_payout
 */
export const casinoPayoutTool: Tool = {
  name: "casino_payout",
  description: `Manual payout for Teleton Casino (backup tool - normally not needed).

NOTE: casino_spin and casino_dice already include AUTO-PAYOUT.
Only use this tool if auto-payout failed and manual intervention is needed.

Slot payout table (40% house edge):
- Value 64 (🎰 777 Jackpot): 5x bet
- Values 60-63 (Big win): 2.5x bet
- Values 55-59 (Medium win): 1.8x bet
- Values 43-54 (Small win): 1.2x bet
- Values 1-42: No payout

Sends TON to winner's address and updates journal entry.`,

  parameters: Type.Object({
    player_address: Type.String({
      description: "Player's TON wallet address to send winnings",
    }),
    bet_amount: Type.Number({
      description: "Original bet amount in TON",
      minimum: 0.001,
    }),
    slot_value: Type.Number({
      description: "Slot machine result (1-64)",
      minimum: 1,
      maximum: 64,
    }),
    journal_entry_id: Type.Optional(
      Type.Number({
        description: "Journal entry ID to update with payout info",
      })
    ),
  }),
};

/**
 * Executor for casino_payout tool
 */
export const casinoPayoutExecutor: ToolExecutor<PayoutParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { player_address, bet_amount, slot_value, journal_entry_id } = params;

    // SECURITY: Require a valid journal entry to prove a spin actually happened
    if (!journal_entry_id || !context.db) {
      return {
        success: false,
        error:
          "Security restriction: casino_payout requires a journal_entry_id from a real spin/dice result.",
      };
    }

    const journalEntry = context.db
      .prepare(
        `SELECT id, user_id, amount_from, pnl_ton FROM journal WHERE id = ? AND type IN ('casino_spin', 'casino_dice')`
      )
      .get(journal_entry_id) as any;

    if (!journalEntry) {
      return {
        success: false,
        error: `No casino spin/dice found with journal entry #${journal_entry_id}. Cannot send payout without a verified game.`,
      };
    }

    // Verify bet amount matches journal
    if (Math.abs(journalEntry.amount_from - bet_amount) > 0.01) {
      return {
        success: false,
        error: `Bet amount mismatch: journal says ${journalEntry.amount_from} TON but requested ${bet_amount} TON.`,
      };
    }

    // Calculate multiplier and winnings
    const multiplier = getSlotMultiplier(slot_value);

    if (multiplier === 0) {
      // No win - casino profits
      if (journal_entry_id && context.db) {
        // Update journal entry
        context.db
          .prepare(
            `
          UPDATE journal
          SET outcome = 'profit',
              amount_to = 0,
              pnl_ton = ?,
              closed_at = unixepoch()
          WHERE id = ?
        `
          )
          .run(bet_amount, journal_entry_id);

        // Update player's loss stats
        context.db
          .prepare(
            `
          UPDATE casino_users
          SET total_losses = total_losses + 1
          WHERE telegram_id = (
            SELECT user_id FROM journal WHERE id = ?
          )
        `
          )
          .run(journal_entry_id);
      }

      return {
        success: true,
        data: {
          win: false,
          multiplier: 0,
          payout: 0,
          slot_value,
          message: `No win this time. Slot value: ${slot_value}`,
        },
      };
    }

    // Calculate payout
    const payout = bet_amount * multiplier;

    // Validate recipient address
    try {
      Address.parse(player_address);
    } catch (e) {
      return {
        success: false,
        error: `Invalid player address: ${player_address}`,
      };
    }

    // Load casino wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Casino wallet not initialized. Contact admin.",
      };
    }

    // Convert mnemonic to private key
    const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);

    // Create wallet contract
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    // Get endpoint and client
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const client = new TonClient({ endpoint });
    const contract = client.open(wallet);

    // Get current seqno
    const seqno = await contract.getSeqno();

    // Determine win type for message
    const winType = getSlotInterpretation(slot_value);

    // Send payout
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: [
        internal({
          to: Address.parse(player_address),
          value: toNano(payout),
          body: `${winType} You won ${payout} TON (${multiplier}x)`,
          bounce: false,
        }),
      ],
    });

    // Update journal entry if provided
    if (journal_entry_id && context.db) {
      const profit = payout - bet_amount;
      context.db
        .prepare(
          `
        UPDATE journal
        SET outcome = 'loss',
            amount_to = ?,
            pnl_ton = ?,
            pnl_pct = ?,
            closed_at = unixepoch()
        WHERE id = ?
      `
        )
        .run(payout, -profit, -((profit / bet_amount) * 100), journal_entry_id);
    }

    // Update casino user stats
    if (context.db) {
      context.db
        .prepare(
          `
        UPDATE casino_users
        SET total_wins = total_wins + 1,
            total_won = total_won + ?
        WHERE telegram_id = (
          SELECT user_id FROM journal WHERE id = ?
        )
      `
        )
        .run(payout, journal_entry_id || 0);
    }

    return {
      success: true,
      data: {
        win: true,
        multiplier,
        payout: payout.toFixed(2),
        slot_value,
        player_address,
        message: `${winType} Sent ${payout.toFixed(2)} TON (${multiplier}x) to ${player_address}`,
      },
    };
  } catch (error) {
    console.error("Error in casino_payout:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
