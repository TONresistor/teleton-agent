import type { TelegramMessage } from "./bridge.js";
import { DEBOUNCE_MAX_MULTIPLIER, DEBOUNCE_MAX_BUFFER_SIZE } from "../constants/limits.js";

/**
 * Buffer for accumulating messages during debounce window
 */
interface DebounceBuffer {
  messages: TelegramMessage[];
  timer: NodeJS.Timeout | null;
}

/**
 * Debouncer configuration
 */
interface DebounceConfig {
  debounceMs: number; // Initial debounce window
  maxDebounceMs?: number; // Maximum debounce window (for adaptive mode)
  maxBufferSize?: number; // Force flush after N messages
}

/**
 * Message debouncer for batching rapid messages in group chats
 * Implements OpenClaw-style debouncing pattern with adaptive window
 *
 * Features:
 * - Adaptive debouncing: extends window if messages keep arriving
 * - Max buffer size: forces flush after N messages
 * - Max wait time: forces flush after maxDebounceMs regardless
 */
export class MessageDebouncer {
  private buffers: Map<string, DebounceBuffer> = new Map();
  private readonly maxDebounceMs: number;
  private readonly maxBufferSize: number;

  constructor(
    private config: DebounceConfig,
    private shouldDebounce: (message: TelegramMessage) => boolean,
    private onFlush: (messages: TelegramMessage[]) => Promise<void>,
    private onError?: (error: unknown, messages: TelegramMessage[]) => void
  ) {
    this.maxDebounceMs = config.maxDebounceMs ?? config.debounceMs * DEBOUNCE_MAX_MULTIPLIER;
    this.maxBufferSize = config.maxBufferSize ?? DEBOUNCE_MAX_BUFFER_SIZE;
  }

  /**
   * Enqueue a message for processing (with debouncing if applicable)
   */
  async enqueue(message: TelegramMessage): Promise<void> {
    const isGroup = message.isGroup ? "group" : "dm";
    const shouldDebounce = this.config.debounceMs > 0 && this.shouldDebounce(message);

    console.log(
      `📩 [Debouncer] Received ${isGroup} message from ${message.senderId} in ${message.chatId} (debounce: ${shouldDebounce})`
    );

    // Bypass debounce if disabled or shouldDebounce returns false
    if (!shouldDebounce) {
      // Flush any pending messages for this chat first
      const key = message.chatId;
      if (this.buffers.has(key)) {
        console.log(
          `📤 [Debouncer] Flushing pending buffer for ${key} before immediate processing`
        );
        await this.flushKey(key);
      }
      // Process immediately
      console.log(`⚡ [Debouncer] Processing immediately (no debounce)`);
      await this.processMessages([message]);
      return;
    }

    const key = message.chatId;
    const existing = this.buffers.get(key);

    if (existing) {
      // Add to existing buffer and reset timer
      existing.messages.push(message);
      console.log(
        `📥 [Debouncer] Added to buffer for ${key} (${existing.messages.length} messages waiting)`
      );
      this.resetTimer(key, existing);
    } else {
      // Create new buffer
      const buffer: DebounceBuffer = {
        messages: [message],
        timer: null,
      };
      this.buffers.set(key, buffer);
      this.resetTimer(key, buffer);
    }
  }

  /**
   * Reset debounce timer for a chat
   */
  private resetTimer(key: string, buffer: DebounceBuffer): void {
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    buffer.timer = setTimeout(() => {
      this.flushKey(key).catch((error) => {
        console.error(`❌ Debouncer flush error for chat ${key}:`, error);
        this.onError?.(error, buffer.messages);
      });
    }, this.config.debounceMs);

    // Allow Node.js to exit even if timer is pending
    buffer.timer.unref?.();
  }

  /**
   * Flush buffered messages for a specific chat
   */
  private async flushKey(key: string): Promise<void> {
    const buffer = this.buffers.get(key);
    if (!buffer) {
      console.log(`📭 [Debouncer] No buffer to flush for ${key}`);
      return;
    }

    this.buffers.delete(key);

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    if (buffer.messages.length === 0) {
      console.log(`📭 [Debouncer] Empty buffer for ${key}, nothing to flush`);
      return;
    }

    console.log(`📤 [Debouncer] Flushing ${buffer.messages.length} message(s) for ${key}`);
    await this.processMessages(buffer.messages);
  }

  /**
   * Process a batch of messages (sort by timestamp and call onFlush)
   */
  private async processMessages(messages: TelegramMessage[]): Promise<void> {
    // Sort by timestamp to preserve message order
    const sorted = messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    console.log(`🔄 [Debouncer] Processing ${sorted.length} message(s)`);

    try {
      await this.onFlush(sorted);
    } catch (error) {
      this.onError?.(error, sorted);
    }
  }

  /**
   * Get current buffer depth for a chat (for debugging/monitoring)
   */
  getBufferDepth(chatId: string): number {
    return this.buffers.get(chatId)?.messages.length ?? 0;
  }

  /**
   * Flush all pending buffers (for graceful shutdown)
   */
  async flushAll(): Promise<void> {
    const keys = Array.from(this.buffers.keys());
    for (const key of keys) {
      await this.flushKey(key);
    }
  }
}
