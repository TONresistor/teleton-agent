/**
 * Deal executor - automatically sends agent's part after verification
 * Internal module, NOT exposed as a tool (prevents social engineering)
 */

import type Database from "better-sqlite3";
import type { TelegramBridge } from "../telegram/bridge.js";
import type { Deal } from "./types.js";
import { sendTon } from "../ton/transfer.js";
import { formatAsset } from "./utils.js";
import { JournalStore } from "../memory/journal-store.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Deal");

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

    log.info(`Executing deal #${dealId}...`);

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

      log.info(
        `Sending ${deal.agent_gives_ton_amount} TON to ${deal.user_payment_wallet.slice(0, 8)}...`
      );

      // Send TON to user's wallet
      const txHash = await sendTon({
        toAddress: deal.user_payment_wallet,
        amount: deal.agent_gives_ton_amount,
        comment: `Deal #${dealId} - ${formatAsset(deal.agent_gives_type, deal.agent_gives_ton_amount, deal.agent_gives_gift_slug)}`,
      });

      if (!txHash) {
        throw new Error("TON transfer failed (wallet not initialized or invalid parameters)");
      }

      // Update deal: mark as completed (agent_sent_at already set by lock)
      db.prepare(
        `UPDATE deals SET
          status = 'completed',
          agent_sent_tx_hash = ?,
          completed_at = unixepoch()
        WHERE id = ?`
      ).run(txHash, dealId);

      log.info(`Deal #${dealId} completed - TON sent - TX: ${txHash.slice(0, 8)}...`);

      // Log to business journal
      logDealToJournal(deal, db, txHash);

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

      log.info(
        `Sending gift ${deal.agent_gives_gift_slug} (msgId: ${deal.agent_gives_gift_id}) to user ${deal.user_telegram_id}...`
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
            log.info("Transfer requires payment, using payment flow...");

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

        log.info(`Deal #${dealId} completed - Gift transferred`);

        // Log to business journal
        logDealToJournal(deal, db);

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
        log.error({ err: error }, `Failed to transfer gift for deal #${dealId}`);

        // Mark deal as failed (clear agent_sent_at lock since send didn't complete)
        db.prepare(
          `UPDATE deals SET
            status = 'failed',
            agent_sent_at = NULL,
            notes = ?
          WHERE id = ?`
        ).run(`Gift transfer error: ${getErrorMessage(error)}`, dealId);

        return {
          success: false,
          error: `Gift transfer failed: ${getErrorMessage(error)}`,
        };
      }
    }

    // Edge case: shouldn't reach here
    return {
      success: false,
      error: `Invalid deal configuration: agent_gives_type = ${deal.agent_gives_type}`,
    };
  } catch (error) {
    log.error({ err: error }, `Error executing deal #${dealId}`);
    // Release lock on unexpected error
    try {
      db.prepare(
        `UPDATE deals SET agent_sent_at = NULL, status = 'failed', notes = ? WHERE id = ? AND status = 'verified'`
      ).run(`Execution error: ${getErrorMessage(error)}`, dealId);
    } catch (rollbackErr) {
      log.error({ err: rollbackErr }, `CRITICAL: Could not rollback deal #${dealId}`);
    }
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Log completed deal to business journal for P&L tracking
 */
function logDealToJournal(deal: Deal, db: Database.Database, txHash?: string): void {
  try {
    const journal = new JournalStore(db);

    // Determine what agent gave vs received
    const agentGave = formatAsset(
      deal.agent_gives_type,
      deal.agent_gives_ton_amount,
      deal.agent_gives_gift_slug
    );
    const agentReceived = formatAsset(
      deal.user_gives_type,
      deal.user_gives_ton_amount,
      deal.user_gives_gift_slug
    );

    // Determine journal type: gift trade or TON trade
    const isGiftTrade = deal.agent_gives_type === "gift" || deal.user_gives_type === "gift";

    journal.addEntry({
      type: isGiftTrade ? "gift" : "trade",
      action: deal.agent_gives_type === "gift" ? "sell_gift" : "buy_gift",
      asset_from: agentGave,
      asset_to: agentReceived,
      amount_from: deal.agent_gives_ton_amount ?? undefined,
      amount_to: deal.user_gives_ton_amount ?? undefined,
      counterparty: String(deal.user_telegram_id),
      platform: "telegram_deals",
      outcome: "neutral", // P&L computed later when floor prices are known
      tx_hash: txHash,
      tool_used: "deal_executor",
      chat_id: deal.chat_id,
      user_id: deal.user_telegram_id,
    });
  } catch (error) {
    // Non-critical: don't let journal failure break deal execution
    log.error({ err: error }, `Failed to log deal #${deal.id} to journal`);
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
  log.info(`Auto-executing deal #${dealId} after verification...`);

  const result = await executeDeal(dealId, db, bridge);

  if (!result.success) {
    log.error(`Auto-execution failed for #${dealId}: ${result.error}`);

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
