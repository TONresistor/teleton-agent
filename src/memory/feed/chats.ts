import type Database from "better-sqlite3";

export interface TelegramChat {
  id: string;
  type: "dm" | "group" | "channel";
  title?: string;
  username?: string;
  memberCount?: number;
  isMonitored: boolean;
  isArchived: boolean;
  lastMessageId?: string;
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Manage Telegram chats (DMs, groups, channels)
 */
export class ChatStore {
  constructor(private db: Database.Database) {}

  /**
   * Create or update a chat
   */
  upsertChat(chat: Partial<TelegramChat> & { id: string; type: string }): void {
    const now = Math.floor(Date.now() / 1000);

    this.db
      .prepare(
        `
      INSERT INTO tg_chats (
        id, type, title, username, member_count, is_monitored, is_archived,
        last_message_id, last_message_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = COALESCE(excluded.title, title),
        username = COALESCE(excluded.username, username),
        member_count = COALESCE(excluded.member_count, member_count),
        last_message_id = COALESCE(excluded.last_message_id, last_message_id),
        last_message_at = COALESCE(excluded.last_message_at, last_message_at),
        updated_at = excluded.updated_at
    `
      )
      .run(
        chat.id,
        chat.type,
        chat.title ?? null,
        chat.username ?? null,
        chat.memberCount ?? null,
        chat.isMonitored ?? 1,
        chat.isArchived ?? 0,
        chat.lastMessageId ?? null,
        chat.lastMessageAt ? Math.floor(chat.lastMessageAt.getTime() / 1000) : null,
        now,
        now
      );
  }

  /**
   * Get a chat by ID
   */
  getChat(id: string): TelegramChat | undefined {
    const row = this.db
      .prepare(
        `
      SELECT * FROM tg_chats WHERE id = ?
    `
      )
      .get(id) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      type: row.type,
      title: row.title,
      username: row.username,
      memberCount: row.member_count,
      isMonitored: Boolean(row.is_monitored),
      isArchived: Boolean(row.is_archived),
      lastMessageId: row.last_message_id,
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at * 1000) : undefined,
      createdAt: new Date(row.created_at * 1000),
      updatedAt: new Date(row.updated_at * 1000),
    };
  }

  /**
   * Get active (monitored, non-archived) chats
   */
  getActiveChats(limit: number = 50): TelegramChat[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM tg_chats
      WHERE is_monitored = 1 AND is_archived = 0
      ORDER BY last_message_at DESC NULLS LAST
      LIMIT ?
    `
      )
      .all(limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      username: row.username,
      memberCount: row.member_count,
      isMonitored: Boolean(row.is_monitored),
      isArchived: Boolean(row.is_archived),
      lastMessageId: row.last_message_id,
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at * 1000) : undefined,
      createdAt: new Date(row.created_at * 1000),
      updatedAt: new Date(row.updated_at * 1000),
    }));
  }

  /**
   * Update last message info
   */
  updateLastMessage(chatId: string, messageId: string, timestamp: Date): void {
    this.db
      .prepare(
        `
      UPDATE tg_chats
      SET last_message_id = ?, last_message_at = ?, updated_at = unixepoch()
      WHERE id = ?
    `
      )
      .run(messageId, Math.floor(timestamp.getTime() / 1000), chatId);
  }

  /**
   * Archive a chat
   */
  archiveChat(chatId: string): void {
    this.db
      .prepare(
        `
      UPDATE tg_chats
      SET is_archived = 1, updated_at = unixepoch()
      WHERE id = ?
    `
      )
      .run(chatId);
  }

  /**
   * Unarchive a chat
   */
  unarchiveChat(chatId: string): void {
    this.db
      .prepare(
        `
      UPDATE tg_chats
      SET is_archived = 0, updated_at = unixepoch()
      WHERE id = ?
    `
      )
      .run(chatId);
  }

  /**
   * Set monitoring status
   */
  setMonitored(chatId: string, monitored: boolean): void {
    this.db
      .prepare(
        `
      UPDATE tg_chats
      SET is_monitored = ?, updated_at = unixepoch()
      WHERE id = ?
    `
      )
      .run(monitored ? 1 : 0, chatId);
  }
}
