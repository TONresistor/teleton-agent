import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import type { Deal } from "../../../deals/types.js";

interface DealCancelParams {
  dealId: string;
  reason?: string;
}

export const dealCancelTool: Tool = {
  name: "deal_cancel",
  description: `Cancel an active deal (proposed or accepted status only).

IMPORTANT: Cannot cancel deals that are:
- Already verified (payment received)
- Already completed
- Already declined, expired, or failed

Use this when:
- User explicitly asks to cancel
- Deal terms change before verification
- External circumstances make deal impossible

The deal status will be set to 'cancelled' and cannot be resumed.`,
  parameters: Type.Object({
    dealId: Type.String({ description: "Deal ID to cancel" }),
    reason: Type.Optional(Type.String({ description: "Reason for cancellation (optional)" })),
  }),
};

export const dealCancelExecutor: ToolExecutor<DealCancelParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { dealId, reason } = params;

    // Load deal from database
    const deal = context.db.prepare(`SELECT * FROM deals WHERE id = ?`).get(dealId) as
      | Deal
      | undefined;

    if (!deal) {
      return {
        success: false,
        error: `Deal #${dealId} not found`,
      };
    }

    // Check if deal can be cancelled
    const cancellableStatuses = ["proposed", "accepted"];
    if (!cancellableStatuses.includes(deal.status)) {
      return {
        success: false,
        error: `Cannot cancel deal #${dealId} with status '${deal.status}'. Only 'proposed' and 'accepted' deals can be cancelled.`,
      };
    }

    // Update deal status to cancelled
    const notes = reason ? `Cancelled: ${reason}` : "Cancelled by agent";
    context.db
      .prepare(
        `UPDATE deals SET
        status = 'cancelled',
        notes = CASE WHEN notes IS NULL THEN ? ELSE notes || ' | ' || ? END
      WHERE id = ?`
      )
      .run(notes, notes, dealId);

    console.log(`🚫 [Deal] #${dealId} cancelled - reason: ${reason || "no reason given"}`);

    // Notify user in chat if deal was accepted
    if (deal.status === "accepted") {
      await context.bridge.sendMessage({
        chatId: deal.chat_id,
        text: `🚫 **Deal #${dealId} cancelled**

${reason ? `Reason: ${reason}` : "The deal has been cancelled."}

No payment has been processed. You can propose a new deal if you'd like.`,
      });
    }

    return {
      success: true,
      data: {
        dealId,
        previousStatus: deal.status,
        newStatus: "cancelled",
        reason: reason || null,
        message: `Deal #${dealId} has been cancelled.`,
      },
    };
  } catch (error) {
    console.error("Error cancelling deal:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
