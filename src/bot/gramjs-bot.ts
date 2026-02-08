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
import { GRAMJS_RETRY_DELAY_MS } from "../constants/timeouts.js";

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

  constructor(apiId: number, apiHash: string) {
    const logger = new Logger(LogLevel.NONE);
    this.client = new TelegramClient(new StringSession(""), apiId, apiHash, {
      connectionRetries: 3,
      retryDelay: GRAMJS_RETRY_DELAY_MS,
      autoReconnect: true,
      baseLogger: logger,
    });
  }

  /**
   * Connect and authenticate as bot via MTProto
   */
  async connect(botToken: string): Promise<void> {
    try {
      await this.client.start({ botAuthToken: botToken });
      this.connected = true;
      // Styled buttons ready (MTProto connected)
    } catch (error) {
      console.error("❌ [GramJS Bot] Connection failed:", error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Answer an inline query with styled buttons via MTProto
   */
  async answerInlineQuery(params: {
    queryId: string;
    results: Api.TypeInputBotInlineResult[];
    cacheTime?: number;
  }): Promise<void> {
    if (!this.connected) throw new Error("GramJS bot not connected");

    await this.client.invoke(
      new Api.messages.SetInlineBotResults({
        queryId: bigInt(params.queryId),
        results: params.results,
        cacheTime: params.cacheTime ?? 0,
      })
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
    if (!this.connected) throw new Error("GramJS bot not connected");

    const id = decodeInlineMessageId(params.inlineMessageId);
    const dcId = (id as any).dcId as number;

    await this.client.invoke(
      new Api.messages.EditInlineBotMessage({
        id,
        message: params.text,
        entities: params.entities,
        replyMarkup: params.replyMarkup,
        noWebpage: true,
      }),
      dcId
    );
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.disconnect();
      this.connected = false;
      console.log("🛑 [GramJS Bot] Disconnected");
    } catch (error) {
      console.error("❌ [GramJS Bot] Disconnect error:", error);
    }
  }
}
