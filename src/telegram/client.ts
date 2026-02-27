import { TelegramClient, Api } from "telegram";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import type { NewMessageEvent } from "telegram/events/NewMessage.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { createInterface } from "readline";
import { markdownToTelegramHtml } from "./formatting.js";
import { withFloodRetry } from "./flood-retry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");

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

export class TelegramUserClient {
  private client: TelegramClient;
  private config: TelegramClientConfig;
  private connected = false;
  private me?: TelegramUser;

  constructor(config: TelegramClientConfig) {
    this.config = config;

    const sessionString = this.loadSession();
    const session = new StringSession(sessionString);

    const logger = new Logger(LogLevel.NONE);
    this.client = new TelegramClient(session, config.apiId, config.apiHash, {
      connectionRetries: config.connectionRetries ?? 5,
      retryDelay: config.retryDelay ?? 1000,
      autoReconnect: config.autoReconnect ?? true,
      floodSleepThreshold: config.floodSleepThreshold ?? 60,
      baseLogger: logger,
    });
  }

  private loadSession(): string {
    try {
      if (existsSync(this.config.sessionPath)) {
        return readFileSync(this.config.sessionPath, "utf-8").trim();
      }
    } catch (error) {
      log.warn({ err: error }, "Failed to load session");
    }
    return "";
  }

  private saveSession(): void {
    try {
      const sessionString = this.client.session.save() as string | undefined;
      if (typeof sessionString !== "string" || !sessionString) {
        log.warn("No session string to save");
        return;
      }
      const dir = dirname(this.config.sessionPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.config.sessionPath, sessionString, { encoding: "utf-8", mode: 0o600 });
      log.info("Session saved");
    } catch (error) {
      log.error({ err: error }, "Failed to save session");
    }
  }

  async connect(): Promise<void> {
    if (this.connected) {
      log.info("Already connected");
      return;
    }

    try {
      const hasSession = existsSync(this.config.sessionPath);

      if (hasSession) {
        await this.client.connect();
      } else {
        log.info("Starting authentication flow...");
        const phone = this.config.phone || (await promptInput("Phone number: "));

        await this.client.connect();

        const sendResult = await this.client.invoke(
          new Api.auth.SendCode({
            phoneNumber: phone,
            apiId: this.config.apiId,
            apiHash: this.config.apiHash,
            settings: new Api.CodeSettings({}),
          })
        );

        // SentCodeSuccess means we're already authorized (e.g. session migration)
        if (sendResult instanceof Api.auth.SentCodeSuccess) {
          log.info("Authenticated (SentCodeSuccess)");
          this.saveSession();
        } else if (sendResult instanceof Api.auth.SentCode) {
          const phoneCodeHash = sendResult.phoneCodeHash;

          // Detect Fragment SMS for anonymous numbers (+888)
          if (sendResult.type instanceof Api.auth.SentCodeTypeFragmentSms) {
            const url = (sendResult.type as any).url;
            if (url) {
              console.log(`\n  Anonymous number — open this URL to get your code:\n  ${url}\n`);
            }
          }

          let authenticated = false;
          const maxAttempts = 3;

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const code = await promptInput("Verification code: ");

            try {
              await this.client.invoke(
                new Api.auth.SignIn({
                  phoneNumber: phone,
                  phoneCodeHash,
                  phoneCode: code,
                })
              );
              authenticated = true;
              break;
            } catch (err: any) {
              if (err.errorMessage === "PHONE_CODE_INVALID") {
                const remaining = maxAttempts - attempt - 1;
                if (remaining > 0) {
                  console.log(`Invalid code. ${remaining} attempt(s) remaining.`);
                } else {
                  throw new Error("Authentication failed: too many invalid code attempts");
                }
              } else if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
                // 2FA required
                const pwd = await promptInput("2FA password: ");
                const { computeCheck } = await import("telegram/Password.js");
                const srpResult = await this.client.invoke(new Api.account.GetPassword());
                const srpCheck = await computeCheck(srpResult, pwd);
                await this.client.invoke(new Api.auth.CheckPassword({ password: srpCheck }));
                authenticated = true;
                break;
              } else {
                throw err;
              }
            }
          }

          if (!authenticated) {
            throw new Error("Authentication failed");
          }

          log.info("Authenticated");
          this.saveSession();
        } else {
          throw new Error("Unexpected auth response: payment required or unknown type");
        }
      }

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
      log.error({ err: error }, "Connection error");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      await this.client.disconnect();
      this.connected = false;
      log.info("Disconnected");
    } catch (error) {
      log.error({ err: error }, "Disconnect error");
    }
  }

  getMe(): TelegramUser | undefined {
    return this.me;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getClient(): TelegramClient {
    return this.client;
  }

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
    const wrappedHandler = async (event: NewMessageEvent) => {
      if (process.env.DEBUG) {
        const chatId = event.message.chatId?.toString() ?? "unknown";
        const isGroup = chatId.startsWith("-");
        log.debug(
          `RAW EVENT: chatId=${chatId} isGroup=${isGroup} text="${event.message.message?.substring(0, 30) ?? ""}"`
        );
      }
      await handler(event);
    };
    this.client.addEventHandler(wrappedHandler, new NewMessage(filters ?? {}));
  }

  addServiceMessageHandler(handler: (msg: Api.MessageService) => Promise<void>): void {
    this.client.addEventHandler(async (update) => {
      if (
        (update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateNewChannelMessage) &&
        (update as any).message instanceof Api.MessageService
      ) {
        await handler((update as any).message as Api.MessageService);
      }
    });
  }

  addCallbackQueryHandler(handler: (event: any) => Promise<void>): void {
    this.client.addEventHandler(async (update) => {
      if (
        update.className === "UpdateBotCallbackQuery" ||
        update.className === "UpdateInlineBotCallbackQuery"
      ) {
        await handler(update);
      }
    });
  }

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
      log.error({ err: error }, "Error answering callback query");
      return false;
    }
  }

  async sendMessage(
    entity: string | Api.TypePeer,
    options: {
      message: string;
      replyTo?: number;
      silent?: boolean;
      parseMode?: "html" | "md" | "md2" | "none";
    }
  ): Promise<Api.Message> {
    const parseMode = options.parseMode ?? "html";
    const formattedMessage =
      parseMode === "html" ? markdownToTelegramHtml(options.message) : options.message;

    return withFloodRetry(() =>
      this.client.sendMessage(entity as any, {
        message: formattedMessage,
        replyTo: options.replyTo,
        silent: options.silent,
        parseMode: parseMode === "none" ? undefined : parseMode,
        linkPreview: false,
      })
    );
  }

  async getMessages(
    entity: string | Api.TypePeer,
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

  async setTyping(entity: string): Promise<void> {
    try {
      await this.client.invoke(
        new Api.messages.SetTyping({
          peer: entity,
          action: new Api.SendMessageTypingAction(),
        })
      );
    } catch {
      // setTyping() is cosmetic — ignore FloodWait, permission errors, etc.
    }
  }

  async resolveUsername(username: string): Promise<Api.TypeUser | Api.TypeChat | undefined> {
    const clean = username.replace("@", "");
    try {
      // Call ResolveUsername directly — bypasses GramJS's VALID_USERNAME_RE
      // which rejects collectible usernames shorter than 5 chars.
      const result = await this.client.invoke(
        new Api.contacts.ResolveUsername({ username: clean })
      );
      return result.users[0] || result.chats[0];
    } catch (error: any) {
      log.error({ err: error }, `Failed to resolve username ${clean}`);
      return undefined;
    }
  }

  async getEntity(entity: string): Promise<Api.TypeUser | Api.TypeChat> {
    return await this.client.getEntity(entity);
  }
}
