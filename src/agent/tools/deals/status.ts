import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import type { Deal } from "../../../deals/types.js";
import { formatAsset } from "../../../deals/utils.js";

interface DealStatusParams {
  dealId: string;
}

export const dealStatusTool: Tool = {
  name: "deal_status",
  description: `Check the status and details of a deal by ID.

Shows:
- Deal parties (user, agent)
- What each side gives/receives
- Current status (proposed, accepted, verified, completed, etc.)
- Timestamps (created, expires, verified, completed)
- Payment/transfer tracking info (TX hashes, msgIds)
- Profit calculation`,
  parameters: Type.Object({
    dealId: Type.String({ description: "Deal ID to check status for" }),
  }),
};

export const dealStatusExecutor: ToolExecutor<DealStatusParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    // Load deal from database
    const deal = context.db.prepare(`SELECT * FROM deals WHERE id = ?`).get(params.dealId) as
      | Deal
      | undefined;

    if (!deal) {
      return {
        success: false,
        error: `Deal #${params.dealId} not found`,
      };
    }

    // Format timestamps
    const createdAt = new Date(deal.created_at * 1000).toISOString();
    const expiresAt = new Date(deal.expires_at * 1000).toISOString();
    const verifiedAt = deal.user_payment_verified_at
      ? new Date(deal.user_payment_verified_at * 1000).toISOString()
      : null;
    const completedAt = deal.completed_at ? new Date(deal.completed_at * 1000).toISOString() : null;
    const sentAt = deal.agent_sent_at ? new Date(deal.agent_sent_at * 1000).toISOString() : null;

    // Format assets
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

    // Build status text
    let statusEmoji = "⏳";
    if (deal.status === "completed") statusEmoji = "✅";
    else if (deal.status === "verified") statusEmoji = "🔄";
    else if (deal.status === "accepted") statusEmoji = "👍";
    else if (deal.status === "declined") statusEmoji = "❌";
    else if (deal.status === "expired") statusEmoji = "⏰";
    else if (deal.status === "failed") statusEmoji = "💥";
    else if (deal.status === "cancelled") statusEmoji = "🚫";

    return {
      success: true,
      data: {
        dealId: deal.id,
        status: deal.status,
        statusEmoji,
        // Parties
        user: {
          telegramId: deal.user_telegram_id,
          username: deal.user_username,
          wallet: deal.user_payment_wallet,
        },
        chatId: deal.chat_id,
        // Trade details
        userGives: {
          type: deal.user_gives_type,
          tonAmount: deal.user_gives_ton_amount,
          giftId: deal.user_gives_gift_id,
          giftSlug: deal.user_gives_gift_slug,
          valueTon: deal.user_gives_value_ton,
          formatted: userGives,
        },
        agentGives: {
          type: deal.agent_gives_type,
          tonAmount: deal.agent_gives_ton_amount,
          giftId: deal.agent_gives_gift_id,
          giftSlug: deal.agent_gives_gift_slug,
          valueTon: deal.agent_gives_value_ton,
          formatted: agentGives,
        },
        // Payment tracking
        payment: {
          verified: !!deal.user_payment_verified_at,
          txHash: deal.user_payment_tx_hash,
          giftMsgId: deal.user_payment_gift_msgid,
          verifiedAt,
        },
        // Agent send tracking
        agentSent: {
          sent: !!deal.agent_sent_at,
          txHash: deal.agent_sent_tx_hash,
          giftMsgId: deal.agent_sent_gift_msgid,
          sentAt,
        },
        // Business
        profit: deal.profit_ton,
        strategyCheck: deal.strategy_check ? JSON.parse(deal.strategy_check) : null,
        // Timestamps
        createdAt,
        expiresAt,
        completedAt,
        notes: deal.notes,
        // Formatted summary
        summary: `${statusEmoji} **Deal #${deal.id}** - ${deal.status}

**User gives:** ${userGives}
**Agent gives:** ${agentGives}
**Profit:** ${deal.profit_ton?.toFixed(2) || 0} TON

**Created:** ${createdAt}
**Expires:** ${expiresAt}
${verifiedAt ? `**Verified:** ${verifiedAt}` : ""}
${completedAt ? `**Completed:** ${completedAt}` : ""}
${deal.notes ? `\n**Notes:** ${deal.notes}` : ""}`,
      },
    };
  } catch (error) {
    console.error("Error checking deal status:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
