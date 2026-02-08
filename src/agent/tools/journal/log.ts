/**
 * journal_log - Manual logging of business operations
 * Use this to record trades, gifts, middleman, KOL activities with reasoning
 */

import { Type } from "@sinclair/typebox";
import { getDatabase } from "../../../memory/database.js";
import { JournalStore } from "../../../memory/journal-store.js";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";

interface JournalLogParams {
  type: "trade" | "gift" | "middleman" | "kol";
  action: string;
  asset_from?: string;
  asset_to?: string;
  amount_from?: number;
  amount_to?: number;
  price_ton?: number;
  counterparty?: string;
  platform?: string;
  reasoning: string;
  outcome?: "pending" | "profit" | "loss" | "neutral" | "cancelled";
  tx_hash?: string;
}

export const journalLogTool: Tool = {
  name: "journal_log",
  description: `Log a business operation to the trading journal.

Use this to record:
- **trade**: Crypto swaps, buy/sell operations
- **gift**: Gift purchases, sales, or exchanges
- **middleman**: Escrow services (record both sides if applicable)
- **kol**: Posts, moderation, bullposting services

ALWAYS include 'reasoning' to explain WHY you took this action.

Examples:
- trade: "Bought TON dip (-28% in 72h), community active, narrative fits ecosystem"
- gift: "Sold Deluxe Heart at 120% floor - buyer was eager"
- middleman: "Escrow for 150 TON gift trade - 3% fee"
- kol: "Posted project review in channel - 75 TON fee"`,

  parameters: Type.Object({
    type: Type.Union(
      [Type.Literal("trade"), Type.Literal("gift"), Type.Literal("middleman"), Type.Literal("kol")],
      { description: "Type of operation" }
    ),
    action: Type.String({
      description: "Brief action description (e.g., 'buy', 'sell', 'swap', 'escrow', 'post')",
    }),
    asset_from: Type.Optional(
      Type.String({ description: "Asset sent/sold (e.g., 'TON', 'USDT', 'Deluxe Heart')" })
    ),
    asset_to: Type.Optional(Type.String({ description: "Asset received/bought" })),
    amount_from: Type.Optional(Type.Number({ description: "Amount sent/sold" })),
    amount_to: Type.Optional(Type.Number({ description: "Amount received/bought" })),
    price_ton: Type.Optional(Type.Number({ description: "Price in TON (for gifts, services)" })),
    counterparty: Type.Optional(
      Type.String({ description: "Username or ID of the other party (if applicable)" })
    ),
    platform: Type.Optional(
      Type.String({ description: "Platform used (e.g., 'STON.fi', 'Telegram', 'DeDust')" })
    ),
    reasoning: Type.String({
      description:
        "WHY you took this action - explain your decision-making (this is CRITICAL for learning and auditing)",
    }),
    outcome: Type.Optional(
      Type.Union(
        [
          Type.Literal("pending"),
          Type.Literal("profit"),
          Type.Literal("loss"),
          Type.Literal("neutral"),
          Type.Literal("cancelled"),
        ],
        { description: "Outcome status (default: 'pending')" }
      )
    ),
    tx_hash: Type.Optional(
      Type.String({ description: "Blockchain transaction hash (if applicable)" })
    ),
  }),
};

export const journalLogExecutor: ToolExecutor<JournalLogParams> = async (
  params,
  context
): Promise<ToolResult> => {
  const db = getDatabase().getDb();
  const store = new JournalStore(db);

  const entry = store.addEntry({
    type: params.type,
    action: params.action,
    asset_from: params.asset_from,
    asset_to: params.asset_to,
    amount_from: params.amount_from,
    amount_to: params.amount_to,
    price_ton: params.price_ton,
    counterparty: params.counterparty,
    platform: params.platform,
    reasoning: params.reasoning,
    outcome: params.outcome ?? "pending",
    tx_hash: params.tx_hash,
    tool_used: "journal_log",
    chat_id: context.chatId?.toString(),
    user_id: context.senderId,
  });

  // Format output
  const lines: string[] = [
    `📝 Journal Entry #${entry.id} logged`,
    ``,
    `**Type**: ${entry.type}`,
    `**Action**: ${entry.action}`,
  ];

  if (entry.asset_from || entry.asset_to) {
    const fromStr = entry.asset_from
      ? `${entry.amount_from?.toFixed(4) ?? "?"} ${entry.asset_from}`
      : "—";
    const toStr = entry.asset_to ? `${entry.amount_to?.toFixed(4) ?? "?"} ${entry.asset_to}` : "—";
    lines.push(`**Assets**: ${fromStr} → ${toStr}`);
  }

  if (entry.price_ton) {
    lines.push(`**Price**: ${entry.price_ton} TON`);
  }

  if (entry.counterparty) {
    lines.push(`**Counterparty**: ${entry.counterparty}`);
  }

  if (entry.platform) {
    lines.push(`**Platform**: ${entry.platform}`);
  }

  lines.push(`**Outcome**: ${entry.outcome}`);
  lines.push(`**Reasoning**: ${entry.reasoning}`);

  if (entry.tx_hash) {
    lines.push(`**TX**: \`${entry.tx_hash.slice(0, 16)}...\``);
  }

  lines.push(``, `_Logged at ${new Date(entry.created_at * 1000).toISOString()}_`);

  return {
    success: true,
    data: {
      entry,
      message: lines.join("\n"),
    },
  };
};
