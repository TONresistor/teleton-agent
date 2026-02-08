/**
 * GramJS TelegramClient wrapper
 * Handles session management, authentication, and connection lifecycle
 */

import { TelegramClient, Api } from "telegram";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import type { NewMessageEvent } from "telegram/events/NewMessage.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { dirname } from "path";
import { createInterface } from "readline";
import { markdownToTelegramHtml } from "./formatting.js";

/** Prompt the user for input via terminal */
function promptInput(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export interface TelegramClientConfig {
  apiId: number;
  apiHash: string;
  phone: string;
  sessionPath: string;
  connectionRetries?: number;
  retryDelay?: number;
  autoReconnect?: boolean;
  floodSleepThreshold?: number;
}

export interface TelegramUser {
  id: bigint;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  isBot: boolean;
}

/**
 * Wrapper around GramJS TelegramClient with simplified API
 */
export class TelegramUserClient {
  private client: TelegramClient;
  private config: TelegramClientConfig;
  private connected = false;
  private me?: TelegramUser;

  constructor(config: TelegramClientConfig) {
    this.config = config;

    // Load or create session
    const sessionString = this.loadSession();
    const session = new StringSession(sessionString);

    // Initialize client with silent logger
    const logger = new Logger(LogLevel.NONE);
    this.client = new TelegramClient(session, config.apiId, config.apiHash, {
      connectionRetries: config.connectionRetries ?? 5,
      retryDelay: config.retryDelay ?? 1000,
      autoReconnect: config.autoReconnect ?? true,
      floodSleepThreshold: config.floodSleepThreshold ?? 60,
      baseLogger: logger,
    });
  }

  /**
   * Load session from file, or return empty string for new session
   */
  private loadSession(): string {
    try {
      if (existsSync(this.config.sessionPath)) {
        return readFileSync(this.config.sessionPath, "utf-8").trim();
      }
    } catch (error) {
      console.warn("Failed to load session:", error);
    }
    return "";
  }

  /**
   * Save session to file
   */
  private saveSession(): void {
    try {
      const sessionString = this.client.session.save() as string | undefined;
      if (typeof sessionString !== "string" || !sessionString) {
        console.warn("No session string to save");
        return;
      }
      const dir = dirname(this.config.sessionPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.config.sessionPath, sessionString, { encoding: "utf-8" });
      chmodSync(this.config.sessionPath, 0o600);
      console.log("✅ Session saved");
    } catch (error) {
      console.error("Failed to save session:", error);
    }
  }

  /**
   * Connect and authenticate
   */
  async connect(): Promise<void> {
    if (this.connected) {
      console.log("Already connected");
      return;
    }

    try {
      // Check if we have a saved session
      const hasSession = existsSync(this.config.sessionPath);

      if (hasSession) {
        // Connect with existing session
        await this.client.connect();
      } else {
        // First-time authentication
        console.log("Starting authentication flow...");
        await this.client.start({
          phoneNumber: async () => this.config.phone || (await promptInput("Phone number: ")),
          phoneCode: async () => await promptInput("Verification code: "),
          password: async () => await promptInput("2FA password (if enabled): "),
          onError: (err) => console.error("Auth error:", err),
        });
        console.log("✅ Authenticated");

        // Save session
        this.saveSession();
      }

      // Get own user info
      const me = (await this.client.getMe()) as Api.User;
      this.me = {
        id: BigInt(me.id.toString()),
        username: me.username,
        firstName: me.firstName,
        lastName: me.lastName,
        phone: me.phone,
        isBot: me.bot ?? false,
      };

      this.connected = true;
    } catch (error) {
      console.error("Connection error:", error);
      throw error;
    }
  }

  /**
   * Disconnect from Telegram
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      await this.client.disconnect();
      this.connected = false;
      console.log("Disconnected");
    } catch (error) {
      console.error("Disconnect error:", error);
    }
  }

  /**
   * Get own user info
   */
  getMe(): TelegramUser | undefined {
    return this.me;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the underlying GramJS client
   */
  getClient(): TelegramClient {
    return this.client;
  }

  /**
   * Add event handler for new messages
   */
  addNewMessageHandler(
    handler: (event: NewMessageEvent) => void | Promise<void>,
    filters?: {
      incoming?: boolean;
      outgoing?: boolean;
      chats?: string[];
      fromUsers?: number[];
      pattern?: RegExp;
    }
  ): void {
    // Debug: wrap handler to log all events (only if DEBUG env var set)
    const wrappedHandler = async (event: NewMessageEvent) => {
      if (process.env.DEBUG) {
        const chatId = event.message.chatId?.toString() ?? "unknown";
        const isGroup = chatId.startsWith("-");
        console.log(
          `🔔 RAW EVENT: chatId=${chatId} isGroup=${isGroup} text="${event.message.message?.substring(0, 30) ?? ""}"`
        );
      }
      await handler(event);
    };
    this.client.addEventHandler(wrappedHandler, new NewMessage(filters ?? {}));
  }

  /**
   * Add callback query handler for inline button clicks
   */
  addCallbackQueryHandler(handler: (event: any) => Promise<void>): void {
    // Listen for callback query updates
    this.client.addEventHandler(async (update) => {
      if (
        update.className === "UpdateBotCallbackQuery" ||
        update.className === "UpdateInlineBotCallbackQuery"
      ) {
        await handler(update);
      }
    });
  }

  /**
   * Answer callback query (for inline button clicks)
   */
  async answerCallbackQuery(
    queryId: any,
    options?: {
      message?: string;
      alert?: boolean;
      url?: string;
    }
  ): Promise<boolean> {
    try {
      await this.client.invoke(
        new Api.messages.SetBotCallbackAnswer({
          queryId: queryId,
          message: options?.message,
          alert: options?.alert,
          url: options?.url,
        })
      );
      return true;
    } catch (error) {
      console.error("Error answering callback query:", error);
      return false;
    }
  }

  /**
   * Send message to a chat/user
   * Automatically converts Markdown to Telegram HTML format
   */
  async sendMessage(
    entity: string | Api.TypePeer,
    options: {
      message: string;
      replyTo?: number;
      silent?: boolean;
      parseMode?: "html" | "md" | "md2" | "none";
    }
  ): Promise<Api.Message> {
    try {
      // Convert Markdown to Telegram HTML by default
      const parseMode = options.parseMode ?? "html";
      const formattedMessage =
        parseMode === "html" ? markdownToTelegramHtml(options.message) : options.message;

      const result = await this.client.sendMessage(entity as any, {
        message: formattedMessage,
        replyTo: options.replyTo,
        silent: options.silent,
        parseMode: parseMode === "none" ? undefined : parseMode,
        linkPreview: false,
      });
      return result;
    } catch (error) {
      if ((error as Error).message.includes("FLOOD_WAIT")) {
        const match = (error as Error).message.match(/(\d+)/);
        const seconds = match ? parseInt(match[1]) : 30;
        console.warn(`Rate limited, waiting ${seconds}s...`);
        await new Promise((r) => setTimeout(r, seconds * 1000));

        // Convert again for retry
        const parseMode = options.parseMode ?? "html";
        const formattedMessage =
          parseMode === "html" ? markdownToTelegramHtml(options.message) : options.message;

        // Retry once
        return await this.client.sendMessage(entity as any, {
          message: formattedMessage,
          replyTo: options.replyTo,
          silent: options.silent,
          parseMode: parseMode === "none" ? undefined : parseMode,
          linkPreview: false,
        });
      }
      throw error;
    }
  }

  /**
   * Get messages from a chat
   */
  async getMessages(
    entity: string,
    options?: {
      limit?: number;
      offsetId?: number;
      search?: string;
    }
  ): Promise<Api.Message[]> {
    const messages = await this.client.getMessages(entity, {
      limit: options?.limit ?? 100,
      offsetId: options?.offsetId,
      search: options?.search,
    });
    return messages;
  }

  /**
   * Get dialogs (chats)
   */
  async getDialogs(): Promise<
    Array<{
      id: bigint;
      title: string;
      isGroup: boolean;
      isChannel: boolean;
    }>
  > {
    const dialogs = await this.client.getDialogs({});
    return dialogs.map((d) => ({
      id: BigInt(d.id?.toString() ?? "0"),
      title: d.title ?? "Unknown",
      isGroup: d.isGroup,
      isChannel: d.isChannel,
    }));
  }

  /**
   * Set typing indicator
   */
  async setTyping(entity: string): Promise<void> {
    try {
      await this.client.invoke(
        new Api.messages.SetTyping({
          peer: entity,
          action: new Api.SendMessageTypingAction(),
        })
      );
    } catch (error) {
      // Ignore typing errors
    }
  }

  /**
   * Resolve username to user/chat
   */
  async resolveUsername(username: string): Promise<Api.TypeUser | Api.TypeChat | undefined> {
    try {
      const result = await this.client.invoke(
        new Api.contacts.ResolveUsername({
          username: username.replace("@", ""),
        })
      );
      return result.users[0] || result.chats[0];
    } catch (error) {
      console.error(`Failed to resolve username ${username}:`, error);
      return undefined;
    }
  }

  /**
   * Get entity (user/chat) by ID or username
   */
  async getEntity(entity: string): Promise<Api.TypeUser | Api.TypeChat> {
    return await this.client.getEntity(entity);
  }
}
