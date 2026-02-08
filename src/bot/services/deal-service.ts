/**
 * Deal service - database operations for deals
 */

import type Database from "better-sqlite3";
import type { DealContext, DealStatus } from "../types.js";
import { DEAL_VERIFICATION_WINDOW_SECONDS } from "../../constants/limits.js";

/**
 * Get deal by ID
 */
export function getDeal(db: Database.Database, dealId: string): DealContext | null {
  const row = db
    .prepare(
      `SELECT
        id, user_telegram_id, user_username, chat_id,
        user_gives_type, user_gives_ton_amount, user_gives_gift_slug, user_gives_value_ton,
        agent_gives_type, agent_gives_ton_amount, agent_gives_gift_slug, agent_gives_value_ton,
        profit_ton, status, created_at, expires_at,
        inline_message_id, payment_claimed_at, user_payment_verified_at, completed_at
      FROM deals WHERE id = ?`
    )
    .get(dealId) as any;

  if (!row) return null;

  return {
    dealId: row.id,
    userId: row.user_telegram_id,
    username: row.user_username,
    chatId: row.chat_id,
    userGivesType: row.user_gives_type,
    userGivesTonAmount: row.user_gives_ton_amount,
    userGivesGiftSlug: row.user_gives_gift_slug,
    userGivesValueTon: row.user_gives_value_ton,
    agentGivesType: row.agent_gives_type,
    agentGivesTonAmount: row.agent_gives_ton_amount,
    agentGivesGiftSlug: row.agent_gives_gift_slug,
    agentGivesValueTon: row.agent_gives_value_ton,
    profitTon: row.profit_ton,
    status: row.status as DealStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    inlineMessageId: row.inline_message_id,
    paymentClaimedAt: row.payment_claimed_at,
    verifiedAt: row.user_payment_verified_at,
    completedAt: row.completed_at,
  };
}

/**
 * Update deal status
 */
export function updateDealStatus(db: Database.Database, dealId: string, status: DealStatus): void {
  db.prepare(`UPDATE deals SET status = ? WHERE id = ?`).run(status, dealId);
}

/**
 * Mark deal as accepted and extend expiry to 5 minutes from now
 */
export function acceptDeal(db: Database.Database, dealId: string): void {
  const newExpiry = Math.floor(Date.now() / 1000) + DEAL_VERIFICATION_WINDOW_SECONDS;
  db.prepare(`UPDATE deals SET status = 'accepted', expires_at = ? WHERE id = ?`).run(
    newExpiry,
    dealId
  );
}

/**
 * Mark deal as declined
 */
export function declineDeal(db: Database.Database, dealId: string): void {
  db.prepare(`UPDATE deals SET status = 'declined' WHERE id = ?`).run(dealId);
}

/**
 * Mark payment as claimed (user clicked "I've sent")
 */
export function claimPayment(db: Database.Database, dealId: string): void {
  db.prepare(
    `UPDATE deals SET status = 'payment_claimed', payment_claimed_at = unixepoch() WHERE id = ?`
  ).run(dealId);
}

/**
 * Store inline message ID for later editing
 */
export function setInlineMessageId(
  db: Database.Database,
  dealId: string,
  inlineMessageId: string
): void {
  db.prepare(`UPDATE deals SET inline_message_id = ? WHERE id = ?`).run(inlineMessageId, dealId);
}

/**
 * Check if deal is expired
 */
export function isDealExpired(deal: DealContext): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now > deal.expiresAt;
}

/**
 * Mark deal as expired
 */
export function expireDeal(db: Database.Database, dealId: string): void {
  db.prepare(`UPDATE deals SET status = 'expired' WHERE id = ?`).run(dealId);
}

/**
 * Get deals pending verification (payment_claimed status)
 */
export function getDealsAwaitingVerification(db: Database.Database): DealContext[] {
  const rows = db
    .prepare(
      `SELECT
        id, user_telegram_id, user_username, chat_id,
        user_gives_type, user_gives_ton_amount, user_gives_gift_slug, user_gives_value_ton,
        agent_gives_type, agent_gives_ton_amount, agent_gives_gift_slug, agent_gives_value_ton,
        profit_ton, status, created_at, expires_at,
        inline_message_id, payment_claimed_at, user_payment_verified_at, completed_at
      FROM deals
      WHERE status = 'payment_claimed'
      ORDER BY payment_claimed_at ASC
      LIMIT 10`
    )
    .all() as any[];

  return rows.map((row) => ({
    dealId: row.id,
    userId: row.user_telegram_id,
    username: row.user_username,
    chatId: row.chat_id,
    userGivesType: row.user_gives_type,
    userGivesTonAmount: row.user_gives_ton_amount,
    userGivesGiftSlug: row.user_gives_gift_slug,
    userGivesValueTon: row.user_gives_value_ton,
    agentGivesType: row.agent_gives_type,
    agentGivesTonAmount: row.agent_gives_ton_amount,
    agentGivesGiftSlug: row.agent_gives_gift_slug,
    agentGivesValueTon: row.agent_gives_value_ton,
    profitTon: row.profit_ton,
    status: row.status as DealStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    inlineMessageId: row.inline_message_id,
    paymentClaimedAt: row.payment_claimed_at,
    verifiedAt: row.user_payment_verified_at,
    completedAt: row.completed_at,
  }));
}

/**
 * Get verified deals awaiting execution
 */
export function getDealsAwaitingExecution(db: Database.Database): DealContext[] {
  const rows = db
    .prepare(
      `SELECT
        id, user_telegram_id, user_username, chat_id,
        user_gives_type, user_gives_ton_amount, user_gives_gift_slug, user_gives_value_ton,
        agent_gives_type, agent_gives_ton_amount, agent_gives_gift_slug, agent_gives_value_ton,
        profit_ton, status, created_at, expires_at,
        inline_message_id, payment_claimed_at, user_payment_verified_at, completed_at
      FROM deals
      WHERE status = 'verified' AND agent_sent_at IS NULL
      ORDER BY user_payment_verified_at ASC
      LIMIT 10`
    )
    .all() as any[];

  return rows.map((row) => ({
    dealId: row.id,
    userId: row.user_telegram_id,
    username: row.user_username,
    chatId: row.chat_id,
    userGivesType: row.user_gives_type,
    userGivesTonAmount: row.user_gives_ton_amount,
    userGivesGiftSlug: row.user_gives_gift_slug,
    userGivesValueTon: row.user_gives_value_ton,
    agentGivesType: row.agent_gives_type,
    agentGivesTonAmount: row.agent_gives_ton_amount,
    agentGivesGiftSlug: row.agent_gives_gift_slug,
    agentGivesValueTon: row.agent_gives_value_ton,
    profitTon: row.profit_ton,
    status: row.status as DealStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    inlineMessageId: row.inline_message_id,
    paymentClaimedAt: row.payment_claimed_at,
    verifiedAt: row.user_payment_verified_at,
    completedAt: row.completed_at,
  }));
}

/**
 * Update user trade stats
 */
export function updateUserStats(
  db: Database.Database,
  userId: number,
  username: string | undefined,
  deal: DealContext,
  completed: boolean
): void {
  // Upsert user stats
  db.prepare(
    `INSERT INTO user_trade_stats (telegram_id, username, total_deals, last_deal_at)
     VALUES (?, ?, 1, unixepoch())
     ON CONFLICT(telegram_id) DO UPDATE SET
       username = COALESCE(?, username),
       total_deals = total_deals + 1,
       last_deal_at = unixepoch()`
  ).run(userId, username, username);

  if (completed) {
    // Update completed stats
    const tonSent = deal.userGivesType === "ton" ? deal.userGivesTonAmount || 0 : 0;
    const tonReceived = deal.agentGivesType === "ton" ? deal.agentGivesTonAmount || 0 : 0;
    const giftsSent = deal.userGivesType === "gift" ? 1 : 0;
    const giftsReceived = deal.agentGivesType === "gift" ? 1 : 0;

    db.prepare(
      `UPDATE user_trade_stats SET
         completed_deals = completed_deals + 1,
         total_ton_sent = total_ton_sent + ?,
         total_ton_received = total_ton_received + ?,
         total_gifts_sent = total_gifts_sent + ?,
         total_gifts_received = total_gifts_received + ?
       WHERE telegram_id = ?`
    ).run(tonSent, tonReceived, giftsSent, giftsReceived, userId);
  }
}
