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
import { analyzeAudioBuffer } from "../spotify/preview-analysis.js";
import { getTrack } from "../spotify/client.js";
import {
  deliveredTelegramMessageId,
  deliveredTelegramMessageIdFromCall,
  deliveredTelegramStructuredMessage,
  deliveredTelegramText,
} from "../agent/telegram-send-state.js";
import { getClient, transcribeAudio } from "../sdk/telegram-utils.js";
import { isUserBridge } from "./bridge-guards.js";
import { visionAnalyzeExecutor } from "../agent/tools/telegram/media/vision-analyze.js";
import { TYPING_REFRESH_MS } from "../constants/timeouts.js";
import { createLogger } from "../utils/logger.js";
import { getErrorMessage } from "../utils/errors.js";
import { randomUUID } from "crypto";
import {
  calculateTypingDelay,
  calculateReadDelay,
  shouldShowTyping,
  isSimpleAcknowledgment,
} from "./human-behavior.js";
import {
  decideReply,
  activityTracker,
  getReplyProbabilityConfig,
} from "./human/reply-probability.js";
import { getTimeOfDayConfig, getTimeFactors } from "./human/time-of-day.js";

const log = createLogger("Telegram");
import type { PluginMessageEvent } from "@teleton-agent/sdk";

type FeedTelegramMessage = Omit<TelegramMessage, "id"> & { id: number | string };

/**
 * Split a natural-language reply into separate Telegram messages when it
 * reads like distinct thoughts (blank-line-separated paragraphs) — the way a
 * person sends a short burst of messages instead of one long block.
 * Conservative on purpose: skips splitting for code blocks, replies with no
 * real paragraph break, or an unusually high paragraph count (more likely a
 * structured list/explanation that should stay together).
 */
function splitIntoNaturalMessages(text: string): string[] {
  if (text.includes("```")) return [text];

  const parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length < 2 || parts.length > 4) return [text];

  return parts;
}

function extractSpotifyTrackId(text: string): string | null {
  const match = text.match(
    /(?:open\.spotify\.com\/(?:intl-[^/]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/i
  );
  return match?.[1] ?? null;
}

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

export class ChatQueue {
  private chains = new Map<string, Promise<void>>();
  private activeTasks = 0;
  private maxConcurrent: number;
  private waitQueue: Array<() => void> = [];
  private pendingTasks = 0;

  constructor(
    maxConcurrent = 10,
    private readonly maxPending = 100
  ) {
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
    if (this.pendingTasks >= this.maxPending) {
      return Promise.reject(new Error("Telegram message queue capacity reached"));
    }
    this.pendingTasks++;
    const prev = this.chains.get(chatId) ?? Promise.resolve();
    const next = prev
      .then(
        () => this.acquireSlot(chatId).then(task),
        () => this.acquireSlot(chatId).then(task)
      )
      .finally(() => {
        this.pendingTasks--;
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

  /** Whether a chat currently has a task running or waiting in its chain. */
  hasActive(chatId: string): boolean {
    return this.chains.has(chatId);
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
    fullConfig?: Config,
    messageStore?: MessageStore
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

    this.messageStore = messageStore ?? new MessageStore(db, embedder, vectorEnabled);
    this.chatStore = new ChatStore(db);
    this.userStore = new UserStore(db);
    this.pendingHistory = new PendingHistory();
  }

  private shouldReplyToMessage(message: TelegramMessage): boolean {
    if (message.isSystemEvent) return false;

    const replyStyle = this.config.reply_style ?? "auto";
    if (replyStyle === "reply") return true;
    if (replyStyle === "plain") return false;

    // Auto: reply only when there is an explicit conversational anchor.
    if (message.replyToId) return true;
    if (message.isGroup && message.mentionsMe) return true;
    return false;
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

  updateConfig(config: Config): void {
    this.config = config.telegram;
    this.fullConfig = config;
    this.rateLimiter = new RateLimiter(
      config.telegram.rate_limit_messages_per_second,
      config.telegram.rate_limit_groups_per_minute
    );
  }

  setPluginMessageHooks(hooks: Array<(e: PluginMessageEvent) => Promise<void>>): void {
    this.pluginMessageHooks = hooks;
  }

  async drain(): Promise<void> {
    await this.chatQueue.drain();
  }

  /**
   * Whether this chat is currently mid-turn (still generating/sending a reply
   * to an earlier message). Used by the debouncer to hold a fast follow-up
   * message instead of answering it as its own disjointed turn.
   */
  isChatBusy(chatId: string): boolean {
    return this.chatQueue.hasActive(chatId);
  }

  /**
   * Process a debounced batch of direct messages as a single turn: earlier
   * messages become pending context for the last message, so the agent answers
   * once with the full picture instead of replying to each message blindly.
   * Group/channel batches are forwarded one-by-one to preserve existing flows.
   */
  async handleBatch(messages: TelegramMessage[]): Promise<void> {
    if (messages.length <= 1) {
      await this.handleMessage(messages[0]);
      return;
    }

    const sorted = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const dmMessages = sorted.filter((message) => !message.isGroup && !message.isChannel);
    const groupMessages = sorted.filter((message) => message.isGroup || message.isChannel);

    for (const message of groupMessages) {
      await this.handleMessage(message);
    }

    if (dmMessages.length <= 1) {
      if (dmMessages.length === 1) await this.handleMessage(dmMessages[0]);
      return;
    }

    const anchor = dmMessages[dmMessages.length - 1];
    const earlier = dmMessages.slice(0, -1);
    for (const message of earlier) {
      await this.storeTelegramMessage(message, false);
      this.pendingHistory.addMessage(message.chatId, message);
    }

    await this.handleMessage(anchor);

    if (this.bridge.requiresOffsetDedup()) {
      for (const message of earlier) writeOffset(message.id, message.chatId);
    }
  }

  analyzeMessage(message: TelegramMessage): MessageContext {
    const isAdmin = this.config.admin_ids.includes(message.senderId);

    // Bridges that redeliver (user mode) need handler-side dedup; bot mode dedupes via update_id.
    // System events (reactions) carry synthetic negative IDs, so they must bypass offset dedup.
    if (this.bridge.requiresOffsetDedup() && !message.isSystemEvent) {
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
      message.senderId === ownSenderId &&
      !message.isSystemEvent
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

    // 2b. Humanization: reply probability check (skip probabilistically)
    const humanConfig = this.fullConfig?.telegram?.humanization;
    if (humanConfig?.enabled ?? true) {
      const replyConfig = getReplyProbabilityConfig({
        dmBase: humanConfig?.reply_probability?.dm_base,
        groupMentioned: humanConfig?.reply_probability?.group_mentioned,
        groupRepliedToUs: humanConfig?.reply_probability?.group_replied_to_us,
        groupUnmentioned: humanConfig?.reply_probability?.group_unmentioned,
        minIntervalMs: humanConfig?.reply_probability?.min_interval_ms,
        highActivityThreshold: humanConfig?.reply_probability?.high_activity_threshold,
        highActivityMultiplier: humanConfig?.reply_probability?.high_activity_multiplier,
      });

      // Quiet-hours dampening: a real person is less eager to chat late at night.
      if (humanConfig?.time_of_day?.enabled ?? true) {
        const todFactors = getTimeFactors(
          getTimeOfDayConfig({
            timezoneOffsetMinutes: humanConfig?.time_of_day?.timezone_offset_minutes,
            quietHoursStart: humanConfig?.time_of_day?.quiet_hours_start,
            quietHoursEnd: humanConfig?.time_of_day?.quiet_hours_end,
          })
        );
        if (todFactors.isQuietHours) {
          replyConfig.dmBase *= todFactors.replyProbabilityFactor;
          replyConfig.groupMentioned *= todFactors.replyProbabilityFactor;
          replyConfig.groupUnmentioned *= todFactors.replyProbabilityFactor;
        }
      }

      const isReplyToUs = message.replyToId !== undefined;
      const decision = decideReply({
        chatId: message.chatId,
        isGroup: message.isGroup,
        isMentioned: message.mentionsMe,
        isReplyToUs,
        config: replyConfig,
      });

      // Record message for activity tracking regardless of reply decision
      activityTracker.recordMessage(message.chatId);

      if (!decision.shouldReply) {
        // Still track in pending history for groups (context preservation)
        if (message.isGroup) {
          this.pendingHistory.addMessage(message.chatId, message);
        }
        log.debug(`Skipping message ${message.id}: humanization decision — ${decision.reason}`);
        return;
      }
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
        if (this.bridge.requiresOffsetDedup() && !message.isSystemEvent) {
          const postQueueOffset = readOffset(message.chatId) ?? 0;
          if (message.id <= postQueueOffset) {
            log.debug(`Skipping message ${message.id} (already processed after queue wait)`);
            return;
          }
        }

        // 4. Persistent typing simulation if enabled with variable delay
        let typingInterval: ReturnType<typeof setInterval> | undefined;

        if (this.config.typing_simulation) {
          // Wait a bit before starting typing (reading the message)
          const readDelay = calculateReadDelay(message.text.length);
          await new Promise((resolve) => setTimeout(resolve, readDelay));

          // Now show typing indicator
          await this.bridge.setTyping(message.chatId);
          typingInterval = setInterval(() => {
            void this.bridge.setTyping(message.chatId);
          }, TYPING_REFRESH_MS);
        }

        try {
          // 5. Get pending history for groups (if any) — also applies to DMs
          // merged by the debouncer via handleBatch.
          let pendingContext: string | null = null;
          if (message.isGroup || this.pendingHistory.hasPending(message.chatId)) {
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
          let audioDescription: string | null = null;
          if (message.mediaType === "voice") {
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

          if (
            message.mediaType === "audio" &&
            message._rawMessage &&
            this.bridge.getMode() === "user"
          ) {
            try {
              const audioBytes = await getClient(this.bridge).downloadMedia(
                message._rawMessage,
                {}
              );
              if (audioBytes instanceof Buffer) {
                const analysis = await analyzeAudioBuffer(audioBytes, "telegram_audio");
                audioDescription = `[Music audio analysis: duration=${analysis.durationSeconds.toFixed(1)}s, mean_volume=${analysis.meanVolumeDb ?? "unknown"} dB, max_volume=${analysis.maxVolumeDb ?? "unknown"} dB]`;
              }
            } catch (innerError) {
              log.warn(
                { err: innerError, messageId: message.id },
                "Failed to analyze incoming music"
              );
            }
          }

          let spotifyDescription: string | null = null;
          const spotifyTrackId = extractSpotifyTrackId(message.text);
          if (spotifyTrackId) {
            try {
              const track = await getTrack(spotifyTrackId);
              spotifyDescription = `[Spotify track: ${track.name} — ${track.artists.join(", ")}; album=${track.album}; id=${track.id}; preview=${track.previewUrl ? "available" : "unavailable"}; url=${track.spotifyUrl ?? "unknown"}]`;
            } catch (innerError) {
              log.warn(
                { err: innerError, messageId: message.id },
                "Failed to resolve Spotify link"
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

          // 5d. Describe images and static stickers up front so their content is
          // available both to this reply and to future memory/search retrieval.
          let mediaDescription: string | null = null;
          if (
            this.bridge.getMode() === "user" &&
            (message.mediaType === "photo" ||
              message.mediaType === "sticker" ||
              message.mediaType === "video")
          ) {
            try {
              const visionResult = await visionAnalyzeExecutor(
                {
                  chatId: message.chatId,
                  messageId: message.id,
                  prompt:
                    "Describe what is shown, including relevant text, people, objects, mood, and any details useful for remembering this message.",
                },
                { ...toolContext, chatId: message.chatId, isGroup: message.isGroup }
              );
              const data = visionResult.data as { analysis?: unknown } | undefined;
              if (visionResult.success && typeof data?.analysis === "string") {
                mediaDescription = `[Media description: ${data.analysis}]`;
              } else {
                log.warn(
                  {
                    messageId: message.id,
                    mediaType: message.mediaType,
                    error: visionResult.error,
                  },
                  "Media analysis was unavailable"
                );
              }
            } catch (innerError) {
              log.warn({ err: innerError, messageId: message.id }, "Failed to analyze media");
            }
          }

          // 7. Get response from agent (with tools)
          const userName =
            message.senderFirstName || message.senderUsername || `user:${message.senderId}`;
          // Inject transcription into message text if available
          const effectiveText = [
            transcriptionText ? `🎤 (voice): ${transcriptionText}` : null,
            message.text || null,
            mediaDescription,
            audioDescription,
            spotifyDescription,
          ]
            .filter(Boolean)
            .join("\n");
          const mediaContext = [
            transcriptionText ? `[Audio transcript: ${transcriptionText}]` : null,
            mediaDescription,
            audioDescription,
            spotifyDescription,
          ]
            .filter(Boolean)
            .join("\n");
          if (mediaContext) {
            await this.messageStore.appendContext(
              message.chatId,
              message.id.toString(),
              mediaContext
            );
          }
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
              reactionSummary: message.reactionSummary,
              streamToChat,
            });
          } catch (error) {
            log.error({ err: error }, "Agent provider request failed");

            try {
              await this.bridge.sendMessage({
                chatId: message.chatId,
                text: providerFailureReply(error),
                replyToId: message.id > 0 ? message.id : undefined,
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
          const deliveredStructuredMessage = deliveredTelegramStructuredMessage(
            response.toolCalls,
            message.chatId
          );

          if (deliveredStructuredMessage) {
            // A structured send is the response itself. Never append the
            // model's final acknowledgement as a separate Telegram message.
            const deliveryData =
              deliveredStructuredMessage.result?.data &&
              typeof deliveredStructuredMessage.result.data === "object"
                ? (deliveredStructuredMessage.result.data as Record<string, unknown>)
                : {};
            const richText =
              typeof deliveryData.renderedText === "string" ? deliveryData.renderedText : "";
            const deliveredMessageId = deliveredTelegramMessageIdFromCall(
              deliveredStructuredMessage
            );
            const mediaType =
              deliveryData.mediaType === "photo" ||
              deliveryData.mediaType === "video" ||
              deliveryData.mediaType === "audio" ||
              deliveryData.mediaType === "document"
                ? deliveryData.mediaType
                : undefined;

            await this.storeTelegramMessage(
              {
                id: deliveredMessageId ?? `tool:${message.id}:${randomUUID()}`,
                chatId: message.chatId,
                senderId: this.ownUserId ? parseInt(this.ownUserId, 10) : 0,
                text: richText,
                isGroup: message.isGroup,
                isChannel: message.isChannel,
                isBot: false,
                mentionsMe: false,
                timestamp: new Date(),
                hasMedia: deliveryData.hasMedia === true,
                mediaType,
              },
              true
            );
          } else if (isSilentReply(response.content)) {
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

            // A real person often sends a short burst of messages instead of
            // one long block — split on natural paragraph breaks when it fits.
            const messageChunks = splitIntoNaturalMessages(responseText);

            for (let chunkIndex = 0; chunkIndex < messageChunks.length; chunkIndex++) {
              const chunk = messageChunks[chunkIndex];

              // Add realistic typing delay based on this chunk's length
              const isSimpleAck = isSimpleAcknowledgment(chunk);
              const showTyping = shouldShowTyping(chunk.length, isSimpleAck);

              if (showTyping && this.config.typing_simulation) {
                const typingDelay = calculateTypingDelay(chunk.length, message.isGroup);
                await new Promise((resolve) => setTimeout(resolve, typingDelay));
              }

              const sentMessage = await this.bridge.sendMessage({
                chatId: message.chatId,
                text: chunk,
                replyToId:
                  chunkIndex === 0 && this.shouldReplyToMessage(message) ? message.id : undefined,
              });

              // Store agent's response to feed
              await this.storeTelegramMessage(
                {
                  id: sentMessage.id,
                  chatId: message.chatId,
                  senderId: this.ownUserId ? parseInt(this.ownUserId, 10) : 0,
                  text: chunk,
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
          } else if (
            responseAlreadyDelivered &&
            response.content &&
            response.content.trim().length > 0 &&
            !isSilentReply(response.content)
          ) {
            // Tool already sent the message to Telegram — store in feed for conversation history
            const deliveredMessageId = deliveredTelegramMessageId(
              response.toolCalls,
              message.chatId,
              response.content
            );
            await this.storeTelegramMessage(
              {
                id: deliveredMessageId ?? `tool:${message.id}:${randomUUID()}`,
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
          // System events (reactions) carry synthetic negative IDs — never a real
          // Telegram message ID — so they must not be written as an offset or
          // passed to markAsRead (Telegram's API rejects out-of-range int32 IDs).
          if (!message.isSystemEvent) {
            if (this.bridge.requiresOffsetDedup()) {
              writeOffset(message.id, message.chatId);
            }

            // A user account can acknowledge the message after it has been handled.
            // Bot accounts do not control the account-level read state.
            if (isUserBridge(this.bridge)) {
              try {
                const client = getClient(this.bridge);
                const peer = this.bridge.getPeer(message.chatId) ?? message.chatId;
                await client.markAsRead(peer, message.id, { clearMentions: true });
              } catch (error) {
                log.warn({ err: error, chatId: message.chatId }, "Failed to mark message as read");
              }
            }
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
    message: FeedTelegramMessage,
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
