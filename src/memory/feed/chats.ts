import type Database from "better-sqlite3";
import type { TgChatRow } from "../types/db-rows.js";

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

function rowToChat(row: TgChatRow): TelegramChat {
  return {
    id: row.id,
    type: row.type as TelegramChat["type"],
    title: row.title ?? undefined,
    username: row.username ?? undefined,
    memberCount: row.member_count ?? undefined,
    isMonitored: Boolean(row.is_monitored),
    isArchived: Boolean(row.is_archived),
    lastMessageId: row.last_message_id ?? undefined,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at * 1000) : undefined,
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
  };
}

export class ChatStore {
  constructor(private db: Database.Database) {}

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

  getChat(id: string): TelegramChat | undefined {
    const row = this.db
      .prepare(
        `
      SELECT * FROM tg_chats WHERE id = ?
    `
      )
      .get(id) as TgChatRow | undefined;

    return row ? rowToChat(row) : undefined;
  }

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
      .all(limit) as TgChatRow[];

    return rows.map(rowToChat);
  }

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
