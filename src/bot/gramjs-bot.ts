/**
 * GramJS bot client for MTProto-level inline query answers and message edits
 * Used alongside Grammy to send styled (colored) inline keyboard buttons
 * and native copy-to-clipboard buttons.
 *
 * Grammy (Bot API HTTP) handles:  receiving events (inline queries, callbacks)
 * GramJS (MTProto direct) handles: answering inline queries + editing messages with styled buttons
 *
 * Both sessions coexist: MTProto updates are broadcast to all sessions,
 * so Grammy's getUpdates queue remains unaffected.
 */

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Logger, LogLevel } from "telegram/extensions/Logger.js";
import bigInt from "big-integer";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { GRAMJS_RETRY_DELAY_MS, GRAMJS_CONNECT_RETRY_DELAY_MS } from "../constants/timeouts.js";
import { TELEGRAM_CONNECTION_RETRIES } from "../constants/limits.js";
import { withFloodRetry } from "../telegram/flood-retry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Bot");

/**
 * Decode Bot API inline_message_id string to GramJS InputBotInlineMessageID TL object.
 *
 * Bot API encodes the inline message ID as base64:
 *   20 bytes → InputBotInlineMessageID (dc_id:4 + id:8 + access_hash:8)
 *   24 bytes → InputBotInlineMessageID64 (dc_id:4 + owner_id:8 + id:4 + access_hash:8)
 */
export function decodeInlineMessageId(encoded: string): Api.TypeInputBotInlineMessageID {
  const buf = Buffer.from(encoded, "base64url");

  if (buf.length === 20) {
    return new Api.InputBotInlineMessageID({
      dcId: buf.readInt32LE(0),
      id: bigInt(buf.readBigInt64LE(4).toString()),
      accessHash: bigInt(buf.readBigInt64LE(12).toString()),
    });
  } else if (buf.length === 24) {
    return new Api.InputBotInlineMessageID64({
      dcId: buf.readInt32LE(0),
      ownerId: bigInt(buf.readBigInt64LE(4).toString()),
      id: buf.readInt32LE(12),
      accessHash: bigInt(buf.readBigInt64LE(16).toString()),
    });
  }

  throw new Error(`Unknown inline_message_id format (${buf.length} bytes)`);
}

export class GramJSBotClient {
  private client: TelegramClient;
  private connected = false;
  private sessionPath: string | undefined;

  constructor(apiId: number, apiHash: string, sessionPath?: string) {
    this.sessionPath = sessionPath;
    const sessionString = this.loadSession();
    const logger = new Logger(LogLevel.NONE);
    this.client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      connectionRetries: 3,
      retryDelay: GRAMJS_RETRY_DELAY_MS,
      autoReconnect: true,
      baseLogger: logger,
    });
  }

  private loadSession(): string {
    if (!this.sessionPath) return "";
    try {
      if (existsSync(this.sessionPath)) {
        return readFileSync(this.sessionPath, "utf-8").trim();
      }
    } catch (error) {
      log.warn({ err: error }, "[GramJS Bot] Failed to load session");
    }
    return "";
  }

  private saveSession(): void {
    if (!this.sessionPath) return;
    try {
      const sessionString = this.client.session.save() as string | undefined;
      if (typeof sessionString !== "string" || !sessionString) return;
      const dir = dirname(this.sessionPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.sessionPath, sessionString, { encoding: "utf-8", mode: 0o600 });
      log.debug("[GramJS Bot] Session saved");
    } catch (error) {
      log.error({ err: error }, "[GramJS Bot] Failed to save session");
    }
  }

  /**
   * Connect and authenticate as bot via MTProto.
   * Retries on transient -500 "No workers running" errors (DC overload).
   */
  async connect(botToken: string): Promise<void> {
    for (let attempt = 1; attempt <= TELEGRAM_CONNECTION_RETRIES; attempt++) {
      try {
        await this.client.start({ botAuthToken: botToken });
        this.connected = true;
        this.saveSession();
        return;
      } catch (error: any) {
        const isTransient = error?.code === -500;
        if (isTransient && attempt < TELEGRAM_CONNECTION_RETRIES) {
          const delay = GRAMJS_CONNECT_RETRY_DELAY_MS * attempt;
          log.warn(
            `[GramJS Bot] Transient -500 error, retrying in ${delay / 1000}s (attempt ${attempt}/${TELEGRAM_CONNECTION_RETRIES})`
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        log.error({ err: error }, "[GramJS Bot] Connection failed");
        throw error;
      }
    }
  }

  isConnected(): boolean {
    return this.connected && !!this.client.connected;
  }

  /**
   * Answer an inline query with styled buttons via MTProto
   */
  async answerInlineQuery(params: {
    queryId: string;
    results: Api.TypeInputBotInlineResult[];
    cacheTime?: number;
  }): Promise<void> {
    if (!this.isConnected()) throw new Error("GramJS bot not connected");

    await withFloodRetry(() =>
      this.client.invoke(
        new Api.messages.SetInlineBotResults({
          queryId: bigInt(params.queryId),
          results: params.results,
          cacheTime: params.cacheTime ?? 0,
        })
      )
    );
  }

  /**
   * Edit an inline message with styled/copy buttons via MTProto.
   * Accepts the Bot API inline_message_id string directly (decodes internally).
   */
  async editInlineMessageByStringId(params: {
    inlineMessageId: string;
    text: string;
    entities?: Api.TypeMessageEntity[];
    replyMarkup?: Api.TypeReplyMarkup;
  }): Promise<void> {
    if (!this.isConnected()) throw new Error("GramJS bot not connected");

    const id = decodeInlineMessageId(params.inlineMessageId);
    const dcId = "dcId" in id ? (id.dcId as number) : undefined;

    await withFloodRetry(() =>
      this.client.invoke(
        new Api.messages.EditInlineBotMessage({
          id,
          message: params.text,
          entities: params.entities,
          replyMarkup: params.replyMarkup,
          noWebpage: true,
        }),
        dcId
      )
    );
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.disconnect();
      this.connected = false;
      log.info("[GramJS Bot] Disconnected");
    } catch (error) {
      log.error({ err: error }, "[GramJS Bot] Disconnect error");
    }
  }
}
