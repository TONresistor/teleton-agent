/**
 * journal_update - Update journal entry outcomes and P&L
 * Use to close pending operations and record final results
 */

import { Type } from "@sinclair/typebox";
import { getDatabase } from "../../../memory/database.js";
import { JournalStore } from "../../../memory/journal-store.js";
import type { JournalOutcome } from "../../../memory/journal-store.js";
import type { Tool, ToolExecutor } from "../types.js";
import { outcomeEmoji, formatAssetFlow, formatTxHash } from "./format.js";

interface JournalUpdateParams {
  id: number;
  outcome?: JournalOutcome;
  pnl_ton?: number;
  pnl_pct?: number;
  tx_hash?: string;
}

export const journalUpdateTool: Tool = {
  name: "journal_update",
  description:
    "Update a journal entry with outcome, P&L, or tx_hash. Auto-sets closed_at when outcome changes from pending.",

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
        {
          description:
            "P&L result — must be EXACTLY one of: 'pending', 'profit' (use when pnl_ton > 0), 'loss' (pnl_ton < 0), 'neutral' (break-even), 'cancelled'. This is the profit/loss outcome, NOT a completion status — do not use 'closed'/'completed'/'success'/'done'. Setting it to a non-pending value auto-closes the entry.",
        }
      )
    ),
    pnl_ton: Type.Optional(
      Type.Number({ description: "Profit/loss in TON (positive = profit, negative = loss)" })
    ),
    pnl_pct: Type.Optional(Type.Number({ description: "Profit/loss percentage" })),
    tx_hash: Type.Optional(Type.String({ description: "Add or update transaction hash" })),
  }),
};

export const journalUpdateExecutor: ToolExecutor<JournalUpdateParams> = async (params) => {
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

  const assetFlow = formatAssetFlow(updated);
  if (assetFlow) {
    lines.push(`**Assets**: ${assetFlow}`);
  }

  lines.push(`**Outcome**: ${outcomeEmoji(updated.outcome)} ${updated.outcome}`);

  if (updated.pnl_ton !== null && updated.pnl_ton !== undefined) {
    const sign = updated.pnl_ton >= 0 ? "+" : "";
    lines.push(
      `**P&L**: ${sign}${updated.pnl_ton.toFixed(2)} TON (${sign}${updated.pnl_pct?.toFixed(1) ?? "?"}%)`
    );
  }

  if (updated.tx_hash) {
    lines.push(`**TX**: ${formatTxHash(updated.tx_hash)}`);
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
