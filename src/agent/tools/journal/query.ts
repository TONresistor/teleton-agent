/**
 * journal_query - Query and analyze journal entries
 * Filter by type, asset, outcome, time period
 */

import { Type } from "@sinclair/typebox";
import { getDatabase } from "../../../memory/database.js";
import { JournalStore } from "../../../memory/journal-store.js";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";

interface JournalQueryParams {
  type?: "trade" | "gift" | "middleman" | "kol";
  asset?: string;
  outcome?: "pending" | "profit" | "loss" | "neutral" | "cancelled";
  days?: number;
  limit?: number;
}

export const journalQueryTool: Tool = {
  name: "journal_query",
  description: `Query the trading journal to analyze past operations.

Use this to:
- Review recent trades, gifts, or services
- Analyze performance (win rate, P&L)
- Find specific operations by asset or outcome
- Learn from past decisions (read the 'reasoning' field!)

Examples:
- "Show me my last 10 trades"
- "What gifts did I sell this week?"
- "Show all profitable TON trades"
- "What's my win rate on crypto trades?"`,

  parameters: Type.Object({
    type: Type.Optional(
      Type.Union(
        [
          Type.Literal("trade"),
          Type.Literal("gift"),
          Type.Literal("middleman"),
          Type.Literal("kol"),
        ],
        { description: "Filter by operation type" }
      )
    ),
    asset: Type.Optional(
      Type.String({ description: "Filter by asset (e.g., 'TON', 'USDT', 'Deluxe Heart')" })
    ),
    outcome: Type.Optional(
      Type.Union(
        [
          Type.Literal("pending"),
          Type.Literal("profit"),
          Type.Literal("loss"),
          Type.Literal("neutral"),
          Type.Literal("cancelled"),
        ],
        { description: "Filter by outcome status" }
      )
    ),
    days: Type.Optional(
      Type.Number({ description: "Limit to last N days (e.g., 7 for last week)", minimum: 1 })
    ),
    limit: Type.Optional(
      Type.Number({ description: "Max number of results (default: 20)", minimum: 1 })
    ),
  }),
};

export const journalQueryExecutor: ToolExecutor<JournalQueryParams> = async (
  params
): Promise<ToolResult> => {
  const db = getDatabase().getDb();
  const store = new JournalStore(db);

  const entries = store.queryEntries({
    type: params.type,
    asset: params.asset,
    outcome: params.outcome,
    days: params.days,
    limit: params.limit ?? 20,
  });

  if (entries.length === 0) {
    return {
      success: true,
      data: {
        entries: [],
        message: "No entries found matching your filters.",
      },
    };
  }

  // Calculate P&L summary if filtering by outcome or type
  let summary = "";
  if (params.type || params.days) {
    const pnl = store.calculatePnL({
      type: params.type,
      days: params.days,
    });

    if (pnl.trades_count > 0) {
      summary = [
        `**📊 Performance Summary**`,
        ``,
        `Trades: ${pnl.trades_count} (${pnl.profit_count} wins, ${pnl.loss_count} losses)`,
        `Win Rate: ${pnl.win_rate.toFixed(1)}%`,
        `Total P&L: ${pnl.total_pnl >= 0 ? "+" : ""}${pnl.total_pnl.toFixed(2)} TON`,
        ``,
        `---`,
        ``,
      ].join("\n");
    }
  }

  // Format entries
  const lines: string[] = [`📖 Journal Entries (${entries.length} results)`, ``];

  if (summary) {
    lines.push(summary);
  }

  for (const entry of entries) {
    const date = new Date(entry.timestamp * 1000).toISOString().split("T")[0];
    const outcomeEmoji =
      entry.outcome === "profit"
        ? "✅"
        : entry.outcome === "loss"
          ? "❌"
          : entry.outcome === "pending"
            ? "⏳"
            : entry.outcome === "cancelled"
              ? "🚫"
              : "➖";

    lines.push(`**#${entry.id}** ${outcomeEmoji} ${entry.type} - ${entry.action} _[${date}]_`);

    if (entry.asset_from || entry.asset_to) {
      const fromStr = entry.asset_from
        ? `${entry.amount_from?.toFixed(4) ?? "?"} ${entry.asset_from}`
        : "—";
      const toStr = entry.asset_to
        ? `${entry.amount_to?.toFixed(4) ?? "?"} ${entry.asset_to}`
        : "—";
      lines.push(`  ${fromStr} → ${toStr}`);
    }

    if (entry.price_ton) {
      lines.push(`  Price: ${entry.price_ton} TON`);
    }

    if (entry.counterparty) {
      lines.push(`  Party: ${entry.counterparty}`);
    }

    if (entry.platform) {
      lines.push(`  Platform: ${entry.platform}`);
    }

    if (entry.pnl_ton !== null && entry.pnl_ton !== undefined) {
      const sign = entry.pnl_ton >= 0 ? "+" : "";
      lines.push(
        `  P&L: ${sign}${entry.pnl_ton.toFixed(2)} TON (${sign}${entry.pnl_pct?.toFixed(1) ?? "?"}%)`
      );
    }

    if (entry.reasoning) {
      lines.push(`  _"${entry.reasoning}"_`);
    }

    if (entry.tx_hash) {
      lines.push(`  TX: \`${entry.tx_hash.slice(0, 16)}...\``);
    }

    lines.push(``);
  }

  return {
    success: true,
    data: {
      entries,
      message: lines.join("\n"),
    },
  };
};
