import type { TelegramConfig, Config } from "../config/schema.js";
import type { AgentRuntime } from "../agent/runtime.js";
import type { ITelegramBridge } from "./bridge-interface.js";
import { type TelegramMessage } from "./bridge.js";
import { MessageStore, ChatStore, UserStore } from "../memory/feed/index.js";
import type Database from "better-sqlite3";
import type { EmbeddingProvider } from "../memory/embeddings/provider.js";
import { readOffset, writeOffset } from "./offset-store.js";
import { PendingHistory } from "../memory/pending-history.js";
import type { ToolContext } from "../agent/tools/types.js";
import { isSilentReply } from "../constants/tokens.js";
import { deliveredTelegramText } from "../agent/telegram-send-state.js";
import { transcribeAudio } from "../sdk/telegram-utils.js";
import { TYPING_REFRESH_MS } from "../constants/timeouts.js";
import { createLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/errors.js";

const log = createLogger("Telegram");
import type { PluginMessageEvent } from "@teleton-agent/sdk";

function providerFailureReply(error: unknown): string {
  const message = getErrorMessage(error).toLowerCase();

  if (
    message.includes("usage limit") ||
    message.includes("insufficient_quota") ||
    message.includes("quota exceeded")
  ) {
    return "⚠️ The AI provider usage limit has been reached. Please try again later or switch providers.";
  }

  if (
    message.includes("rate limit") ||
    message.includes("rate_limited") ||
    /\b429\b/.test(message)
  ) {
    return "⚠️ The AI provider is temporarily rate-limited. Please try again in a moment.";
  }

  if (
    message.includes("authentication token is expired") ||
    message.includes("invalid authentication") ||
    /\b(?:401|unauthorized)\b/.test(message)
  ) {
    return "⚠️ The AI provider credentials are invalid or expired. Please refresh them and try again.";
  }

  return "⚠️ The AI provider is unavailable. Please try again later.";
}

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
  private activeTasks = 0;
  private maxConcurrent: number;
  private waitQueue: Array<() => void> = [];

  constructor(maxConcurrent = 10) {
    this.maxConcurrent = maxConcurrent;
  }

  private async acquireSlot(chatId: string): Promise<void> {
    if (this.activeTasks < this.maxConcurrent) {
      this.activeTasks++;
      return;
    }
    log.warn(
      `Backpressure: chat ${chatId} queued (${this.activeTasks}/${this.maxConcurrent} active)`
    );
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeTasks++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeTasks--;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  enqueue(chatId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(chatId) ?? Promise.resolve();
    const next = prev
      .then(
        () => this.acquireSlot(chatId).then(task),
        () => this.acquireSlot(chatId).then(task)
      )
      .finally(() => {
        this.releaseSlot();
        if (this.chains.get(chatId) === next) {
          this.chains.delete(chatId);
        }
      });

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
  private bridge: ITelegramBridge;
  private config: TelegramConfig;
  private fullConfig?: Config;
  private agent: AgentRuntime;
  private rateLimiter: RateLimiter;
  private messageStore: MessageStore;
  private chatStore: ChatStore;
  private userStore: UserStore;
  private ownUserId?: string;
  private pendingHistory: PendingHistory;
  private db: Database.Database;
  private chatQueue: ChatQueue = new ChatQueue();
  private pluginMessageHooks: Array<(e: PluginMessageEvent) => Promise<void>> = [];
  private recentMessageIds: Set<string> = new Set();
  private static readonly DEDUP_MAX_SIZE = 500;

  constructor(
    bridge: ITelegramBridge,
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
  }

  setOwnUserId(userId: string | undefined): void {
    this.ownUserId = userId;
  }

  setBridge(bridge: ITelegramBridge): void {
    log.info(`Swapping bridge to ${bridge.getMode()}`);
    this.bridge = bridge;
    const uid = bridge.getOwnUserId();
    this.ownUserId = uid !== undefined ? String(uid) : this.ownUserId;
  }

  setPluginMessageHooks(hooks: Array<(e: PluginMessageEvent) => Promise<void>>): void {
    this.pluginMessageHooks = hooks;
  }

  async drain(): Promise<void> {
    await this.chatQueue.drain();
  }

  analyzeMessage(message: TelegramMessage): MessageContext {
    const isAdmin = this.config.admin_ids.includes(message.senderId);

    // Bridges that redeliver (user mode) need handler-side dedup; bot mode dedupes via update_id.
    if (this.bridge.requiresOffsetDedup()) {
      const chatOffset = readOffset(message.chatId) ?? 0;
      if (message.id <= chatOffset) {
        return {
          message,
          isAdmin,
          shouldRespond: false,
          reason: "Already processed",
        };
      }
    }

    const ownSenderId = this.ownUserId ? Number(this.ownUserId) : undefined;
    if (
      ownSenderId !== undefined &&
      Number.isFinite(ownSenderId) &&
      message.senderId === ownSenderId
    ) {
      return {
        message,
        isAdmin,
        shouldRespond: false,
        reason: "Sender is self",
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
        case "admin-only":
          if (!isAdmin) {
            return {
              message,
              isAdmin,
              shouldRespond: false,
              reason: "DMs restricted to admins",
            };
          }
          break;
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
        case "admin-only":
          if (!isAdmin) {
            return {
              message,
              isAdmin,
              shouldRespond: false,
              reason: "Groups restricted to admins",
            };
          }
          break;
        case "allowlist":
          if (!this.config.group_allow_from.includes(parseInt(message.chatId, 10))) {
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
    const dedupKey = `${message.chatId}:${message.id}`;

    // 0. Dedup — GramJS may fire the same event multiple times via different MTProto update channels
    if (this.recentMessageIds.has(dedupKey)) {
      return;
    }
    this.recentMessageIds.add(dedupKey);
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
        hook(event).catch((error) => {
          log.error(
            { err: error instanceof Error ? error : undefined },
            `Plugin onMessage hook error: ${getErrorMessage(error)}`
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
        log.info(`Group ${chatShort} msg:${message.id} (not mentioned)`);
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
        // (GramJS may fire duplicate NewMessage events during reconnection).
        if (this.bridge.requiresOffsetDedup()) {
          const postQueueOffset = readOffset(message.chatId) ?? 0;
          if (message.id <= postQueueOffset) {
            log.debug(`Skipping message ${message.id} (already processed after queue wait)`);
            return;
          }
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
              const transcribeResult = await transcribeAudio(
                this.bridge,
                message.chatId,
                message.id
              );
              if (transcribeResult.text) {
                transcriptionText = transcribeResult.text;
                log.info(
                  { messageId: message.id, transcriptLength: transcriptionText.length },
                  "Voice message auto-transcribed"
                );
              }
            } catch (innerError) {
              log.warn(
                { err: innerError },
                `Failed to auto-transcribe voice message ${message.id}`
              );
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
          const streamMode = this.fullConfig?.telegram?.stream_mode ?? "all";
          const streamToChat =
            this.bridge.streamResponse && streamMode !== "off"
              ? {
                  chatId: message.chatId,
                  bridge: this.bridge,
                  mode: streamMode as "all" | "replace" | "off",
                }
              : undefined;

          let response: Awaited<ReturnType<AgentRuntime["processMessage"]>>;
          try {
            response = await this.agent.processMessage({
              chatId: message.chatId,
              userMessage: effectiveText,
              userName,
              timestamp: message.timestamp.getTime(),
              isGroup: message.isGroup,
              pendingContext,
              toolContext,
              senderUsername: message.senderUsername,
              senderRank: message.senderRank,
              hasMedia: message.hasMedia,
              mediaType: message.mediaType,
              messageId: message.id,
              replyContext,
              streamToChat,
            });
          } catch (error) {
            log.error({ err: error }, "Agent provider request failed");

            try {
              await this.bridge.sendMessage({
                chatId: message.chatId,
                text: providerFailureReply(error),
                replyToId: message.id,
              });

              if (this.bridge.requiresOffsetDedup()) {
                writeOffset(message.id, message.chatId);
              }
            } catch (notificationError) {
              log.error({ err: notificationError }, "Failed to send provider error notification");
            }

            return;
          }

          // Suppress only an identical text that was confirmed delivered to this
          // chat. Cross-chat sends, failed sends, and distinct confirmations must
          // still produce a response to the requester.
          const responseAlreadyDelivered = deliveredTelegramText(
            response.toolCalls,
            message.chatId,
            response.content
          );

          if (isSilentReply(response.content)) {
            log.debug("Silent reply suppressed");
          } else if (response.streamed) {
            log.debug("Response already streamed to chat");
          } else if (
            !responseAlreadyDelivered &&
            response.content &&
            response.content.trim().length > 0
          ) {
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
                senderId: this.ownUserId ? parseInt(this.ownUserId, 10) : 0,
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
          } else if (
            responseAlreadyDelivered &&
            response.content &&
            response.content.trim().length > 0 &&
            !isSilentReply(response.content)
          ) {
            // Tool already sent the message to Telegram — store in feed for conversation history
            await this.storeTelegramMessage(
              {
                id: 0, // tool-sent message ID not propagated back
                chatId: message.chatId,
                senderId: this.ownUserId ? parseInt(this.ownUserId, 10) : 0,
                text: response.content,
                isGroup: message.isGroup,
                isChannel: message.isChannel,
                isBot: false,
                mentionsMe: false,
                timestamp: new Date(),
                hasMedia: false,
              },
              true
            );
          }

          // 9. Clear pending history after responding (for groups)
          if (message.isGroup) {
            this.pendingHistory.clearPending(message.chatId);
          }

          // Mark as processed AFTER successful handling (prevents message loss on crash).
          if (this.bridge.requiresOffsetDedup()) {
            writeOffset(message.id, message.chatId);
          }
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
}
