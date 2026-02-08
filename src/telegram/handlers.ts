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
import { MESSAGE_HANDLER_LOCK_TIMEOUT_MS } from "../constants/timeouts.js";

export interface MessageContext {
  message: TelegramMessage;
  isAdmin: boolean;
  shouldRespond: boolean;
  reason?: string;
}

/**
 * Rate limiter for message sending
 */
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

    // Clean old timestamps
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
      return false;
    }

    timestamps.push(now);
    this.groupTimestamps.set(groupId, timestamps);
    return true;
  }
}

/**
 * Per-chat lock to prevent concurrent message processing
 * This avoids race conditions where tool_results get orphaned
 *
 * Messages wait for the lock and are processed one by one.
 */
class ChatLock {
  private locks: Map<string, { promise: Promise<void>; acquiredAt: number }> = new Map();
  private readonly LOCK_TIMEOUT_MS = MESSAGE_HANDLER_LOCK_TIMEOUT_MS;

  async acquire(chatId: string): Promise<() => void> {
    // Check for existing lock
    const existing = this.locks.get(chatId);
    if (existing) {
      const age = Date.now() - existing.acquiredAt;

      // Force release stale locks (older than timeout)
      if (age > this.LOCK_TIMEOUT_MS) {
        console.warn(`⚠️ Stale lock detected for chat ${chatId}, forcing release (age: ${age}ms)`);
        this.locks.delete(chatId);
      } else {
        // Wait for lock with timeout
        const timeout = this.LOCK_TIMEOUT_MS - age;
        await Promise.race([
          existing.promise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Lock timeout for ${chatId}`)), timeout)
          ),
        ]).catch((err) => {
          console.error(`Lock wait timeout for ${chatId}:`, err);
          this.locks.delete(chatId); // Force release on timeout
        });
      }
    }

    // Create a new lock
    let release: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lockEntry = {
      promise: lockPromise,
      acquiredAt: Date.now(),
    };
    this.locks.set(chatId, lockEntry);

    // Return release function (only releases if we still own the lock)
    return () => {
      if (this.locks.get(chatId) === lockEntry) {
        this.locks.delete(chatId);
      }
      release!();
    };
  }
}

/**
 * Handles incoming Telegram messages and decides when to respond
 */
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
  private marketService?: any;
  private chatLock: ChatLock = new ChatLock();

  constructor(
    bridge: TelegramBridge,
    config: TelegramConfig,
    agent: AgentRuntime,
    db: Database.Database,
    embedder: EmbeddingProvider,
    vectorEnabled: boolean,
    marketService?: any,
    fullConfig?: Config
  ) {
    this.bridge = bridge;
    this.config = config;
    this.fullConfig = fullConfig;
    this.agent = agent;
    this.db = db;
    this.marketService = marketService;
    this.rateLimiter = new RateLimiter(
      config.rate_limit_messages_per_second,
      config.rate_limit_groups_per_minute
    );

    // Initialize stores
    this.messageStore = new MessageStore(db, embedder, vectorEnabled);
    this.chatStore = new ChatStore(db);
    this.userStore = new UserStore(db);
    this.pendingHistory = new PendingHistory();

    // lastProcessedMessageId is now per-chat, loaded dynamically
    this.lastProcessedMessageId = 0;

    // ownUserId will be set after connection via setOwnUserId()
  }

  /**
   * Set own user ID after connection
   */
  setOwnUserId(userId: string | undefined): void {
    this.ownUserId = userId;
  }

  /**
   * Analyze message context and decide if we should respond
   */
  analyzeMessage(message: TelegramMessage): MessageContext {
    const isAdmin = this.config.admin_ids.includes(message.senderId);

    // Skip if already processed (based on per-chat offset)
    const chatOffset = readOffset(message.chatId) ?? 0;
    if (message.id <= chatOffset) {
      return {
        message,
        isAdmin,
        shouldRespond: false,
        reason: "Already processed",
      };
    }

    // Skip messages from bots in groups (avoid bot-to-bot loops)
    if (message.isGroup && message.isBot) {
      return {
        message,
        isAdmin,
        shouldRespond: false,
        reason: "Sender is a bot",
      };
    }

    // DM handling
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
        case "pairing":
          // Pairing logic would go here
          // For now, treat like allowlist
          if (!this.config.allow_from.includes(message.senderId) && !isAdmin) {
            return {
              message,
              isAdmin,
              shouldRespond: false,
              reason: "Not paired",
            };
          }
          break;
        case "open":
          break;
      }

      return { message, isAdmin, shouldRespond: true };
    }

    // Group/Channel handling
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
    const msgType = message.isGroup ? "group" : message.isChannel ? "channel" : "dm";
    console.log(
      `📨 [Handler] Received ${msgType} message ${message.id} from ${message.senderId} (mentions: ${message.mentionsMe})`
    );

    // 1. Store incoming message to feed FIRST (even if we won't respond)
    await this.storeTelegramMessage(message, false);

    // 2. Analyze context (before locking)
    const context = this.analyzeMessage(message);

    // For groups: track pending messages even if we won't respond
    if (message.isGroup && !context.shouldRespond) {
      this.pendingHistory.addMessage(message.chatId, message);
    }

    if (!context.shouldRespond) {
      console.log(`Skipping message ${message.id} from ${message.senderId}: ${context.reason}`);
      return;
    }

    // 3. Check rate limits
    if (!this.rateLimiter.canSendMessage()) {
      console.log("Rate limit reached, skipping message");
      return;
    }

    if (message.isGroup && !this.rateLimiter.canSendToGroup(message.chatId)) {
      console.log(`Group rate limit reached for ${message.chatId}`);
      return;
    }

    // ACQUIRE CHAT LOCK - messages wait their turn and are processed one by one
    const releaseLock = await this.chatLock.acquire(message.chatId);

    try {
      // 4. Typing simulation if enabled
      if (this.config.typing_simulation) {
        await this.bridge.setTyping(message.chatId);
      }

      // 5. Get pending history for groups (if any)
      let pendingContext: string | null = null;
      if (message.isGroup) {
        pendingContext = this.pendingHistory.getAndClearPending(message.chatId);
      }

      // 6. Build tool context
      const toolContext: Omit<ToolContext, "chatId" | "isGroup"> = {
        bridge: this.bridge,
        db: this.db,
        senderId: message.senderId,
        marketService: this.marketService,
        config: this.fullConfig,
      };

      // 7. Get response from agent (with tools)
      const userName =
        message.senderFirstName || message.senderUsername || `user:${message.senderId}`;
      const response = await this.agent.processMessage(
        message.chatId,
        message.text,
        userName,
        message.timestamp.getTime(),
        message.isGroup,
        pendingContext,
        toolContext,
        message.senderUsername,
        message.hasMedia,
        message.mediaType,
        message.id
      );

      // 8. Handle response based on whether tools were used
      const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;

      // Tools that send content to Telegram - no additional text response needed
      const telegramSendTools = [
        "telegram_send_message",
        "telegram_send_gif",
        "telegram_send_voice",
        "telegram_send_sticker",
        "telegram_send_document",
        "telegram_send_photo",
        "telegram_send_video",
        "telegram_send_poll",
        "telegram_forward_message",
        "telegram_reply_message",
        "deal_propose",
      ];

      // Check if agent used any Telegram send tool - it already sent the message
      const telegramSendCalled =
        hasToolCalls && response.toolCalls?.some((tc) => telegramSendTools.includes(tc.name));

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
            isBot: false, // Agent is not a bot (user client)
            mentionsMe: false,
            timestamp: new Date(sentMessage.date * 1000),
            hasMedia: false, // Agent responses don't have media
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

      console.log(`Processed message ${message.id} in chat ${message.chatId}`);
    } catch (error) {
      console.error("Error handling message:", error);
    } finally {
      // RELEASE CHAT LOCK - always release even on error
      releaseLock();
    }
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
        replyToId: undefined,
        isFromAgent,
        hasMedia: message.hasMedia,
        mediaType: message.mediaType,
        timestamp: Math.floor(message.timestamp.getTime() / 1000),
      });
    } catch (error) {
      console.error("Error storing message to feed:", error);
    }
  }

  /**
   * Get last processed message ID
   */
  getLastProcessedMessageId(): number {
    return this.lastProcessedMessageId;
  }
}
