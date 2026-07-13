import type { TelegramMessage } from "./bridge.js";
import { DEBOUNCE_MAX_MULTIPLIER, DEBOUNCE_MAX_BUFFER_SIZE } from "../constants/limits.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");

interface DebounceBuffer {
  messages: TelegramMessage[];
  timer: NodeJS.Timeout | null;
}

interface DebounceConfig {
  debounceMs: number;
  maxDebounceMs?: number;
  maxBufferSize?: number;
}

export class MessageDebouncer {
  private buffers: Map<string, DebounceBuffer> = new Map();
  private maxDebounceMs: number;
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

  updateDebounceMs(debounceMs: number): void {
    this.config = { ...this.config, debounceMs };
    this.maxDebounceMs = debounceMs * DEBOUNCE_MAX_MULTIPLIER;
    for (const [key, buffer] of this.buffers) this.resetTimer(key, buffer);
  }

  async enqueue(message: TelegramMessage): Promise<void> {
    const isGroup = message.isGroup ? "group" : "dm";
    const shouldDebounce = this.config.debounceMs > 0 && this.shouldDebounce(message);

    log.debug(
      `📩 [Debouncer] Received ${isGroup} message from ${message.senderId} in ${message.chatId} (debounce: ${shouldDebounce})`
    );

    if (!shouldDebounce) {
      const key = message.chatId;
      if (this.buffers.has(key)) {
        log.debug(`[Debouncer] Flushing pending buffer for ${key} before immediate processing`);
        await this.flushKey(key);
      }
      log.debug(`[Debouncer] Processing immediately (no debounce)`);
      await this.processMessages([message]);
      return;
    }

    const key = message.chatId;
    const existing = this.buffers.get(key);

    if (existing) {
      if (existing.messages.length >= this.maxBufferSize) {
        log.debug(
          `[Debouncer] Buffer full for ${key} (${existing.messages.length}/${this.maxBufferSize}), flushing`
        );
        await this.flushKey(key);
        const newBuffer: DebounceBuffer = { messages: [message], timer: null };
        this.buffers.set(key, newBuffer);
        this.resetTimer(key, newBuffer);
      } else {
        existing.messages.push(message);
        log.debug(
          `[Debouncer] Added to buffer for ${key} (${existing.messages.length} messages waiting)`
        );
        this.resetTimer(key, existing);
      }
    } else {
      const buffer: DebounceBuffer = {
        messages: [message],
        timer: null,
      };
      this.buffers.set(key, buffer);
      this.resetTimer(key, buffer);
    }
  }

  private resetTimer(key: string, buffer: DebounceBuffer): void {
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    // Clamp delay so total wait never exceeds maxDebounceMs
    const firstMsgTime = buffer.messages[0]?.timestamp?.getTime() ?? Date.now();
    const elapsed = Date.now() - firstMsgTime;
    const remaining = Math.max(0, this.maxDebounceMs - elapsed);
    const delay = Math.min(this.config.debounceMs, remaining);

    buffer.timer = setTimeout(() => {
      this.flushKey(key).catch((error) => {
        log.error({ err: error }, `Debouncer flush error for chat ${key}`);
        this.onError?.(error, buffer.messages);
      });
    }, delay);

    buffer.timer.unref?.();
  }

  private async flushKey(key: string): Promise<void> {
    const buffer = this.buffers.get(key);
    if (!buffer) {
      log.debug(`[Debouncer] No buffer to flush for ${key}`);
      return;
    }

    this.buffers.delete(key);

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    if (buffer.messages.length === 0) {
      log.debug(`[Debouncer] Empty buffer for ${key}, nothing to flush`);
      return;
    }

    log.debug(`[Debouncer] Flushing ${buffer.messages.length} message(s) for ${key}`);
    await this.processMessages(buffer.messages);
  }

  private async processMessages(messages: TelegramMessage[]): Promise<void> {
    const sorted = messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    log.debug(`[Debouncer] Processing ${sorted.length} message(s)`);

    try {
      await this.onFlush(sorted);
    } catch (error) {
      this.onError?.(error, sorted);
    }
  }

  async flushAll(): Promise<void> {
    const keys = Array.from(this.buffers.keys());
    for (const key of keys) {
      await this.flushKey(key);
    }
  }
}
