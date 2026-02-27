import type { TelegramConfig, Config } from "../config/schema.js";
import type { AgentRuntime } from "../agent/runtime.js";
import { TelegramBridge, type TelegramMessage } from "./bridge.js";
import { MessageStore, ChatStore, UserStore } from "../memory/feed/index.js";
import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import { readOffset, writeOffset } from "./offset-store.js";
import { PendingHistory } from "../memory/pending-history.js";
import { ToolRegistry } from "../agent/tools/registry.js";
import {
  telegramSendMessageTool,
  telegramSendMessageExecutor,
  telegramReactTool,
  telegramReactExecutor,
} from "../agent/tools/telegram/index.js";
import type { ToolContext } from "../agent/tools/types.js";
import { TELEGRAM_SEND_TOOLS } from "../constants/tools.js";
import { telegramTranscribeAudioExecutor } from "../agent/tools/telegram/media/transcribe-audio.js";
import { TYPING_REFRESH_MS } from "../constants/timeouts.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");
import type { PluginMessageEvent } from "@teleton-agent/sdk";

export interface MessageContext {
  message: TelegramMessage;
  isAdmin: boolean;
  shouldRespond: boolean;
  reason?: string;
}

class RateLimiter {
  private messageTimestamps: number[] = [];
  private groupTimestamps: Map<string, number[]> = new Map();

  constructor(
    private messagesPerSecond: number,
    private groupsPerMinute: number
  ) {}

  canSendMessage(): boolean {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    this.messageTimestamps = this.messageTimestamps.filter((t) => t > oneSecondAgo);

    if (this.messageTimestamps.length >= this.messagesPerSecond) {
      return false;
    }

    this.messageTimestamps.push(now);
    return true;
  }

  canSendToGroup(groupId: string): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    let timestamps = this.groupTimestamps.get(groupId) || [];
    timestamps = timestamps.filter((t) => t > oneMinuteAgo);

    if (timestamps.length >= this.groupsPerMinute) {
      this.groupTimestamps.set(groupId, timestamps);
      return false;
    }

    timestamps.push(now);
    this.groupTimestamps.set(groupId, timestamps);

    if (this.groupTimestamps.size > 100) {
      for (const [id, ts] of this.groupTimestamps) {
        if (ts.length === 0 || ts[ts.length - 1] <= oneMinuteAgo) {
          this.groupTimestamps.delete(id);
        }
      }
    }

    return true;
  }
}

class ChatQueue {
  private chains = new Map<string, Promise<void>>();

  enqueue(chatId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(chatId) ?? Promise.resolve();
    const next = prev
      .then(task, () => task())
      .finally(() => {
        // Auto-cleanup: remove entry if this is still the tail of the chain
        if (this.chains.get(chatId) === next) {
          this.chains.delete(chatId);
        }
      });

    // Register as new tail BEFORE awaiting (atomic in single-threaded JS)
    this.chains.set(chatId, next);
    return next;
  }

  /**
   * Wait for all active chains to complete (for graceful shutdown).
   */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
  }

  get activeChats(): number {
    return this.chains.size;
  }
}

export class MessageHandler {
  private bridge: TelegramBridge;
  private config: TelegramConfig;
  private fullConfig?: Config;
  private agent: AgentRuntime;
  private rateLimiter: RateLimiter;
  private lastProcessedMessageId: number;
  private messageStore: MessageStore;
  private chatStore: ChatStore;
  private userStore: UserStore;
  private ownUserId?: string;
  private pendingHistory: PendingHistory;
  private db: Database.Database;
  private chatQueue: ChatQueue = new ChatQueue();
  private pluginMessageHooks: Array<(e: PluginMessageEvent) => Promise<void>> = [];
  private recentMessageIds: Set<number> = new Set();
  private static readonly DEDUP_MAX_SIZE = 500;

  constructor(
    bridge: TelegramBridge,
    config: TelegramConfig,
    agent: AgentRuntime,
    db: Database.Database,
    embedder: EmbeddingProvider,
    vectorEnabled: boolean,
    fullConfig?: Config
  ) {
    this.bridge = bridge;
    this.config = config;
    this.fullConfig = fullConfig;
    this.agent = agent;
    this.db = db;
    this.rateLimiter = new RateLimiter(
      config.rate_limit_messages_per_second,
      config.rate_limit_groups_per_minute
    );

    this.messageStore = new MessageStore(db, embedder, vectorEnabled);
    this.chatStore = new ChatStore(db);
    this.userStore = new UserStore(db);
    this.pendingHistory = new PendingHistory();

    this.lastProcessedMessageId = 0;
  }

  setOwnUserId(userId: string | undefined): void {
    this.ownUserId = userId;
  }

  setPluginMessageHooks(hooks: Array<(e: PluginMessageEvent) => Promise<void>>): void {
    this.pluginMessageHooks = hooks;
  }

  async drain(): Promise<void> {
    await this.chatQueue.drain();
  }

  analyzeMessage(message: TelegramMessage): MessageContext {
    const isAdmin = this.config.admin_ids.includes(message.senderId);

    const chatOffset = readOffset(message.chatId) ?? 0;
    if (message.id <= chatOffset) {
      return {
        message,
        isAdmin,
        shouldRespond: false,
        reason: "Already processed",
      };
    }

    if (message.isBot) {
      return {
        message,
        isAdmin,
        shouldRespond: false,
        reason: "Sender is a bot",
      };
    }

    if (!message.isGroup && !message.isChannel) {
      switch (this.config.dm_policy) {
        case "disabled":
          return {
            message,
            isAdmin,
            shouldRespond: false,
            reason: "DMs disabled",
          };
        case "allowlist":
          if (!this.config.allow_from.includes(message.senderId) && !isAdmin) {
            return {
              message,
              isAdmin,
              shouldRespond: false,
              reason: "Not in allowlist",
            };
          }
          break;
        case "open":
          break;
      }

      return { message, isAdmin, shouldRespond: true };
    }

    if (message.isGroup) {
      switch (this.config.group_policy) {
        case "disabled":
          return {
            message,
            isAdmin,
            shouldRespond: false,
            reason: "Groups disabled",
          };
        case "allowlist":
          if (!this.config.group_allow_from.includes(parseInt(message.chatId))) {
            return {
              message,
              isAdmin,
              shouldRespond: false,
              reason: "Group not in allowlist",
            };
          }
          break;
        case "open":
          break;
      }

      // Check if we require mention
      if (this.config.require_mention && !message.mentionsMe) {
        return {
          message,
          isAdmin,
          shouldRespond: false,
          reason: "Not mentioned",
        };
      }

      return { message, isAdmin, shouldRespond: true };
    }

    return { message, isAdmin, shouldRespond: false, reason: "Unknown type" };
  }

  /**
   * Process and respond to a message
   */
  async handleMessage(message: TelegramMessage): Promise<void> {
    // 0. Dedup — GramJS may fire the same event multiple times via different MTProto update channels
    if (this.recentMessageIds.has(message.id)) {
      return;
    }
    this.recentMessageIds.add(message.id);
    if (this.recentMessageIds.size > MessageHandler.DEDUP_MAX_SIZE) {
      // Evict oldest half
      const ids = [...this.recentMessageIds];
      this.recentMessageIds = new Set(ids.slice(ids.length >> 1));
    }

    const msgType = message.isGroup ? "group" : message.isChannel ? "channel" : "dm";
    log.debug(
      `📨 [Handler] Received ${msgType} message ${message.id} from ${message.senderId} (mentions: ${message.mentionsMe})`
    );

    // 1. Store incoming message to feed FIRST (even if we won't respond)
    await this.storeTelegramMessage(message, false);

    // 1b. Fire plugin onMessage hooks (fire-and-forget, errors caught per plugin)
    if (this.pluginMessageHooks.length > 0) {
      const event: PluginMessageEvent = {
        chatId: message.chatId,
        senderId: message.senderId,
        senderUsername: message.senderUsername,
        text: message.text,
        isGroup: message.isGroup,
        hasMedia: message.hasMedia,
        messageId: message.id,
        timestamp: message.timestamp,
      };
      for (const hook of this.pluginMessageHooks) {
        hook(event).catch((err) => {
          log.error(
            { err: err instanceof Error ? err : undefined },
            `Plugin onMessage hook error: ${err instanceof Error ? err.message : err}`
          );
        });
      }
    }

    // 2. Analyze context (before locking)
    const context = this.analyzeMessage(message);

    // For groups: track pending messages even if we won't respond
    if (message.isGroup && !context.shouldRespond) {
      this.pendingHistory.addMessage(message.chatId, message);
    }

    if (!context.shouldRespond) {
      if (message.isGroup && context.reason === "Not mentioned") {
        const chatShort =
          message.chatId.length > 10
            ? message.chatId.slice(0, 7) + ".." + message.chatId.slice(-2)
            : message.chatId;
        log.info(`⏭️  Group ${chatShort} msg:${message.id} (not mentioned)`);
      } else {
        log.debug(`Skipping message ${message.id} from ${message.senderId}: ${context.reason}`);
      }
      return;
    }

    // 3. Check rate limits
    if (!this.rateLimiter.canSendMessage()) {
      log.debug("Rate limit reached, skipping message");
      return;
    }

    if (message.isGroup && !this.rateLimiter.canSendToGroup(message.chatId)) {
      log.debug(`Group rate limit reached for ${message.chatId}`);
      return;
    }

    // Enqueue for serial processing — messages wait their turn per chat
    await this.chatQueue.enqueue(message.chatId, async () => {
      try {
        // Re-check offset after queue wait to prevent duplicate processing
        // (GramJS may fire duplicate NewMessage events during reconnection)
        const postQueueOffset = readOffset(message.chatId) ?? 0;
        if (message.id <= postQueueOffset) {
          log.debug(`Skipping message ${message.id} (already processed after queue wait)`);
          return;
        }

        // 4. Persistent typing simulation if enabled
        let typingInterval: ReturnType<typeof setInterval> | undefined;
        if (this.config.typing_simulation) {
          await this.bridge.setTyping(message.chatId);
          typingInterval = setInterval(() => {
            void this.bridge.setTyping(message.chatId);
          }, TYPING_REFRESH_MS);
        }

        try {
          // 5. Get pending history for groups (if any)
          let pendingContext: string | null = null;
          if (message.isGroup) {
            pendingContext = this.pendingHistory.getAndClearPending(message.chatId);
          }

          // 5b. Resolve reply context (only for messages we're responding to)
          let replyContext: { text: string; senderName?: string; isAgent?: boolean } | undefined;
          if (message.replyToId && message._rawMessage) {
            const raw = await this.bridge.fetchReplyContext(message._rawMessage);
            if (raw?.text) {
              replyContext = { text: raw.text, senderName: raw.senderName, isAgent: raw.isAgent };
            }
          }

          // 5c. Auto-transcribe voice/audio messages
          let transcriptionText: string | null = null;
          if (message.mediaType === "voice" || message.mediaType === "audio") {
            try {
              const transcribeResult = await telegramTranscribeAudioExecutor(
                { chatId: message.chatId, messageId: message.id },
                {
                  bridge: this.bridge,
                  db: this.db,
                  chatId: message.chatId,
                  senderId: message.senderId,
                  isGroup: message.isGroup,
                  config: this.fullConfig,
                }
              );
              if (transcribeResult.success && (transcribeResult.data as any)?.text) {
                transcriptionText = (transcribeResult.data as any).text;
                log.info(
                  `🎤 Auto-transcribed voice msg ${message.id}: "${transcriptionText!.substring(0, 80)}..."`
                );
              }
            } catch (err) {
              log.warn({ err }, `Failed to auto-transcribe voice message ${message.id}`);
            }
          }

          // 6. Build tool context
          const toolContext: Omit<ToolContext, "chatId" | "isGroup"> = {
            bridge: this.bridge,
            db: this.db,
            senderId: message.senderId,
            config: this.fullConfig,
          };

          // 7. Get response from agent (with tools)
          const userName =
            message.senderFirstName || message.senderUsername || `user:${message.senderId}`;
          // Inject transcription into message text if available
          const effectiveText = transcriptionText
            ? `🎤 (voice): ${transcriptionText}${message.text ? `\n${message.text}` : ""}`
            : message.text;
          const response = await this.agent.processMessage(
            message.chatId,
            effectiveText,
            userName,
            message.timestamp.getTime(),
            message.isGroup,
            pendingContext,
            toolContext,
            message.senderUsername,
            message.hasMedia,
            message.mediaType,
            message.id,
            replyContext
          );

          // 8. Handle response based on whether tools were used
          const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;

          // Check if agent used any Telegram send tool - it already sent the message
          const telegramSendCalled =
            hasToolCalls && response.toolCalls?.some((tc) => TELEGRAM_SEND_TOOLS.has(tc.name));

          if (!telegramSendCalled && response.content && response.content.trim().length > 0) {
            // Agent returned text but didn't use the send tool - send it manually
            let responseText = response.content;

            // Truncate if needed
            if (responseText.length > this.config.max_message_length) {
              responseText = responseText.slice(0, this.config.max_message_length - 3) + "...";
            }

            const sentMessage = await this.bridge.sendMessage({
              chatId: message.chatId,
              text: responseText,
              replyToId: message.id,
            });

            // Store agent's response to feed
            await this.storeTelegramMessage(
              {
                id: sentMessage.id,
                chatId: message.chatId,
                senderId: this.ownUserId ? parseInt(this.ownUserId) : 0,
                text: responseText,
                isGroup: message.isGroup,
                isChannel: message.isChannel,
                isBot: false,
                mentionsMe: false,
                timestamp: new Date(sentMessage.date * 1000),
                hasMedia: false,
              },
              true
            );
          }

          // 9. Clear pending history after responding (for groups)
          if (message.isGroup) {
            this.pendingHistory.clearPending(message.chatId);
          }

          // Mark as processed AFTER successful handling (prevents message loss on crash)
          writeOffset(message.id, message.chatId);
        } finally {
          if (typingInterval) clearInterval(typingInterval);
        }

        log.debug(`Processed message ${message.id} in chat ${message.chatId}`);
      } catch (error) {
        log.error({ err: error }, "Error handling message");
      }
    });
  }

  /**
   * Store Telegram message to feed (with chat/user tracking)
   */
  private async storeTelegramMessage(
    message: TelegramMessage,
    isFromAgent: boolean
  ): Promise<void> {
    try {
      // 1. Upsert chat
      this.chatStore.upsertChat({
        id: message.chatId,
        type: message.isChannel ? "channel" : message.isGroup ? "group" : "dm",
        lastMessageId: message.id.toString(),
        lastMessageAt: message.timestamp,
      });

      // 2. Upsert user (sender)
      if (!isFromAgent && message.senderId) {
        this.userStore.upsertUser({
          id: message.senderId.toString(),
          username: message.senderUsername,
          firstName: message.senderFirstName,
        });
        this.userStore.incrementMessageCount(message.senderId.toString());
      }

      // 3. Store message
      await this.messageStore.storeMessage({
        id: message.id.toString(),
        chatId: message.chatId,
        senderId: message.senderId?.toString() ?? null,
        text: message.text,
        replyToId: message.replyToId?.toString(),
        isFromAgent,
        hasMedia: message.hasMedia,
        mediaType: message.mediaType,
        timestamp: Math.floor(message.timestamp.getTime() / 1000),
      });
    } catch (error) {
      log.error({ err: error }, "Error storing message to feed");
    }
  }

  /**
   * Get last processed message ID
   */
  getLastProcessedMessageId(): number {
    return this.lastProcessedMessageId;
  }
}
