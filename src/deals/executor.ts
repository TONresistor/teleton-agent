/**
 * Deal executor - automatically sends agent's part after verification
 * Internal module, NOT exposed as a tool (prevents social engineering)
 */

import type Database from "better-sqlite3";
import type { TelegramBridge } from "../telegram/bridge.js";
import type { Deal } from "./types.js";
import { sendTon } from "../ton/transfer.js";
import { formatAsset } from "./utils.js";

export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  giftMsgId?: string;
  error?: string;
}

/**
 * Execute a verified deal (send TON or gift to user)
 * CRITICAL: Only call this AFTER payment verification
 */
export async function executeDeal(
  dealId: string,
  db: Database.Database,
  bridge: TelegramBridge
): Promise<ExecutionResult> {
  try {
    // Load deal
    const deal = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(dealId) as Deal | undefined;

    if (!deal) {
      return {
        success: false,
        error: `Deal #${dealId} not found`,
      };
    }

    // Verify deal status is 'verified' and not already executed
    if (deal.status !== "verified" || deal.agent_sent_at) {
      return {
        success: false,
        error: deal.agent_sent_at
          ? `Deal #${dealId} already executed at ${new Date(deal.agent_sent_at * 1000).toISOString()}`
          : `Deal #${dealId} has status '${deal.status}', not 'verified'. Cannot execute.`,
      };
    }

    // Atomic lock: claim execution (prevents double-spend from concurrent pollers)
    const lockResult = db
      .prepare(
        `UPDATE deals SET agent_sent_at = unixepoch() WHERE id = ? AND status = 'verified' AND agent_sent_at IS NULL`
      )
      .run(dealId);

    if (lockResult.changes !== 1) {
      return {
        success: false,
        error: `Deal #${dealId} already claimed by another executor`,
      };
    }

    console.log(`⚙️ [Deal] Executing deal #${dealId}...`);

    // Case 1: Agent sends TON
    if (deal.agent_gives_type === "ton") {
      if (!deal.agent_gives_ton_amount) {
        return {
          success: false,
          error: "Deal configuration error: agent_gives_ton_amount is missing",
        };
      }

      if (!deal.user_payment_wallet) {
        return {
          success: false,
          error: "Cannot send TON: user wallet address not discovered from payment",
        };
      }

      console.log(
        `💸 [Deal] Sending ${deal.agent_gives_ton_amount} TON to ${deal.user_payment_wallet.slice(0, 8)}...`
      );

      // Send TON to user's wallet
      const txHash = await sendTon({
        toAddress: deal.user_payment_wallet,
        amount: deal.agent_gives_ton_amount,
        comment: `Deal #${dealId} - ${formatAsset(deal.agent_gives_type, deal.agent_gives_ton_amount, deal.agent_gives_gift_slug)}`,
      });

      if (!txHash) {
        // Release lock since send failed
        db.prepare(
          `UPDATE deals SET agent_sent_at = NULL, status = 'failed', notes = 'TON transfer returned no tx hash' WHERE id = ?`
        ).run(dealId);
        return {
          success: false,
          error: "TON transfer failed (no tx hash returned)",
        };
      }

      // Update deal: mark as completed (agent_sent_at already set by lock)
      db.prepare(
        `UPDATE deals SET
          status = 'completed',
          agent_sent_tx_hash = ?,
          completed_at = unixepoch()
        WHERE id = ?`
      ).run(txHash, dealId);

      console.log(`✅ [Deal] #${dealId} completed - TON sent - TX: ${txHash.slice(0, 8)}...`);

      // Notify user in chat
      await bridge.sendMessage({
        chatId: deal.chat_id,
        text: `✅ **Deal #${dealId} completed!**

I've sent **${deal.agent_gives_ton_amount} TON** to your wallet.

TX Hash: \`${txHash}\`

Thank you for trading! 🎉`,
      });

      return {
        success: true,
        txHash,
      };
    }

    // Case 2: Agent sends gift (must be a collectible to transfer)
    if (deal.agent_gives_type === "gift") {
      if (!deal.agent_gives_gift_id) {
        return {
          success: false,
          error: "Deal configuration error: agent_gives_gift_id (msgId) is missing",
        };
      }

      console.log(
        `🎁 [Deal] Sending gift ${deal.agent_gives_gift_slug} (msgId: ${deal.agent_gives_gift_id}) to user ${deal.user_telegram_id}...`
      );

      // Transfer collectible gift using Telegram API
      const gramJsClient = bridge.getClient().getClient();
      const Api = (await import("telegram")).Api;

      try {
        // Get recipient as InputPeer
        const toUser = await gramJsClient.getInputEntity(deal.user_telegram_id);

        // Build the stargift input reference
        const stargiftInput = new Api.InputSavedStarGiftUser({
          msgId: parseInt(deal.agent_gives_gift_id, 10),
        });

        // Try free transfer first
        try {
          await gramJsClient.invoke(
            new Api.payments.TransferStarGift({
              stargift: stargiftInput,
              toId: toUser,
            })
          );
        } catch (freeTransferError: any) {
          // If PAYMENT_REQUIRED, use payment flow
          if (freeTransferError?.errorMessage === "PAYMENT_REQUIRED") {
            console.log("Transfer requires payment, using payment flow...");

            const invoice = new Api.InputInvoiceStarGiftTransfer({
              stargift: stargiftInput,
              toId: toUser,
            });

            const form: any = await gramJsClient.invoke(
              new Api.payments.GetPaymentForm({
                invoice: invoice,
              })
            );

            await gramJsClient.invoke(
              new Api.payments.SendStarsForm({
                formId: form.formId,
                invoice: invoice,
              })
            );
          } else {
            throw freeTransferError;
          }
        }

        const sentMsgId = deal.agent_gives_gift_id;

        // Update deal: mark as completed (agent_sent_at already set by lock)
        db.prepare(
          `UPDATE deals SET
            status = 'completed',
            agent_sent_gift_msgid = ?,
            completed_at = unixepoch()
          WHERE id = ?`
        ).run(sentMsgId, dealId);

        console.log(`✅ [Deal] #${dealId} completed - Gift transferred`);

        // Notify user in chat
        await bridge.sendMessage({
          chatId: deal.chat_id,
          text: `✅ **Deal #${dealId} completed!**

I've sent you the gift: **${deal.agent_gives_gift_slug}**

Thank you for trading! 🎉`,
        });

        return {
          success: true,
          giftMsgId: sentMsgId,
        };
      } catch (error) {
        console.error(`❌ [Deal] Failed to transfer gift for deal #${dealId}:`, error);

        // Mark deal as failed (clear agent_sent_at lock since send didn't complete)
        db.prepare(
          `UPDATE deals SET
            status = 'failed',
            agent_sent_at = NULL,
            notes = ?
          WHERE id = ?`
        ).run(
          `Gift transfer error: ${error instanceof Error ? error.message : String(error)}`,
          dealId
        );

        return {
          success: false,
          error: `Gift transfer failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // Edge case: shouldn't reach here
    return {
      success: false,
      error: `Invalid deal configuration: agent_gives_type = ${deal.agent_gives_type}`,
    };
  } catch (error) {
    console.error(`❌ [Deal] Error executing deal #${dealId}:`, error);
    // Release lock on unexpected error
    try {
      db.prepare(
        `UPDATE deals SET agent_sent_at = NULL, status = 'failed', notes = ? WHERE id = ? AND status = 'verified'`
      ).run(`Execution error: ${error instanceof Error ? error.message : String(error)}`, dealId);
    } catch (rollbackErr) {
      console.error(`❌ [Deal] CRITICAL: Could not rollback deal #${dealId}:`, rollbackErr);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Auto-execute deal after verification (called internally)
 */
export async function autoExecuteAfterVerification(
  dealId: string,
  db: Database.Database,
  bridge: TelegramBridge
): Promise<void> {
  console.log(`🔄 [Deal] Auto-executing deal #${dealId} after verification...`);

  const result = await executeDeal(dealId, db, bridge);

  if (!result.success) {
    console.error(`❌ [Deal] Auto-execution failed for #${dealId}:`, result.error);

    // Notify user of failure
    const deal = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(dealId) as Deal | undefined;
    if (deal) {
      await bridge.sendMessage({
        chatId: deal.chat_id,
        text: `⚠️ **Deal #${dealId} execution failed**

Your payment was verified, but I encountered an error while sending my part:

${result.error}

Please contact support. Your deal is on record.`,
      });
    }
  }
}
