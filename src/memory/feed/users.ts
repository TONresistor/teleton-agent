import type Database from "better-sqlite3";

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

/**
 * Manage Telegram users
 */
export class UserStore {
  constructor(private db: Database.Database) {}

  /**
   * Create or update a user
   */
  upsertUser(user: Partial<TelegramUser> & { id: string }): void {
    const now = Math.floor(Date.now() / 1000);

    // Check if user exists
    const existing = this.db.prepare(`SELECT id FROM tg_users WHERE id = ?`).get(user.id) as
      | { id: string }
      | undefined;

    if (existing) {
      // Update existing user
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
      // Insert new user
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

  /**
   * Get a user by ID
   */
  getUser(id: string): TelegramUser | undefined {
    const row = this.db.prepare(`SELECT * FROM tg_users WHERE id = ?`).get(id) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      isBot: Boolean(row.is_bot),
      isAdmin: Boolean(row.is_admin),
      isAllowed: Boolean(row.is_allowed),
      firstSeenAt: new Date(row.first_seen_at * 1000),
      lastSeenAt: new Date(row.last_seen_at * 1000),
      messageCount: row.message_count,
    };
  }

  /**
   * Get a user by username
   */
  getUserByUsername(username: string): TelegramUser | undefined {
    const row = this.db
      .prepare(`SELECT * FROM tg_users WHERE username = ?`)
      .get(username.replace("@", "")) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      isBot: Boolean(row.is_bot),
      isAdmin: Boolean(row.is_admin),
      isAllowed: Boolean(row.is_allowed),
      firstSeenAt: new Date(row.first_seen_at * 1000),
      lastSeenAt: new Date(row.last_seen_at * 1000),
      messageCount: row.message_count,
    };
  }

  /**
   * Update last seen timestamp
   */
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

  /**
   * Increment message count
   */
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

  /**
   * Set admin status
   */
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

  /**
   * Set allowed status
   */
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

  /**
   * Get all admins
   */
  getAdmins(): TelegramUser[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM tg_users
      WHERE is_admin = 1
      ORDER BY last_seen_at DESC
    `
      )
      .all() as any[];

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      isBot: Boolean(row.is_bot),
      isAdmin: Boolean(row.is_admin),
      isAllowed: Boolean(row.is_allowed),
      firstSeenAt: new Date(row.first_seen_at * 1000),
      lastSeenAt: new Date(row.last_seen_at * 1000),
      messageCount: row.message_count,
    }));
  }

  /**
   * Get recently active users
   */
  getRecentUsers(limit: number = 50): TelegramUser[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM tg_users
      ORDER BY last_seen_at DESC
      LIMIT ?
    `
      )
      .all(limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
      isBot: Boolean(row.is_bot),
      isAdmin: Boolean(row.is_admin),
      isAllowed: Boolean(row.is_allowed),
      firstSeenAt: new Date(row.first_seen_at * 1000),
      lastSeenAt: new Date(row.last_seen_at * 1000),
      messageCount: row.message_count,
    }));
  }
}
