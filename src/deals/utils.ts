/**
 * Utility functions for deals system
 */

import type { Deal } from "./types.js";
import { DEALS_CONFIG } from "./config.js";

/**
 * Generate a random deal ID (8 characters)
 */
export function generateDealId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "deal_";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Format asset for display
 */
export function formatAsset(
  type: "ton" | "gift",
  tonAmount?: number | null,
  giftSlug?: string | null
): string {
  if (type === "ton") {
    return `${tonAmount || 0} TON`;
  } else {
    return `Gift: ${giftSlug || "Unknown"}`;
  }
}

/**
 * Format deal summary for display
 */
export function formatDealSummary(deal: Deal): string {
  const userGives = formatAsset(
    deal.user_gives_type,
    deal.user_gives_ton_amount,
    deal.user_gives_gift_slug
  );
  const agentGives = formatAsset(
    deal.agent_gives_type,
    deal.agent_gives_ton_amount,
    deal.agent_gives_gift_slug
  );

  return `Deal #${deal.id}
Status: ${deal.status}
User gives: ${userGives} (${deal.user_gives_value_ton} TON value)
Agent gives: ${agentGives} (${deal.agent_gives_value_ton} TON value)
Profit: ${deal.profit_ton?.toFixed(2) || 0} TON
Created: ${new Date(deal.created_at * 1000).toLocaleString()}
Expires: ${new Date(deal.expires_at * 1000).toLocaleString()}`;
}

/**
 * Calculate deal expiry timestamp (2 minutes from now)
 */
export function calculateExpiry(): number {
  return Math.floor(Date.now() / 1000) + DEALS_CONFIG.expirySeconds;
}

/**
 * Check if deal has expired
 */
export function isDealExpired(deal: Deal): boolean {
  return deal.expires_at < Math.floor(Date.now() / 1000);
}

/**
 * Format deal proposal message with inline buttons
 */
export function formatDealProposal(
  dealId: string,
  userGives: { type: "ton" | "gift"; tonAmount?: number; giftSlug?: string; valueTon: number },
  agentGives: { type: "ton" | "gift"; tonAmount?: number; giftSlug?: string; valueTon: number },
  _profit: number,
  _strategyCompliant: boolean
): string {
  const userGivesStr = formatAsset(userGives.type, userGives.tonAmount, userGives.giftSlug);
  const agentGivesStr = formatAsset(agentGives.type, agentGives.tonAmount, agentGives.giftSlug);

  return `📋 **Deal** #${dealId}

📤 You send: ${userGivesStr}
📥 You receive: ${agentGivesStr}
⏱ Expires in ${Math.round(DEALS_CONFIG.expirySeconds / 60)} minutes`;
}
