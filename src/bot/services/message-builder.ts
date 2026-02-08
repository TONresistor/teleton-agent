/**
 * Message builder for deal bot
 * Generates formatted messages and styled button definitions for each deal state.
 * Uses HTML parse mode (Telegram Bot API) for text formatting.
 * Returns StyledButtonDef[][] for buttons, which callers convert to either:
 *   - GramJS TL objects (with colors, for MTProto)
 *   - Grammy InlineKeyboard (no colors, for Bot API fallback)
 */

import type { DealContext } from "../types.js";
import type { StyledButtonDef, DealMessage } from "./styled-keyboard.js";

/**
 * Escape HTML special characters
 */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Custom emoji for animated hourglass (only one kept as premium) */
const TIMER_EMOJI = `<tg-emoji emoji-id="5451646226975955576">⏳</tg-emoji>`;

/**
 * Format asset for display (with NFT link for gifts)
 * giftSlug is the API slug (e.g. "LolPop-425402"), used directly in URL
 */
function formatAsset(type: "ton" | "gift", tonAmount?: number, giftSlug?: string): string {
  if (type === "ton" && tonAmount) {
    return `<b>${tonAmount} TON</b>`;
  }
  if (type === "gift" && giftSlug) {
    return `<a href="https://t.me/nft/${esc(giftSlug)}">${esc(giftSlug)}</a>`;
  }
  return "???";
}

/**
 * Format remaining time
 */
function getRemainingTime(expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const remaining = expiresAt - now;
  if (remaining <= 0) return "Expired";
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/**
 * Proposal state - Accept/Decline
 */
export function buildProposalMessage(deal: DealContext): DealMessage {
  const userGives = formatAsset(
    deal.userGivesType,
    deal.userGivesTonAmount,
    deal.userGivesGiftSlug
  );
  const agentGives = formatAsset(
    deal.agentGivesType,
    deal.agentGivesTonAmount,
    deal.agentGivesGiftSlug
  );
  const remaining = getRemainingTime(deal.expiresAt);
  const user = deal.username ? `@${esc(deal.username)}` : `${deal.userId}`;

  const text = `👛 <b>Deal</b> #${esc(deal.dealId)}

👤 ${user}
📤 Sends: ${userGives}
📥 Receives: ${agentGives}
${TIMER_EMOJI} Expires in ${remaining}`;

  const buttons: StyledButtonDef[][] = [
    [
      { text: "✅ Accept", callbackData: `accept:${deal.dealId}`, style: "success" },
      { text: "❌ Decline", callbackData: `decline:${deal.dealId}`, style: "danger" },
    ],
  ];

  return { text, buttons };
}

/**
 * Accepted state - Payment/gift instructions
 */
export function buildAcceptedMessage(deal: DealContext, agentWallet: string): DealMessage {
  const userGives = formatAsset(
    deal.userGivesType,
    deal.userGivesTonAmount,
    deal.userGivesGiftSlug
  );
  const agentGives = formatAsset(
    deal.agentGivesType,
    deal.agentGivesTonAmount,
    deal.agentGivesGiftSlug
  );

  let instructions: string;
  let buttons: StyledButtonDef[][];

  if (deal.userGivesType === "ton") {
    instructions = `
💰 <b>Send ${deal.userGivesTonAmount} TON</b>
📍 <code>${esc(agentWallet)}</code>
📝 Memo: <code>${esc(deal.dealId)}</code>

‼️ <b>Memo is required!</b>`;

    buttons = [
      [
        { text: "Copy Address", callbackData: `copy_addr:${deal.dealId}`, copyText: agentWallet },
        { text: "Copy Memo", callbackData: `copy_memo:${deal.dealId}`, copyText: deal.dealId },
      ],
      [{ text: "✅ I've sent the payment", callbackData: `sent:${deal.dealId}`, style: "primary" }],
    ];
  } else {
    instructions = `
🎁 Send your ${formatAsset("gift", undefined, deal.userGivesGiftSlug)} to the agent`;

    buttons = [
      [{ text: "✅ I've sent the gift", callbackData: `sent:${deal.dealId}`, style: "success" }],
    ];
  }

  const remaining = getRemainingTime(deal.expiresAt);

  const text = `✅ <b>Deal Accepted</b> #${esc(deal.dealId)}

📤 You send: ${userGives}
📥 You receive: ${agentGives}
${TIMER_EMOJI} ${remaining} to complete
${instructions}`;

  return { text, buttons };
}

/**
 * Payment claimed - Verifying
 */
export function buildVerifyingMessage(deal: DealContext): DealMessage {
  const itemType = deal.userGivesType === "ton" ? "payment" : "gift";

  const text = `${TIMER_EMOJI} <b>Verifying ${itemType}...</b>

Deal #${esc(deal.dealId)}

This usually takes 10-30 seconds.`;

  const buttons: StyledButtonDef[][] = [
    [{ text: "🔄 Refresh", callbackData: `refresh:${deal.dealId}`, style: "primary" }],
  ];

  return { text, buttons };
}

/**
 * Verified - Sending agent's part
 */
export function buildSendingMessage(deal: DealContext): DealMessage {
  const agentGives = formatAsset(
    deal.agentGivesType,
    deal.agentGivesTonAmount,
    deal.agentGivesGiftSlug
  );

  const text = `✅ <b>Payment Verified</b>

Deal #${esc(deal.dealId)}
Sending ${agentGives}...`;

  return { text, buttons: [] };
}

/**
 * Completed - Final recap
 */
export function buildCompletedMessage(deal: DealContext): DealMessage {
  const userGives = formatAsset(
    deal.userGivesType,
    deal.userGivesTonAmount,
    deal.userGivesGiftSlug
  );
  const agentGives = formatAsset(
    deal.agentGivesType,
    deal.agentGivesTonAmount,
    deal.agentGivesGiftSlug
  );
  const user = deal.username ? `@${esc(deal.username)}` : `${deal.userId}`;

  const duration = deal.completedAt
    ? Math.floor(deal.completedAt - deal.createdAt)
    : Math.floor(Date.now() / 1000 - deal.createdAt);

  const text = `🤝 <b>Deal Complete</b> #${esc(deal.dealId)}

👤 ${user}
📤 Sent: ${userGives} ✓
📥 Received: ${agentGives} ✓
${TIMER_EMOJI} ${duration}s`;

  return { text, buttons: [] };
}

/**
 * Declined
 */
export function buildDeclinedMessage(deal: DealContext): DealMessage {
  const text = `❌ <b>Deal Declined</b> #${esc(deal.dealId)}`;
  return { text, buttons: [] };
}

/**
 * Expired
 */
export function buildExpiredMessage(deal: DealContext): DealMessage {
  const text = `${TIMER_EMOJI} <b>Deal Expired</b> #${esc(deal.dealId)}`;
  return { text, buttons: [] };
}

/**
 * Failed
 */
export function buildFailedMessage(deal: DealContext, error?: string): DealMessage {
  const text = `❌ <b>Deal Failed</b> #${esc(deal.dealId)}

${esc(error || "Unknown error")}`;

  return { text, buttons: [] };
}

/**
 * Wrong user
 */
export function buildWrongUserMessage(deal: DealContext): string {
  return `🚫 This deal is for @${esc(String(deal.username || deal.userId))} only.`;
}

/**
 * Not found
 */
export function buildNotFoundMessage(dealId: string): string {
  return `❌ Deal #${esc(dealId)} not found.`;
}

/**
 * Route to correct message builder based on deal status
 */
export function buildMessageForState(deal: DealContext, agentWallet?: string): DealMessage {
  switch (deal.status) {
    case "proposed":
      return buildProposalMessage(deal);
    case "accepted":
      return buildAcceptedMessage(deal, agentWallet || "");
    case "payment_claimed":
      return buildVerifyingMessage(deal);
    case "verified":
      return buildSendingMessage(deal);
    case "completed":
      return buildCompletedMessage(deal);
    case "declined":
      return buildDeclinedMessage(deal);
    case "expired":
      return buildExpiredMessage(deal);
    case "failed":
      return buildFailedMessage(deal);
    default:
      return buildProposalMessage(deal);
  }
}
