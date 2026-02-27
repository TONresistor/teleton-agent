import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import type { Deal } from "../../../deals/types.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");

interface DealCancelParams {
  dealId: string;
  reason?: string;
}

export const dealCancelTool: Tool = {
  name: "deal_cancel",
  description: "Cancel a deal. Only works for 'proposed' or 'accepted' status. Irreversible.",
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

    // User-scoping: only deal owner or admins can cancel
    const adminIds = context.config?.telegram.admin_ids ?? [];
    if (context.senderId !== deal.user_telegram_id && !adminIds.includes(context.senderId)) {
      return {
        success: false,
        error: `⛔ You can only cancel your own deals.`,
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

    log.info(`[Deal] #${dealId} cancelled - reason: ${reason || "no reason given"}`);

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
    log.error({ err: error }, "Error cancelling deal");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
