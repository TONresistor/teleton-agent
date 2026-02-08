/**
 * journal_update - Update journal entry outcomes and P&L
 * Use to close pending operations and record final results
 */

import { Type } from "@sinclair/typebox";
import { getDatabase } from "../../../memory/database.js";
import { JournalStore } from "../../../memory/journal-store.js";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";

interface JournalUpdateParams {
  id: number;
  outcome?: "pending" | "profit" | "loss" | "neutral" | "cancelled";
  pnl_ton?: number;
  pnl_pct?: number;
  tx_hash?: string;
}

export const journalUpdateTool: Tool = {
  name: "journal_update",
  description: `Update a journal entry with outcome and P&L.

Use this to:
- Close pending operations with final results
- Record profit/loss after selling or closing a position
- Update transaction hash after confirmation
- Mark operations as cancelled

ALWAYS calculate P&L when closing trades:
- pnl_ton = final value in TON - initial cost in TON
- pnl_pct = (pnl_ton / initial_cost) * 100

Examples:
- "Close trade #42 - sold at profit"
- "Mark gift sale #38 as complete"
- "Update escrow #55 with tx hash"`,

  parameters: Type.Object({
    id: Type.Number({ description: "Journal entry ID to update" }),
    outcome: Type.Optional(
      Type.Union(
        [
          Type.Literal("pending"),
          Type.Literal("profit"),
          Type.Literal("loss"),
          Type.Literal("neutral"),
          Type.Literal("cancelled"),
        ],
        { description: "Update outcome status" }
      )
    ),
    pnl_ton: Type.Optional(
      Type.Number({ description: "Profit/loss in TON (positive = profit, negative = loss)" })
    ),
    pnl_pct: Type.Optional(Type.Number({ description: "Profit/loss percentage" })),
    tx_hash: Type.Optional(Type.String({ description: "Add or update transaction hash" })),
  }),
};

export const journalUpdateExecutor: ToolExecutor<JournalUpdateParams> = async (
  params
): Promise<ToolResult> => {
  const db = getDatabase().getDb();
  const store = new JournalStore(db);

  // Check if entry exists
  const existing = store.getEntryById(params.id);
  if (!existing) {
    return {
      success: false,
      error: `Journal entry #${params.id} not found`,
    };
  }

  // Auto-set closed_at if outcome is being changed to non-pending
  const closed_at =
    params.outcome && params.outcome !== "pending" && !existing.closed_at
      ? Math.floor(Date.now() / 1000)
      : undefined;

  const updated = store.updateEntry({
    id: params.id,
    outcome: params.outcome,
    pnl_ton: params.pnl_ton,
    pnl_pct: params.pnl_pct,
    tx_hash: params.tx_hash,
    closed_at,
  });

  if (!updated) {
    return {
      success: false,
      error: "Failed to update entry",
    };
  }

  // Format output
  const lines: string[] = [
    `✏️ Journal Entry #${updated.id} updated`,
    ``,
    `**Type**: ${updated.type} - ${updated.action}`,
  ];

  if (updated.asset_from || updated.asset_to) {
    const fromStr = updated.asset_from
      ? `${updated.amount_from?.toFixed(4) ?? "?"} ${updated.asset_from}`
      : "—";
    const toStr = updated.asset_to
      ? `${updated.amount_to?.toFixed(4) ?? "?"} ${updated.asset_to}`
      : "—";
    lines.push(`**Assets**: ${fromStr} → ${toStr}`);
  }

  const outcomeEmoji =
    updated.outcome === "profit"
      ? "✅"
      : updated.outcome === "loss"
        ? "❌"
        : updated.outcome === "pending"
          ? "⏳"
          : updated.outcome === "cancelled"
            ? "🚫"
            : "➖";

  lines.push(`**Outcome**: ${outcomeEmoji} ${updated.outcome}`);

  if (updated.pnl_ton !== null && updated.pnl_ton !== undefined) {
    const sign = updated.pnl_ton >= 0 ? "+" : "";
    lines.push(
      `**P&L**: ${sign}${updated.pnl_ton.toFixed(2)} TON (${sign}${updated.pnl_pct?.toFixed(1) ?? "?"}%)`
    );
  }

  if (updated.tx_hash) {
    lines.push(`**TX**: \`${updated.tx_hash.slice(0, 16)}...\``);
  }

  if (updated.closed_at) {
    lines.push(``, `_Closed at ${new Date(updated.closed_at * 1000).toISOString()}_`);
  }

  return {
    success: true,
    data: {
      entry: updated,
      message: lines.join("\n"),
    },
  };
};
