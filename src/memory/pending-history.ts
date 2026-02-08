import type { TelegramMessage } from "../telegram/bridge.js";
import { PENDING_HISTORY_MAX_PER_CHAT, PENDING_HISTORY_MAX_AGE_MS } from "../constants/limits.js";

/**
 * Represents a pending message in a group chat
 */
export interface PendingMessage {
  id: number;
  senderId: number;
  senderName?: string;
  senderUsername?: string;
  text: string;
  timestamp: Date;
}

/**
 * Manages pending (unanswered) messages for group chats
 * When bot is mentioned in a group, includes all messages since last reply
 */
export class PendingHistory {
  private pendingMessages: Map<string, PendingMessage[]> = new Map();
  private static readonly MAX_PENDING_PER_CHAT = PENDING_HISTORY_MAX_PER_CHAT;
  private static readonly MAX_AGE_MS = PENDING_HISTORY_MAX_AGE_MS;

  /**
   * Add a message to pending history for a group
   */
  addMessage(chatId: string, message: TelegramMessage): void {
    if (!this.pendingMessages.has(chatId)) {
      this.pendingMessages.set(chatId, []);
    }

    const pending = this.pendingMessages.get(chatId)!;

    // Evict messages older than 24h
    const cutoff = Date.now() - PendingHistory.MAX_AGE_MS;
    const fresh = pending.filter((m) => m.timestamp.getTime() > cutoff);

    // Cap at MAX_PENDING_PER_CHAT (keep most recent)
    if (fresh.length >= PendingHistory.MAX_PENDING_PER_CHAT) {
      fresh.splice(0, fresh.length - PendingHistory.MAX_PENDING_PER_CHAT + 1);
    }

    fresh.push({
      id: message.id,
      senderId: message.senderId,
      senderName: message.senderFirstName,
      senderUsername: message.senderUsername,
      text: message.text,
      timestamp: message.timestamp,
    });

    this.pendingMessages.set(chatId, fresh);
  }

  /**
   * Get all pending messages for a group and clear them
   * Returns formatted string with [Chat messages since your last reply] marker
   */
  getAndClearPending(chatId: string): string | null {
    const pending = this.pendingMessages.get(chatId);
    if (!pending || pending.length === 0) {
      return null;
    }

    // Format pending messages with sender labels (Name (@username) format)
    const lines = pending.map((msg) => {
      let senderLabel: string;
      if (msg.senderName && msg.senderUsername) {
        senderLabel = `${msg.senderName} (@${msg.senderUsername})`;
      } else if (msg.senderName) {
        senderLabel = msg.senderName;
      } else if (msg.senderUsername) {
        senderLabel = `@${msg.senderUsername}`;
      } else {
        senderLabel = `User:${msg.senderId}`;
      }
      return `${senderLabel}: ${msg.text}`;
    });

    // Clear pending for this chat
    this.pendingMessages.delete(chatId);

    // Return with OpenClaw-style marker
    return `[Chat messages since your last reply]\n${lines.join("\n")}`;
  }

  /**
   * Clear pending messages for a group (after bot responds)
   */
  clearPending(chatId: string): void {
    this.pendingMessages.delete(chatId);
  }

  /**
   * Get count of pending messages for a group
   */
  getPendingCount(chatId: string): number {
    return this.pendingMessages.get(chatId)?.length ?? 0;
  }

  /**
   * Check if there are pending messages for a group
   */
  hasPending(chatId: string): boolean {
    return this.getPendingCount(chatId) > 0;
  }
}
