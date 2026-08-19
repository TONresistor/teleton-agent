import type { Config } from "../config/schema.js";
import { getDatabase } from "../memory/index.js";
import type { PluginModule } from "../agent/tools/types.js";
import type { AgentRuntime } from "../agent/runtime.js";
import { isBotBridge, isUserBridge } from "../telegram/bridge-guards.js";
import type { TelegramMessage } from "../telegram/bridge.js";
import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import { MessageDebouncer } from "../telegram/debounce.js";
import type { MessageHandler } from "../telegram/handlers.js";
import type { AdminHandler } from "../telegram/admin.js";
import type { ScheduledTaskHandler } from "../scheduled-tasks.js";
import type { InlineRouter } from "../bot/inline-router.js";
import {
  countPluginEventHooks,
  createUserPluginCallbackHandler,
  dispatchPluginCallback,
  dispatchPluginMessage,
} from "./plugin-events.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("App");

export interface MessagePipelineDependencies {
  config: Config;
  bridge: ITelegramBridge;
  agent: AgentRuntime;
  messageHandler: MessageHandler;
  adminHandler: AdminHandler;
  scheduledTaskHandler: ScheduledTaskHandler;
  modules: PluginModule[];
  inlineRouter: InlineRouter;
}

export class MessagePipeline {
  private deps: MessagePipelineDependencies;
  private debouncer: MessageDebouncer | null = null;
  private messageHandlerBridge: ITelegramBridge | null = null;
  private callbackHandlerRegistered = false;
  private acceptingMessages = false;
  private messagesProcessed = 0;

  constructor(deps: MessagePipelineDependencies) {
    this.deps = deps;
  }

  update(deps: MessagePipelineDependencies): void {
    if (deps.bridge !== this.deps.bridge) {
      this.callbackHandlerRegistered = false;
    }
    this.deps = deps;
  }

  updateDebounceMs(debounceMs: number): void {
    this.debouncer?.updateDebounceMs(debounceMs);
  }

  setAcceptingMessages(accepting: boolean): void {
    this.acceptingMessages = accepting;
  }

  resetMetrics(): void {
    this.messagesProcessed = 0;
  }

  getMessagesProcessed(): number {
    return this.messagesProcessed;
  }

  install(): boolean {
    this.debouncer = new MessageDebouncer(
      { debounceMs: this.deps.config.telegram.debounce_ms },
      (message) => {
        if (!message.isGroup) return false;
        if (message.text.startsWith("/")) {
          const adminCommand = this.deps.adminHandler.parseCommand(message.text);
          if (adminCommand && this.deps.adminHandler.isAdmin(message.senderId)) return false;
        }
        return true;
      },
      async (messages) => {
        for (const message of messages) await this.handleSingleMessage(message);
      },
      (error, messages) => {
        log.error({ err: error }, `Error processing batch of ${messages.length} messages`);
      }
    );

    const firstStart = this.messageHandlerBridge !== this.deps.bridge;
    if (firstStart) {
      this.deps.bridge.onNewMessage(async (message) => {
        if (!this.acceptingMessages) return;
        try {
          await this.debouncer?.enqueue(message);
        } catch (error) {
          log.error({ err: error }, "Error enqueueing message");
        }
      });
      this.messageHandlerBridge = this.deps.bridge;
    }
    return firstStart;
  }

  wireMode(firstStart: boolean): void {
    if (isBotBridge(this.deps.bridge)) this.wireBotMode(firstStart);
    else this.wireUserMode(firstStart);
  }

  wirePluginEventHooks(): void {
    this.deps.messageHandler.setPluginMessageHooks([
      (event) => dispatchPluginMessage(this.deps.modules, event),
    ]);

    const hookCount = countPluginEventHooks(this.deps.modules, "onMessage");
    if (hookCount > 0) log.info(`${hookCount} plugin onMessage hook(s) registered`);

    if (!this.callbackHandlerRegistered && isUserBridge(this.deps.bridge)) {
      const userBridge = this.deps.bridge;
      userBridge
        .getClient()
        .addCallbackQueryHandler(
          createUserPluginCallbackHandler(userBridge, (event) =>
            dispatchPluginCallback(this.deps.modules, event)
          )
        );
      this.callbackHandlerRegistered = true;
      this.logCallbackHooks();
    } else if (!this.callbackHandlerRegistered && isBotBridge(this.deps.bridge)) {
      this.deps.inlineRouter.setCallbackObserver((event) =>
        dispatchPluginCallback(this.deps.modules, event)
      );
      this.callbackHandlerRegistered = true;
      this.logCallbackHooks();
    }
  }

  async flushAndDrain(): Promise<void> {
    if (this.debouncer) {
      try {
        await this.debouncer.flushAll();
      } catch (error) {
        log.error({ err: error }, "Debouncer flush failed");
      }
    }
    try {
      await this.deps.messageHandler.drain();
    } catch (error) {
      log.error({ err: error }, "Message queue drain failed");
    }
  }

  resetCallbackRegistration(): void {
    this.callbackHandlerRegistered = false;
  }

  private wireBotMode(firstStart: boolean): void {
    const bridge = this.deps.bridge;
    if (!isBotBridge(bridge)) return;
    log.info("Bot mode: using main Grammy bridge");

    bridge.setCallbackHandler((message) => {
      if (!this.acceptingMessages) return;
      void this.debouncer?.enqueue(message);
    });
    if (firstStart) {
      bridge.onGuestMessage(async (message) => {
        if (!this.acceptingMessages) return "";
        if (!this.deps.config.telegram.guest_mode) return "";
        if (this.deps.adminHandler.isPaused()) return "";
        const response = await this.deps.agent.processMessage({
          chatId: `telegram:guest:${message.chatId}`,
          userMessage: message.text,
          userName: message.senderFirstName,
          senderUsername: message.senderUsername,
          isGroup: true,
          isGuest: true,
          timestamp: message.timestamp.getTime(),
          messageId: message.id,
          toolContext: {
            bridge,
            db: getDatabase().getDb(),
            senderId: message.senderId,
            config: this.deps.config,
          },
        });
        return response.content;
      });
    }
    bridge.startPolling();
    void bridge.syncCommands();
  }

  private wireUserMode(firstStart: boolean): void {
    const bridge = this.deps.bridge;
    if (!firstStart || !isUserBridge(bridge)) return;
    bridge.onServiceMessage(async (message) => {
      if (!this.acceptingMessages) return;
      try {
        await this.debouncer?.enqueue(message);
      } catch (error) {
        log.error({ err: error }, "Error enqueueing service message");
      }
    });
  }

  private async handleSingleMessage(message: TelegramMessage): Promise<void> {
    this.messagesProcessed++;
    try {
      const ownUserId = this.deps.bridge.getOwnUserId();
      if (
        ownUserId &&
        message.senderId === Number(ownUserId) &&
        message.text.startsWith("[TASK:")
      ) {
        await this.deps.scheduledTaskHandler.execute(message);
        return;
      }

      const adminCommand = this.deps.adminHandler.parseCommand(message.text);
      if (adminCommand && this.deps.adminHandler.isAdmin(message.senderId)) {
        if (adminCommand.command === "boot") {
          const bootstrapContent = this.deps.adminHandler.getBootstrapContent();
          if (bootstrapContent) message.text = bootstrapContent;
          else {
            await this.deps.bridge.sendMessage({
              chatId: message.chatId,
              text: "❌ Bootstrap template not found.",
              replyToId: message.id,
            });
            return;
          }
        } else if (adminCommand.command === "task") {
          const taskDescription = adminCommand.args.join(" ");
          if (!taskDescription) {
            await this.deps.bridge.sendMessage({
              chatId: message.chatId,
              text: "❌ Usage: /task <description>",
              replyToId: message.id,
            });
            return;
          }
          message.text =
            `[ADMIN TASK]\n` +
            `Create a scheduled task using the telegram_create_scheduled_task tool.\n\n` +
            `Guidelines:\n` +
            `- If the description mentions a specific time or delay, use it as scheduleDate\n` +
            `- Otherwise, schedule 1 minute from now for immediate execution\n` +
            `- For simple operations (check a price, send a message), use a tool_call payload\n` +
            `- For complex multi-step tasks, use an agent_task payload with detailed instructions\n` +
            `- Always include a reason explaining why this task is being created\n\n` +
            `Task: "${taskDescription}"`;
        } else {
          const response = await this.deps.adminHandler.handleCommand(
            adminCommand,
            message.chatId,
            message.senderId,
            message.isGroup
          );
          await this.deps.bridge.sendMessage({
            chatId: message.chatId,
            text: response,
            replyToId: message.id,
          });
          return;
        }
      }

      if (this.deps.adminHandler.isPaused()) return;
      await this.deps.messageHandler.handleMessage(message);
    } catch (error) {
      log.error({ err: error }, "Error handling message");
    }
  }

  private logCallbackHooks(): void {
    const callbackCount = countPluginEventHooks(this.deps.modules, "onCallbackQuery");
    if (callbackCount > 0) log.info(`${callbackCount} plugin onCallbackQuery hook(s) registered`);
  }
}
