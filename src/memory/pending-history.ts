import type { TelegramMessage } from "../telegram/bridge.js";
import { PENDING_HISTORY_MAX_PER_CHAT, PENDING_HISTORY_MAX_AGE_MS } from "../constants/limits.js";
import { sanitizeForPrompt } from "../utils/sanitize.js";

export interface PendingMessage {
  id: number;
  senderId: number;
  senderName?: string;
  senderUsername?: string;
  senderRank?: string;
  text: string;
  timestamp: Date;
}

export class PendingHistory {
  private pendingMessages: Map<string, PendingMessage[]> = new Map();
  private static readonly MAX_PENDING_PER_CHAT = PENDING_HISTORY_MAX_PER_CHAT;
  private static readonly MAX_AGE_MS = PENDING_HISTORY_MAX_AGE_MS;
  addMessage(chatId: string, message: TelegramMessage): void {
    if (!this.pendingMessages.has(chatId)) {
      this.pendingMessages.set(chatId, []);
    }

    const pending = this.pendingMessages.get(chatId)!;

    const cutoff = Date.now() - PendingHistory.MAX_AGE_MS;
    const fresh = pending.filter((m) => m.timestamp.getTime() > cutoff);

    if (fresh.length >= PendingHistory.MAX_PENDING_PER_CHAT) {
      fresh.splice(0, fresh.length - PendingHistory.MAX_PENDING_PER_CHAT + 1);
    }

    fresh.push({
      id: message.id,
      senderId: message.senderId,
      senderName: message.senderFirstName,
      senderUsername: message.senderUsername,
      senderRank: message.senderRank,
      text: message.text,
      timestamp: message.timestamp,
    });

    this.pendingMessages.set(chatId, fresh);
  }
  getAndClearPending(chatId: string): string | null {
    const pending = this.pendingMessages.get(chatId);
    if (!pending || pending.length === 0) {
      return null;
    }

    const lines = pending.map((msg) => {
      let senderLabel: string;
      if (msg.senderName && msg.senderUsername) {
        senderLabel = `${sanitizeForPrompt(msg.senderName)} (@${sanitizeForPrompt(msg.senderUsername)})`;
      } else if (msg.senderName) {
        senderLabel = sanitizeForPrompt(msg.senderName);
      } else if (msg.senderUsername) {
        senderLabel = `@${sanitizeForPrompt(msg.senderUsername)}`;
      } else {
        senderLabel = `User:${msg.senderId}`;
      }
      if (msg.senderRank) {
        senderLabel = `[${sanitizeForPrompt(msg.senderRank)}] ${senderLabel}`;
      }
      const safeText = msg.text.replace(/<\/?user_message>/gi, "");
      return `${senderLabel}: <user_message>${safeText}</user_message>`;
    });

    this.pendingMessages.delete(chatId);

    return `[Chat messages since your last reply]\n${lines.join("\n")}`;
  }
  clearPending(chatId: string): void {
    this.pendingMessages.delete(chatId);
  }

  getPendingCount(chatId: string): number {
    return this.pendingMessages.get(chatId)?.length ?? 0;
  }

  hasPending(chatId: string): boolean {
    return this.getPendingCount(chatId) > 0;
  }
}
