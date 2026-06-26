import type Database from "better-sqlite3";
import type { TgUserRow } from "../types/db-rows.js";

export interface TelegramUser {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  isBot: boolean;
  isAdmin: boolean;
  isAllowed: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  messageCount: number;
}

function rowToUser(row: TgUserRow): TelegramUser {
  return {
    id: row.id,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    isBot: Boolean(row.is_bot),
    isAdmin: Boolean(row.is_admin),
    isAllowed: Boolean(row.is_allowed),
    firstSeenAt: new Date(row.first_seen_at * 1000),
    lastSeenAt: new Date(row.last_seen_at * 1000),
    messageCount: row.message_count,
  };
}

export class UserStore {
  constructor(private db: Database.Database) {}

  upsertUser(user: Partial<TelegramUser> & { id: string }): void {
    const now = Math.floor(Date.now() / 1000);

    const existing = this.db.prepare(`SELECT id FROM tg_users WHERE id = ?`).get(user.id) as
      | { id: string }
      | undefined;

    if (existing) {
      this.db
        .prepare(
          `
        UPDATE tg_users
        SET
          username = COALESCE(?, username),
          first_name = COALESCE(?, first_name),
          last_name = COALESCE(?, last_name),
          last_seen_at = ?
        WHERE id = ?
      `
        )
        .run(user.username ?? null, user.firstName ?? null, user.lastName ?? null, now, user.id);
    } else {
      this.db
        .prepare(
          `
        INSERT INTO tg_users (
          id, username, first_name, last_name, is_bot, is_admin, is_allowed,
          first_seen_at, last_seen_at, message_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          user.id,
          user.username ?? null,
          user.firstName ?? null,
          user.lastName ?? null,
          user.isBot ?? 0,
          user.isAdmin ?? 0,
          user.isAllowed ?? 0,
          now,
          now,
          0
        );
    }
  }

  getUser(id: string): TelegramUser | undefined {
    const row = this.db.prepare(`SELECT * FROM tg_users WHERE id = ?`).get(id) as
      | TgUserRow
      | undefined;

    return row ? rowToUser(row) : undefined;
  }

  getUserByUsername(username: string): TelegramUser | undefined {
    const row = this.db
      .prepare(`SELECT * FROM tg_users WHERE username = ?`)
      .get(username.replace("@", "")) as TgUserRow | undefined;

    return row ? rowToUser(row) : undefined;
  }

  updateLastSeen(userId: string): void {
    this.db
      .prepare(
        `
      UPDATE tg_users
      SET last_seen_at = unixepoch()
      WHERE id = ?
    `
      )
      .run(userId);
  }

  incrementMessageCount(userId: string): void {
    this.db
      .prepare(
        `
      UPDATE tg_users
      SET message_count = message_count + 1, last_seen_at = unixepoch()
      WHERE id = ?
    `
      )
      .run(userId);
  }

  setAdmin(userId: string, isAdmin: boolean): void {
    this.db
      .prepare(
        `
      UPDATE tg_users
      SET is_admin = ?
      WHERE id = ?
    `
      )
      .run(isAdmin ? 1 : 0, userId);
  }

  setAllowed(userId: string, isAllowed: boolean): void {
    this.db
      .prepare(
        `
      UPDATE tg_users
      SET is_allowed = ?
      WHERE id = ?
    `
      )
      .run(isAllowed ? 1 : 0, userId);
  }

  getAdmins(): TelegramUser[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM tg_users
      WHERE is_admin = 1
      ORDER BY last_seen_at DESC
    `
      )
      .all() as TgUserRow[];

    return rows.map(rowToUser);
  }

  getRecentUsers(limit: number = 50): TelegramUser[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM tg_users
      ORDER BY last_seen_at DESC
      LIMIT ?
    `
      )
      .all(limit) as TgUserRow[];

    return rows.map(rowToUser);
  }
}
