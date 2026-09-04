import type { Config } from "./config/schema.js";
import type { ITelegramBridge } from "./telegram/bridge-interface.js";
import type { AgentRuntime } from "./agent/runtime.js";
import type { TelegramMessage } from "./telegram/bridge.js";
import { getDatabase } from "./memory/index.js";
import { getTaskStore } from "./memory/agent/tasks.js";
import { createLogger } from "./utils/logger.js";
import { ScheduledTaskHandler } from "./scheduled-tasks.js";

const log = createLogger("TaskScheduler");

export class TaskScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<string>();
  private handler: ScheduledTaskHandler;

  constructor(
    private agent: AgentRuntime,
    private bridge: ITelegramBridge,
    private config: Config,
    private intervalMs = config.scheduler.poll_interval_ms
  ) {
    this.handler = new ScheduledTaskHandler(agent, bridge, config);
  }

  updateConfig(config: Config): void {
    this.config = config;
    this.handler.updateConfig(config);
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    // Startup inbox recovery is owned by HeartbeatRunner when heartbeat is
    // enabled. Only fall back here when heartbeat is off so the owner does not
    // receive duplicate startup replies.
    if (!this.config.heartbeat.enabled) void this.recoverUnreadDialogs();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref?.();
    log.info(`Task scheduler started (poll interval: ${this.intervalMs}ms)`);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running.size > 0) await new Promise((resolve) => setTimeout(resolve, 25));
  }

  private async poll(): Promise<void> {
    let tasks;
    try {
      tasks = getTaskStore(getDatabase().getDb()).getDueTasks();
    } catch (error) {
      log.error({ err: error }, "Failed to poll scheduled tasks");
      return;
    }
    const now = Date.now();
    await Promise.all(
      tasks
        .filter((task) => !this.running.has(task.id))
        .filter((task) => this.isWithinCatchUp(task, now))
        .filter((task) => this.isWithinWindow(task, now))
        .map((task) => this.run(task))
    );
  }

  private isWithinCatchUp(task: { scheduledFor?: Date }, now: number): boolean {
    const maxAge = this.config.scheduler.max_catch_up_ms;
    return !task.scheduledFor || maxAge === 0 || now - task.scheduledFor.getTime() <= maxAge;
  }

  private isWithinWindow(task: { payload?: string }, now: number): boolean {
    if (!task.payload) return true;
    let metadata: { scheduleWindow?: { start?: string; end?: string; timezone?: string } };
    try {
      metadata = JSON.parse(task.payload) as typeof metadata;
    } catch {
      return true;
    }
    const window = metadata.scheduleWindow;
    if (!window?.start || !window.end) return true;
    const timezone = window.timezone ?? this.config.scheduler.default_timezone;
    try {
      const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      const current = formatter.format(new Date(now));
      return window.start <= window.end
        ? current >= window.start && current <= window.end
        : current >= window.start || current <= window.end;
    } catch {
      log.warn({ timezone }, "Invalid scheduler timezone; ignoring task window");
      return true;
    }
  }

  private async recoverUnreadDialogs(): Promise<void> {
    if (!this.bridge.getUnreadDirectDialogs || !this.bridge.getMessages) return;
    try {
      const dialogs = await this.bridge.getUnreadDirectDialogs();
      let recovered = 0;
      for (const dialog of dialogs) {
        if (dialog.unreadCount <= 0) continue;

        // Pull the recent unread messages so the agent can answer based on
        // actual content rather than guessing from a bare count.
        const recent = await this.bridge.getMessages(
          dialog.chatId,
          Math.min(dialog.unreadCount, 30)
        );
        const context = recent
          .filter((message) => message.text && message.text.trim().length > 0)
          .slice(-15)
          .map(
            (message) =>
              `[${message.timestamp?.toISOString?.() ?? "?"}] ` +
              `${message.senderFirstName || message.senderUsername || message.senderId}: ` +
              `${message.text}`
          )
          .join("\n");

        await this.agent.processMessage({
          chatId: dialog.chatId,
          userMessage:
            `Startup inbox recovery: this direct chat has ${dialog.unreadCount} unread message(s).\n` +
            (context ? `Recent messages:\n${context}\n\n` : "") +
            "Greet the owner or this contact briefly if appropriate, then respond to what they wrote. " +
            "Only send a reply if one is genuinely useful; otherwise answer HEARTBEAT_OK.",
          userName: "startup-inbox-recovery",
          timestamp: Date.now(),
          isGroup: false,
          isHeartbeat: true,
          toolContext: {
            bridge: this.bridge,
            db: getDatabase().getDb(),
            senderId: Number(this.bridge.getOwnUserId() ?? 0),
          },
        });
        recovered++;
      }
      if (recovered > 0) log.info(`Startup inbox recovery replied in ${recovered} dialog(s)`);
    } catch (error) {
      log.error({ err: error }, "Startup inbox recovery failed");
    }
  }

  private async run(task: {
    id: string;
    description: string;
    originChatId?: string;
    originSenderId?: number;
    originIsGroup?: boolean;
    scheduledFor?: Date;
    scheduledMessageId?: number;
  }): Promise<void> {
    this.running.add(task.id);
    try {
      const message: TelegramMessage = {
        id: task.scheduledMessageId ?? -Date.now(),
        chatId: task.originChatId ?? "global",
        senderId: Number(this.bridge.getOwnUserId() ?? 0),
        text: `[TASK:${task.id}] ${task.description}`,
        isGroup: task.originIsGroup ?? false,
        isChannel: false,
        isBot: false,
        mentionsMe: false,
        timestamp: task.scheduledFor ?? new Date(),
        hasMedia: false,
        isSystemEvent: true,
      };
      await this.handler.execute(message);
    } finally {
      this.running.delete(task.id);
    }
  }
}
