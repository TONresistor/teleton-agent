import type { AgentRuntime } from "./agent/runtime.js";
import type { ITelegramBridge } from "./telegram/bridge-interface.js";
import type { Config } from "./config/schema.js";
import { createLogger } from "./utils/logger.js";
import { isHeartbeatOk, isSilentReply } from "./constants/tokens.js";
import { sentSuccessfullyToChat } from "./agent/telegram-send-state.js";
import {
  calculateTypingDelay,
  isSimpleAcknowledgment,
  shouldShowTyping,
  getMomentumFactors,
  recordChatActivity,
} from "./telegram/human-behavior.js";
import { getTimeFactors, getTimeOfDayConfig } from "./telegram/human/time-of-day.js";

const log = createLogger("HeartbeatRunner");

interface ProactiveDecision {
  score: number;
  reason: string;
  draft: string | null;
}

function extractJsonObject(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) return fenced;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  return start >= 0 && end > start ? content.slice(start, end + 1) : null;
}

function parseProactiveDecision(content: string): ProactiveDecision | null {
  try {
    const json = extractJsonObject(content);
    if (!json) return null;
    const data = JSON.parse(json) as Partial<ProactiveDecision>;
    const score = data.score;
    if (
      typeof score !== "number" ||
      !Number.isInteger(score) ||
      score < 1 ||
      score > 10 ||
      typeof data.reason !== "string" ||
      (data.draft !== null && typeof data.draft !== "string")
    ) {
      return null;
    }
    return { score, reason: data.reason, draft: data.draft ?? null };
  } catch {
    return null;
  }
}

export class HeartbeatRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeTick: Promise<void> | null = null;
  private proactiveLastSent = new Map<string, number>();
  private startupPending = true;
  private lastReplyAt = new Map<string, number>();

  constructor(
    private agent: AgentRuntime,
    private bridge: ITelegramBridge,
    private config: Config
  ) {}

  updateConfig(config: Config): void {
    this.config = config;
  }

  start(adminChatId: number, intervalMs: number): void {
    this.stop();
    this.startupPending = true;
    void this.runOnce(adminChatId);
    this.timer = setInterval(() => {
      void this.runOnce(adminChatId);
    }, intervalMs);
    this.timer.unref();
    log.info(
      `Heartbeat enabled: every ${Math.round(intervalMs / 60000)}min → admin ${adminChatId}`
    );
  }

  async stopAndDrain(): Promise<void> {
    this.stop();
    await this.activeTick;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(adminChatId: number): Promise<void> {
    if (this.activeTick) {
      log.debug("Heartbeat tick skipped (previous still running)");
      return;
    }

    const task = this.tick(adminChatId);
    this.activeTick = task;
    try {
      await task;
    } finally {
      if (this.activeTick === task) this.activeTick = null;
    }
  }

  private async tick(adminChatId: number): Promise<void> {
    const cfg = this.config.heartbeat;
    if (!cfg?.enabled) return;
    const isStartup = this.startupPending;
    const prompt = isStartup && cfg.startup_prompt ? cfg.startup_prompt : cfg.prompt;
    this.startupPending = false;

    try {
      if (isStartup && this.bridge.getUnreadDirectDialogs) {
        await this.recoverUnreadDialogs(prompt, adminChatId);
      } else if (adminChatId) {
        const { getDatabase } = await import("./memory/index.js");
        const deliveryChatId = String(adminChatId);
        const toolContext = {
          bridge: this.bridge,
          db: getDatabase().getDb(),
          chatId: deliveryChatId,
          isGroup: false,
          senderId: adminChatId,
          config: this.config,
        };

        const response = await this.agent.processMessage({
          chatId: deliveryChatId,
          sessionKey: `heartbeat:${adminChatId}`,
          userMessage: prompt,
          userName: "heartbeat",
          timestamp: Date.now(),
          isGroup: false,
          toolContext,
          isHeartbeat: true,
        });

        const deliveredByTool =
          response.toolCalls?.some((call) => sentSuccessfullyToChat(call, deliveryChatId)) ?? false;
        if (
          !deliveredByTool &&
          response.content.trim().length > 0 &&
          !isHeartbeatOk(response.content) &&
          !isSilentReply(response.content)
        ) {
          await this.deliverWithPacing(deliveryChatId, response.content, adminChatId, isStartup);
        }
      }

      await this.runProactiveChecks();
      log.debug("Heartbeat: tick processed");
    } catch (error: unknown) {
      log.error({ err: error }, "Heartbeat error");
    }
  }

  /**
   * Send a heartbeat reply with a human-like delay and a minimum interval
   * guard so rapid ticks do not produce rapid-fire messages.
   */
  private async deliverWithPacing(
    chatId: string,
    text: string,
    adminChatId: number,
    isStartup: boolean
  ): Promise<void> {
    const cfg = this.config.heartbeat;
    const minInterval = cfg.min_interval_between_replies_ms ?? 0;
    const replyDelay = cfg.reply_delay_ms ?? 0;

    if (minInterval > 0 && !isStartup) {
      const last = this.lastReplyAt.get(chatId) ?? 0;
      const elapsed = Date.now() - last;
      if (elapsed < minInterval) {
        log.debug(
          `Heartbeat reply suppressed for ${chatId}: ${elapsed}ms < ${minInterval}ms since last reply`
        );
        return;
      }
    }

    // Use human-like typing delay instead of fixed delay
    const isSimpleAck = isSimpleAcknowledgment(text);
    const showTyping = shouldShowTyping(text.length, isSimpleAck);

    if (showTyping && this.config.telegram.typing_simulation) {
      // Apply time-of-day and momentum factors for natural variation
      const todConfig = getTimeOfDayConfig({
        timezoneOffsetMinutes:
          this.config.telegram.humanization?.time_of_day?.timezone_offset_minutes,
        enabled: this.config.telegram.humanization?.time_of_day?.enabled,
      });
      const todFactors = getTimeFactors(todConfig);
      const momentum = getMomentumFactors(chatId);

      const typingDelay = calculateTypingDelay(
        text.length,
        false, // heartbeat = DM
        {},
        momentum.momentumLevel * todFactors.typingSpeedFactor
      );
      await new Promise((resolve) => setTimeout(resolve, typingDelay));
    } else if (replyDelay > 0) {
      // Fallback to config delay if typing is disabled
      await new Promise((resolve) => setTimeout(resolve, replyDelay));
    }

    // Track activity for momentum
    recordChatActivity(chatId);

    await this.bridge.sendMessage({ chatId, text });
    this.lastReplyAt.set(chatId, Date.now());
    log.debug(`Heartbeat reply sent to ${chatId} (admin ${adminChatId})`);
  }

  private async recoverUnreadDialogs(startupPrompt: string, adminChatId: number): Promise<void> {
    const getUnreadDirectDialogs = this.bridge.getUnreadDirectDialogs;
    if (!getUnreadDirectDialogs) return;
    const dialogs = await getUnreadDirectDialogs();
    if (dialogs.length === 0) {
      log.info("Startup inbox recovery: no unread direct dialogs");
      return;
    }

    const { getDatabase } = await import("./memory/index.js");
    for (const dialog of dialogs) {
      // Pull the recent unread messages so the agent can answer based on
      // actual content rather than guessing from a bare count.
      let context = "";
      if (this.bridge.getMessages) {
        try {
          const recent = await this.bridge.getMessages(
            dialog.chatId,
            Math.min(dialog.unreadCount, 30)
          );
          context = recent
            .filter((message) => message.text && message.text.trim().length > 0)
            .slice(-15)
            .map(
              (message) =>
                `[${message.timestamp?.toISOString?.() ?? "?"}] ` +
                `${message.senderFirstName || message.senderUsername || message.senderId}: ` +
                `${message.text}`
            )
            .join("\n");
        } catch {
          context = "";
        }
      }

      const response = await this.agent.processMessage({
        chatId: dialog.chatId,
        sessionKey: `startup-inbox:${dialog.chatId}`,
        userMessage:
          `${startupPrompt}\n\nThis direct dialog has ${dialog.unreadCount} unread message(s).\n` +
          (context ? `Recent messages:\n${context}\n\n` : "") +
          "Respond to what they wrote if a reply is genuinely useful. Otherwise answer HEARTBEAT_OK.",
        userName: "startup inbox recovery",
        timestamp: Date.now(),
        isGroup: false,
        toolContext: {
          bridge: this.bridge,
          db: getDatabase().getDb(),
          senderId: adminChatId,
          config: this.config,
        },
        isHeartbeat: true,
      });
      const deliveredByTool =
        response.toolCalls?.some((call) => sentSuccessfullyToChat(call, dialog.chatId)) ?? false;
      const text = response.content.trim();
      if (!deliveredByTool && text && !isHeartbeatOk(text) && !isSilentReply(text)) {
        await this.bridge.sendMessage({ chatId: dialog.chatId, text });
      }
    }
    log.info(`Startup inbox recovery: checked ${dialogs.length} unread direct dialog(s)`);
  }

  private async runProactiveChecks(): Promise<void> {
    const cfg = this.config.heartbeat;
    if (!cfg.proactive_enabled || cfg.proactive_chat_ids.length === 0) return;

    const humanConfig = this.config.telegram.humanization;
    if (humanConfig?.time_of_day?.enabled ?? true) {
      const todConfig = getTimeOfDayConfig({
        timezoneOffsetMinutes: humanConfig?.time_of_day?.timezone_offset_minutes,
        quietHoursStart: humanConfig?.time_of_day?.quiet_hours_start,
        quietHoursEnd: humanConfig?.time_of_day?.quiet_hours_end,
      });
      if (getTimeFactors(todConfig).isQuietHours) {
        log.debug("Proactive checks skipped: quiet hours for owner");
        return;
      }
    }

    const now = Date.now();
    const cooldown = cfg.proactive_cooldown_ms;
    const { getDatabase } = await import("./memory/index.js");

    for (const chatIdNumber of cfg.proactive_chat_ids) {
      const chatId = String(chatIdNumber);
      const lastSent = this.proactiveLastSent.get(chatId) ?? 0;
      if (now - lastSent < cooldown) continue;

      const response = await this.agent.processMessage({
        chatId,
        sessionKey: `proactive:${chatId}`,
        userMessage: `${cfg.proactive_prompt}

Return only JSON with this exact shape: {"score": 1-10, "reason": "short factual reason", "draft": "short message" | null}. Score 1-3 for no reason, 4-6 for a weak or stale reason, 7-10 only for a concrete useful follow-up or relevant discovery. Never call Telegram send tools; the runner handles delivery.`,
        userName: "proactive heartbeat",
        timestamp: now,
        isGroup: false,
        toolContext: {
          bridge: this.bridge,
          db: getDatabase().getDb(),
          senderId: chatIdNumber,
          config: this.config,
        },
        isHeartbeat: true,
      });

      const decision = parseProactiveDecision(response.content.trim());
      if (!decision) {
        log.warn({ chatId }, "Proactive decision skipped: model did not return valid JSON");
        continue;
      }
      if (!decision.draft) {
        log.debug({ chatId, score: decision.score }, "Proactive decision skipped: no draft");
        continue;
      }
      if (decision.score < cfg.proactive_min_score) {
        log.debug(
          { chatId, score: decision.score, threshold: cfg.proactive_min_score },
          "Proactive decision skipped: score below threshold"
        );
        continue;
      }

      if (cfg.proactive_mode === "suggestion") {
        const ownerId = this.config.telegram.owner_id ?? this.config.telegram.admin_ids[0];
        if (!ownerId) {
          log.warn("Proactive suggestion skipped: no owner or admin chat configured");
          continue;
        }
        await this.bridge.sendMessage({
          chatId: String(ownerId),
          text: `Proactive suggestion for chat ${chatId} (score ${decision.score}/10): ${decision.reason}\n\nDraft:\n${decision.draft}`,
        });
        this.proactiveLastSent.set(chatId, now);
        log.info(`Proactive suggestion sent to owner for ${chatId}`);
      } else {
        await this.bridge.sendMessage({ chatId, text: decision.draft });
        this.proactiveLastSent.set(chatId, now);
        log.info(`Proactive message sent to ${chatId} (score ${decision.score})`);
      }
    }
  }
}
