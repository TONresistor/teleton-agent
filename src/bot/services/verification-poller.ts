/**
 * Verification Poller - automatically verifies deals with payment_claimed status
 * Runs in background, checking for TON payments and gift receipts
 */

import type Database from "better-sqlite3";
import type { TelegramBridge } from "../../telegram/bridge.js";
import type { DealBot } from "../index.js";
import type { DealContext } from "../types.js";
import { getDealsAwaitingVerification, updateDealStatus, updateUserStats } from "./deal-service.js";
import {
  buildSendingMessage,
  buildCompletedMessage,
  buildFailedMessage,
} from "./message-builder.js";
import { verifyPayment } from "../../casino/payment-verifier.js";
import { getWalletAddress } from "../../ton/wallet-service.js";
import { executeDeal } from "../../deals/executor.js";
import { DEALS_CONFIG } from "../../deals/config.js";

interface PollerConfig {
  pollIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export class VerificationPoller {
  private db: Database.Database;
  private bridge: TelegramBridge;
  private bot: DealBot;
  private config: PollerConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private retryMap: Map<string, number> = new Map(); // dealId → retry count

  constructor(
    db: Database.Database,
    bridge: TelegramBridge,
    bot: DealBot,
    config: Partial<PollerConfig> = {}
  ) {
    this.db = db;
    this.bridge = bridge;
    this.bot = bot;
    this.config = { ...DEALS_CONFIG.verification, ...config };
  }

  /**
   * Start polling for deals awaiting verification
   */
  start(): void {
    if (this.intervalId) {
      console.warn("⚠️ [Poller] Already running");
      return;
    }

    console.log(`🔄 [Poller] Started (interval: ${this.config.pollIntervalMs}ms)`);

    this.intervalId = setInterval(() => {
      this.poll().catch((err) => console.error("❌ [Poller] Unhandled poll error:", err));
    }, this.config.pollIntervalMs);

    // Run immediately
    this.poll().catch((err) => console.error("❌ [Poller] Initial poll error:", err));
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("🛑 [Poller] Stopped");
    }
  }

  /**
   * Main poll cycle
   */
  private async poll(): Promise<void> {
    try {
      const deals = getDealsAwaitingVerification(this.db);

      if (deals.length === 0) return;

      for (const deal of deals) {
        const retryCount = this.retryMap.get(deal.dealId) || 0;
        if (retryCount === 0) {
          console.log(`🔍 [Poller] Verifying deal ${deal.dealId}...`);
        }
        await this.verifyDeal(deal);
      }
    } catch (error) {
      console.error("❌ [Poller] Error during poll:", error);
    }
  }

  /**
   * Verify a single deal
   */
  private async verifyDeal(deal: DealContext): Promise<void> {
    const retryCount = this.retryMap.get(deal.dealId) || 0;

    // Check max retries
    if (retryCount >= this.config.maxRetries) {
      console.log(
        `⏰ [Poller] Deal ${deal.dealId} verification timeout after ${retryCount} retries`
      );
      await this.handleTimeout(deal);
      return;
    }

    try {
      let verified = false;
      let txHash: string | undefined;
      let playerWallet: string | undefined;
      let giftMsgId: string | undefined;

      // Case 1: User gives TON → verify blockchain
      if (deal.userGivesType === "ton") {
        const result = await this.verifyTonPayment(deal);
        verified = result.verified;
        txHash = result.txHash;
        playerWallet = result.playerWallet;
      }
      // Case 2: User gives gift → check received gifts
      else if (deal.userGivesType === "gift") {
        const result = await this.verifyGiftReceipt(deal);
        verified = result.verified;
        giftMsgId = result.giftMsgId;
      }

      if (verified) {
        await this.handleVerified(deal, txHash, playerWallet, giftMsgId);
        this.retryMap.delete(deal.dealId);
      } else {
        // Increment retry count
        this.retryMap.set(deal.dealId, retryCount + 1);
      }
    } catch (error) {
      console.error(`❌ [Poller] Error verifying deal ${deal.dealId}:`, error);
      this.retryMap.set(deal.dealId, retryCount + 1);
    }
  }

  /**
   * Verify TON payment on blockchain
   */
  private async verifyTonPayment(
    deal: DealContext
  ): Promise<{ verified: boolean; txHash?: string; playerWallet?: string }> {
    const botWallet = getWalletAddress();

    if (!botWallet || !deal.userGivesTonAmount) {
      return { verified: false };
    }

    const result = await verifyPayment(this.db, {
      botWalletAddress: botWallet,
      betAmount: deal.userGivesTonAmount,
      requestTime: deal.createdAt * 1000,
      gameType: `deal:${deal.dealId}`,
      userId: deal.dealId, // memo = dealId
    });

    return {
      verified: result.verified,
      txHash: result.txHash,
      playerWallet: result.playerWallet,
    };
  }

  /**
   * Verify gift receipt via Telegram API
   */
  private async verifyGiftReceipt(
    deal: DealContext
  ): Promise<{ verified: boolean; giftMsgId?: string }> {
    try {
      // Get agent's own user ID
      const me = this.bridge.getClient().getMe();
      if (!me) return { verified: false };

      const botUserId = Number(me.id);

      // Import gift executor
      const { telegramGetMyGiftsExecutor } =
        await import("../../agent/tools/telegram/gifts/get-my-gifts.js");

      // Build minimal tool context
      const toolContext = {
        bridge: this.bridge,
        db: this.db,
        chatId: deal.chatId,
        isGroup: false,
        senderId: deal.userId,
      } as any;

      const result = await telegramGetMyGiftsExecutor(
        { userId: botUserId.toString(), limit: 50 },
        toolContext
      );

      if (!result.success || !result.data) {
        return { verified: false };
      }

      const gifts = (result.data as any).gifts || [];

      // Find matching gift from user after deal creation
      const matchingGift = gifts.find(
        (g: any) =>
          g.slug === deal.userGivesGiftSlug &&
          Number(g.fromId) === deal.userId &&
          (g.date || Date.now()) >= deal.createdAt * 1000
      );

      if (matchingGift) {
        return {
          verified: true,
          giftMsgId: matchingGift.msgId,
        };
      }

      return { verified: false };
    } catch (error) {
      console.error(`❌ [Poller] Gift verification error for deal ${deal.dealId}:`, error);
      return { verified: false };
    }
  }

  /**
   * Handle verified payment - update DB, execute deal, update bot message
   */
  private async handleVerified(
    deal: DealContext,
    txHash?: string,
    playerWallet?: string,
    giftMsgId?: string
  ): Promise<void> {
    console.log(`✅ [Poller] Deal ${deal.dealId} payment verified!`);

    // Update deal status to 'verified' (atomic: only if still payment_claimed)
    let transitioned: boolean;
    if (deal.userGivesType === "ton") {
      const result = this.db
        .prepare(
          `UPDATE deals SET
            status = 'verified',
            user_payment_tx_hash = ?,
            user_payment_wallet = ?,
            user_payment_verified_at = unixepoch()
          WHERE id = ? AND status = 'payment_claimed'`
        )
        .run(txHash, playerWallet, deal.dealId);
      transitioned = result.changes === 1;
    } else {
      const result = this.db
        .prepare(
          `UPDATE deals SET
            status = 'verified',
            user_payment_gift_msgid = ?,
            user_payment_verified_at = unixepoch()
          WHERE id = ? AND status = 'payment_claimed'`
        )
        .run(giftMsgId, deal.dealId);
      transitioned = result.changes === 1;
    }

    // Another poller already transitioned this deal — abort
    if (!transitioned) {
      console.warn(
        `⚠️ [Poller] Deal ${deal.dealId} already transitioned by another poller, skipping`
      );
      return;
    }

    // Update bot inline message to show "Sending..."
    if (deal.inlineMessageId) {
      const { text, buttons } = buildSendingMessage(deal);
      await this.bot.editMessageByInlineId(deal.inlineMessageId, text, buttons);
    }

    // Execute deal (send agent's part)
    const result = await executeDeal(deal.dealId, this.db, this.bridge);

    if (result.success) {
      // Update user stats
      updateUserStats(this.db, deal.userId, deal.username, deal, true);

      // Reload deal for completed message
      const completedDeal = { ...deal, status: "completed" as const };

      // Update bot message to final recap
      if (deal.inlineMessageId) {
        const { text, buttons } = buildCompletedMessage(completedDeal);
        await this.bot.editMessageByInlineId(deal.inlineMessageId, text, buttons);
      }

      console.log(`🎉 [Poller] Deal ${deal.dealId} completed successfully!`);
    } else {
      // Deal failed
      if (deal.inlineMessageId) {
        const { text, buttons } = buildFailedMessage(deal, result.error);
        await this.bot.editMessageByInlineId(deal.inlineMessageId, text, buttons);
      }

      console.error(`❌ [Poller] Deal ${deal.dealId} execution failed:`, result.error);
    }
  }

  /**
   * Handle verification timeout
   */
  private async handleTimeout(deal: DealContext): Promise<void> {
    // Mark deal as failed
    this.db
      .prepare(
        `UPDATE deals SET
          status = 'failed',
          notes = 'Payment verification timeout'
        WHERE id = ?`
      )
      .run(deal.dealId);

    // Update bot message
    if (deal.inlineMessageId) {
      const { text, buttons } = buildFailedMessage(
        deal,
        "Payment not detected after 60 seconds. Contact support if you have sent it."
      );
      await this.bot.editMessageByInlineId(deal.inlineMessageId, text, buttons);
    }

    // Notify in chat
    await this.bridge.sendMessage({
      chatId: deal.chatId,
      text: `⚠️ **Deal #${deal.dealId} - Timeout**

Could not verify your payment after 60 seconds.

If you have sent it, contact support with the deal ID.`,
    });

    // Clean up retry map
    this.retryMap.delete(deal.dealId);
  }
}
