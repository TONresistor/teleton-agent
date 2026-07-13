import type { AgentRuntime } from "./agent/runtime.js";
import type { ITelegramBridge } from "./telegram/bridge-interface.js";
import type { Config } from "./config/schema.js";
import { createLogger } from "./utils/logger.js";
import { isHeartbeatOk, isSilentReply } from "./constants/tokens.js";
import { sentSuccessfullyToChat } from "./agent/telegram-send-state.js";

const log = createLogger("HeartbeatRunner");

export class HeartbeatRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeTick: Promise<void> | null = null;

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

    if (!adminChatId) return;

    try {
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
        userMessage: cfg.prompt,
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
        await this.bridge.sendMessage({ chatId: deliveryChatId, text: response.content });
      }
      log.debug("Heartbeat: tick processed");
    } catch (error: unknown) {
      log.error({ err: error }, "Heartbeat error");
    }
  }
}
