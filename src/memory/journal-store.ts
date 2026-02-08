/**
 * Journal Store - CRUD operations for business journal
 * Tracks: trades, gifts, middleman, KOL services
 */

import { SECONDS_PER_DAY } from "../constants/limits.js";
import type Database from "better-sqlite3";

export type JournalType = "trade" | "gift" | "middleman" | "kol";
export type JournalOutcome = "pending" | "profit" | "loss" | "neutral" | "cancelled";

export interface JournalEntry {
  id: number;
  timestamp: number;
  type: JournalType;
  action: string;
  asset_from?: string;
  asset_to?: string;
  amount_from?: number;
  amount_to?: number;
  price_ton?: number;
  counterparty?: string;
  platform?: string;
  reasoning?: string;
  outcome?: JournalOutcome;
  pnl_ton?: number;
  pnl_pct?: number;
  tx_hash?: string;
  tool_used?: string;
  chat_id?: string;
  user_id?: number;
  closed_at?: number;
  created_at: number;
}

export interface AddEntryParams {
  type: JournalType;
  action: string;
  asset_from?: string;
  asset_to?: string;
  amount_from?: number;
  amount_to?: number;
  price_ton?: number;
  counterparty?: string;
  platform?: string;
  reasoning?: string;
  outcome?: JournalOutcome;
  tx_hash?: string;
  tool_used?: string;
  chat_id?: string;
  user_id?: number;
}

export interface UpdateEntryParams {
  id: number;
  outcome?: JournalOutcome;
  pnl_ton?: number;
  pnl_pct?: number;
  tx_hash?: string;
  closed_at?: number;
}

export interface QueryParams {
  type?: JournalType;
  asset?: string;
  outcome?: JournalOutcome;
  days?: number;
  limit?: number;
}

export class JournalStore {
  constructor(private db: Database.Database) {
    // Ensure journal table exists (for databases created before journal feature)
    this.ensureTable();
  }

  /**
   * Ensure journal table exists
   */
  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
        type TEXT NOT NULL CHECK(type IN ('trade', 'gift', 'middleman', 'kol')),
        action TEXT NOT NULL,
        asset_from TEXT,
        asset_to TEXT,
        amount_from REAL,
        amount_to REAL,
        price_ton REAL,
        counterparty TEXT,
        platform TEXT,
        reasoning TEXT,
        outcome TEXT CHECK(outcome IN ('pending', 'profit', 'loss', 'neutral', 'cancelled')),
        pnl_ton REAL,
        pnl_pct REAL,
        tx_hash TEXT,
        tool_used TEXT,
        chat_id TEXT,
        user_id INTEGER,
        closed_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_journal_type ON journal(type);
      CREATE INDEX IF NOT EXISTS idx_journal_timestamp ON journal(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_journal_asset_from ON journal(asset_from);
      CREATE INDEX IF NOT EXISTS idx_journal_outcome ON journal(outcome);
      CREATE INDEX IF NOT EXISTS idx_journal_type_timestamp ON journal(type, timestamp DESC);
    `);
  }

  /**
   * Add a new journal entry
   */
  addEntry(params: AddEntryParams): JournalEntry {
    const stmt = this.db.prepare(`
      INSERT INTO journal (
        type, action, asset_from, asset_to, amount_from, amount_to,
        price_ton, counterparty, platform, reasoning, outcome, tx_hash,
        tool_used, chat_id, user_id
      ) VALUES (
        @type, @action, @asset_from, @asset_to, @amount_from, @amount_to,
        @price_ton, @counterparty, @platform, @reasoning, @outcome, @tx_hash,
        @tool_used, @chat_id, @user_id
      )
    `);

    const info = stmt.run({
      type: params.type,
      action: params.action,
      asset_from: params.asset_from ?? null,
      asset_to: params.asset_to ?? null,
      amount_from: params.amount_from ?? null,
      amount_to: params.amount_to ?? null,
      price_ton: params.price_ton ?? null,
      counterparty: params.counterparty ?? null,
      platform: params.platform ?? null,
      reasoning: params.reasoning ?? null,
      outcome: params.outcome ?? "pending",
      tx_hash: params.tx_hash ?? null,
      tool_used: params.tool_used ?? null,
      chat_id: params.chat_id ?? null,
      user_id: params.user_id ?? null,
    });

    return this.getEntryById(info.lastInsertRowid as number)!;
  }

  /**
   * Get a single entry by ID
   */
  getEntryById(id: number): JournalEntry | null {
    const stmt = this.db.prepare("SELECT * FROM journal WHERE id = ?");
    return stmt.get(id) as JournalEntry | null;
  }

  /**
   * Update an existing entry (outcome, P&L, tx_hash)
   */
  updateEntry(params: UpdateEntryParams): JournalEntry | null {
    const updates: string[] = [];
    const values: Record<string, any> = { id: params.id };

    if (params.outcome !== undefined) {
      updates.push("outcome = @outcome");
      values.outcome = params.outcome;
    }
    if (params.pnl_ton !== undefined) {
      updates.push("pnl_ton = @pnl_ton");
      values.pnl_ton = params.pnl_ton;
    }
    if (params.pnl_pct !== undefined) {
      updates.push("pnl_pct = @pnl_pct");
      values.pnl_pct = params.pnl_pct;
    }
    if (params.tx_hash !== undefined) {
      updates.push("tx_hash = @tx_hash");
      values.tx_hash = params.tx_hash;
    }
    if (params.closed_at !== undefined) {
      updates.push("closed_at = @closed_at");
      values.closed_at = params.closed_at;
    }

    if (updates.length === 0) {
      return this.getEntryById(params.id);
    }

    const stmt = this.db.prepare(`
      UPDATE journal
      SET ${updates.join(", ")}
      WHERE id = @id
    `);

    stmt.run(values);
    return this.getEntryById(params.id);
  }

  /**
   * Query entries with filters
   */
  queryEntries(params: QueryParams = {}): JournalEntry[] {
    const conditions: string[] = [];
    const values: Record<string, any> = {};

    if (params.type) {
      conditions.push("type = @type");
      values.type = params.type;
    }

    if (params.asset) {
      conditions.push("(asset_from = @asset OR asset_to = @asset)");
      values.asset = params.asset;
    }

    if (params.outcome) {
      conditions.push("outcome = @outcome");
      values.outcome = params.outcome;
    }

    if (params.days) {
      const cutoff = Math.floor(Date.now() / 1000) - params.days * SECONDS_PER_DAY;
      conditions.push("timestamp >= @cutoff");
      values.cutoff = cutoff;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitClause = params.limit ? `LIMIT ${params.limit}` : "";

    const stmt = this.db.prepare(`
      SELECT * FROM journal
      ${whereClause}
      ORDER BY timestamp DESC
      ${limitClause}
    `);

    return stmt.all(values) as JournalEntry[];
  }

  /**
   * Get all entries (with optional limit)
   */
  getAllEntries(limit?: number): JournalEntry[] {
    const limitClause = limit ? `LIMIT ${limit}` : "";
    const stmt = this.db.prepare(`
      SELECT * FROM journal
      ORDER BY timestamp DESC
      ${limitClause}
    `);
    return stmt.all() as JournalEntry[];
  }

  /**
   * Calculate P&L summary for a given period
   */
  calculatePnL(params: { type?: JournalType; days?: number } = {}): {
    total_pnl: number;
    trades_count: number;
    profit_count: number;
    loss_count: number;
    win_rate: number;
  } {
    const conditions: string[] = ["outcome IN ('profit', 'loss')"];
    const values: Record<string, any> = {};

    if (params.type) {
      conditions.push("type = @type");
      values.type = params.type;
    }

    if (params.days) {
      const cutoff = Math.floor(Date.now() / 1000) - params.days * SECONDS_PER_DAY;
      conditions.push("timestamp >= @cutoff");
      values.cutoff = cutoff;
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const stmt = this.db.prepare(`
      SELECT
        COALESCE(SUM(pnl_ton), 0) as total_pnl,
        COUNT(*) as trades_count,
        SUM(CASE WHEN outcome = 'profit' THEN 1 ELSE 0 END) as profit_count,
        SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) as loss_count
      FROM journal
      ${whereClause}
    `);

    const result = stmt.get(values) as {
      total_pnl: number;
      trades_count: number;
      profit_count: number;
      loss_count: number;
    };

    const win_rate =
      result.trades_count > 0 ? (result.profit_count / result.trades_count) * 100 : 0;

    return {
      ...result,
      win_rate,
    };
  }

  /**
   * Get pending entries (outcome = 'pending')
   */
  getPendingEntries(type?: JournalType): JournalEntry[] {
    const whereClause = type
      ? "WHERE outcome = 'pending' AND type = ?"
      : "WHERE outcome = 'pending'";
    const stmt = this.db.prepare(`
      SELECT * FROM journal
      ${whereClause}
      ORDER BY timestamp DESC
    `);

    return type ? (stmt.all(type) as JournalEntry[]) : (stmt.all() as JournalEntry[]);
  }
}
