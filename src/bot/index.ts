/**
 * Telegram Bot for inline deal confirmations.
 * Grammy (Bot API) + GramJS (MTProto styled buttons).
 */

import { Bot } from "grammy";
import { Api } from "telegram";
import type Database from "better-sqlite3";
import type { BotConfig, DealContext } from "./types.js";
import { DEAL_VERIFICATION_WINDOW_SECONDS } from "../constants/limits.js";
import { decodeCallback } from "./types.js";
import {
  getDeal,
  acceptDeal,
  declineDeal,
  claimPayment,
  setInlineMessageId,
  isDealExpired,
  expireDeal,
} from "./services/deal-service.js";
import {
  buildProposalMessage,
  buildAcceptedMessage,
  buildVerifyingMessage,
  buildCompletedMessage,
  buildDeclinedMessage,
  buildExpiredMessage,
  buildWrongUserMessage,
  buildNotFoundMessage,
  buildMessageForState,
} from "./services/message-builder.js";
import {
  toGrammyKeyboard,
  toTLMarkup,
  hasStyledButtons,
  type StyledButtonDef,
} from "./services/styled-keyboard.js";
import { parseHtml, stripCustomEmoji } from "./services/html-parser.js";
import { GramJSBotClient } from "./gramjs-bot.js";
import { getWalletAddress } from "../ton/wallet-service.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Bot");

export class DealBot {
  private bot: Bot;
  private db: Database.Database;
  private config: BotConfig;
  private gramjsBot: GramJSBotClient | null = null;

  constructor(config: BotConfig, db: Database.Database) {
    this.config = config;
    this.db = db;
    this.bot = new Bot(config.token);

    if (config.apiId && config.apiHash) {
      this.gramjsBot = new GramJSBotClient(config.apiId, config.apiHash, config.gramjsSessionPath);
    }

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.bot.on("inline_query", async (ctx) => {
      const query = ctx.inlineQuery.query.trim();
      const queryId = ctx.inlineQuery.id;
      const userId = ctx.from.id;

      log.info(`🔍 [Bot] Inline query from ${userId}: "${query}"`);

      const dealId = query;

      if (!dealId) {
        await ctx.answerInlineQuery(
          [
            {
              type: "article",
              id: "help",
              title: "How to use",
              description: "Type the deal ID to confirm it",
              input_message_content: {
                message_text:
                  "Type @" + this.config.username + " followed by the deal ID to confirm it.",
              },
            },
          ],
          { cache_time: 0 }
        );
        return;
      }

      const deal = getDeal(this.db, dealId);

      if (!deal) {
        await ctx.answerInlineQuery(
          [
            {
              type: "article",
              id: "not_found",
              title: "❌ Deal not found",
              description: `Deal #${dealId} does not exist`,
              input_message_content: {
                message_text: buildNotFoundMessage(dealId),
                parse_mode: "HTML",
              },
            },
          ],
          { cache_time: 0 }
        );
        return;
      }

      if (isDealExpired(deal) && deal.status === "proposed") {
        expireDeal(this.db, dealId);
        deal.status = "expired";
      }

      const agentWallet = getWalletAddress() || "";
      const { text, buttons } = buildMessageForState(deal, agentWallet);

      if (this.gramjsBot?.isConnected() && hasStyledButtons(buttons)) {
        try {
          await this.answerInlineQueryStyled(queryId, dealId, deal, text, buttons);
          return;
        } catch (error) {
          log.warn({ err: error }, "[Bot] GramJS styled answer failed, falling back to Grammy");
        }
      }

      const keyboard = toGrammyKeyboard(buttons);
      await ctx.answerInlineQuery(
        [
          {
            type: "article",
            id: dealId,
            title: `📋 Deal #${dealId}`,
            description: this.formatShortDescription(deal),
            input_message_content: {
              message_text: stripCustomEmoji(text),
              parse_mode: "HTML",
              link_preview_options: { is_disabled: true },
            },
            reply_markup: hasStyledButtons(buttons) ? keyboard : undefined,
          },
        ],
        { cache_time: 0 }
      );
    });

    this.bot.on("chosen_inline_result", async (ctx) => {
      const resultId = ctx.chosenInlineResult.result_id;
      const inlineMessageId = ctx.chosenInlineResult.inline_message_id;

      if (
        inlineMessageId &&
        resultId !== "help" &&
        resultId !== "not_found" &&
        resultId !== "wrong_user"
      ) {
        setInlineMessageId(this.db, resultId, inlineMessageId);

        const deal = getDeal(this.db, resultId);
        if (deal) {
          const agentWallet = getWalletAddress() || "";
          const { text, buttons } = buildMessageForState(deal, agentWallet);

          let edited = false;
          if (this.gramjsBot?.isConnected()) {
            try {
              await this.editViaGramJS(inlineMessageId, text, buttons);
              edited = true;
            } catch (error: any) {
              log.warn(
                { err: error },
                `[Bot] chosen_inline_result GramJS edit failed: ${error?.errorMessage || error}`
              );
            }
          }

          if (!edited) {
            try {
              const keyboard = hasStyledButtons(buttons) ? toGrammyKeyboard(buttons) : undefined;
              await this.bot.api.editMessageTextInline(inlineMessageId, stripCustomEmoji(text), {
                parse_mode: "HTML",
                link_preview_options: { is_disabled: true },
                reply_markup: keyboard,
              });
            } catch (error: any) {
              log.error(
                { err: error },
                `[Bot] chosen_inline_result Grammy fallback failed: ${error?.description || error}`
              );
            }
          }
        }
      }
    });

    this.bot.on("callback_query:data", async (ctx) => {
      const data = decodeCallback(ctx.callbackQuery.data);
      if (!data) {
        await ctx.answerCallbackQuery({ text: "Invalid action" });
        return;
      }

      const userId = ctx.from.id;
      const { action, dealId } = data;

      log.info(`🔘 [Bot] Callback from ${userId}: ${action} on deal ${dealId}`);

      const inlineMsgId = ctx.callbackQuery.inline_message_id;
      if (inlineMsgId) {
        setInlineMessageId(this.db, dealId, inlineMsgId);
      }

      const deal = getDeal(this.db, dealId);
      if (!deal) {
        await ctx.answerCallbackQuery({ text: "Deal not found" });
        return;
      }

      if (inlineMsgId && !deal.inlineMessageId) {
        deal.inlineMessageId = inlineMsgId;
      }

      if (deal.userId !== userId) {
        await ctx.answerCallbackQuery({ text: "This is not your deal!", show_alert: true });
        return;
      }

      if (isDealExpired(deal) && ["proposed", "accepted"].includes(deal.status)) {
        expireDeal(this.db, dealId);
        const { text, buttons } = buildExpiredMessage(deal);
        await this.editInlineMessage(ctx, text, buttons);
        await ctx.answerCallbackQuery({ text: "Deal expired!" });
        return;
      }

      switch (action) {
        case "accept":
          await this.handleAccept(ctx, deal);
          break;
        case "decline":
          await this.handleDecline(ctx, deal);
          break;
        case "sent":
          await this.handleSent(ctx, deal);
          break;
        case "copy_addr":
          await this.handleCopyAddress(ctx);
          break;
        case "copy_memo":
          await this.handleCopyMemo(ctx, deal);
          break;
        case "refresh":
          await this.handleRefresh(ctx, deal);
          break;
      }
    });

    this.bot.catch((err) => {
      log.error({ err }, "[Bot] Error");
    });
  }

  /**
   * Answer inline query via GramJS with styled buttons.
   * Custom emojis stripped (SetInlineBotResults doesn't support them).
   */
  private async answerInlineQueryStyled(
    queryId: string,
    dealId: string,
    deal: DealContext,
    htmlText: string,
    buttons: StyledButtonDef[][]
  ): Promise<void> {
    if (!this.gramjsBot) throw new Error("GramJS bot not available");

    const strippedHtml = stripCustomEmoji(htmlText);
    const { text: plainText, entities } = parseHtml(strippedHtml);
    const markup = hasStyledButtons(buttons) ? toTLMarkup(buttons) : undefined;

    await this.gramjsBot.answerInlineQuery({
      queryId,
      results: [
        new Api.InputBotInlineResult({
          id: dealId,
          type: "article",
          title: `📋 Deal #${dealId}`,
          description: this.formatShortDescription(deal),
          sendMessage: new Api.InputBotInlineMessageText({
            message: plainText,
            entities: entities.length > 0 ? entities : undefined,
            noWebpage: true,
            replyMarkup: markup,
          }),
        }),
      ],
      cacheTime: 0,
    });
  }

  private async handleAccept(ctx: any, deal: DealContext): Promise<void> {
    if (deal.status !== "proposed") {
      await ctx.answerCallbackQuery({ text: "Already processed" });
      return;
    }

    acceptDeal(this.db, deal.dealId);
    deal.status = "accepted";
    deal.expiresAt = Math.floor(Date.now() / 1000) + DEAL_VERIFICATION_WINDOW_SECONDS;

    const agentWallet = getWalletAddress() || "";
    const { text, buttons } = buildAcceptedMessage(deal, agentWallet);

    await this.editInlineMessage(ctx, text, buttons);
    await ctx.answerCallbackQuery({ text: "✅ Deal accepted!" });

    log.info(`✅ [Bot] Deal ${deal.dealId} accepted by ${deal.userId}`);
  }

  private async handleDecline(ctx: any, deal: DealContext): Promise<void> {
    if (deal.status !== "proposed") {
      await ctx.answerCallbackQuery({ text: "Already processed" });
      return;
    }

    declineDeal(this.db, deal.dealId);
    deal.status = "declined";

    const { text, buttons } = buildDeclinedMessage(deal);

    await this.editInlineMessage(ctx, text, buttons);
    await ctx.answerCallbackQuery({ text: "❌ Deal declined" });

    log.info(`❌ [Bot] Deal ${deal.dealId} declined by ${deal.userId}`);
  }

  private async handleSent(ctx: any, deal: DealContext): Promise<void> {
    if (deal.status !== "accepted") {
      await ctx.answerCallbackQuery({ text: "Not available" });
      return;
    }

    claimPayment(this.db, deal.dealId);
    deal.status = "payment_claimed";

    const { text, buttons } = buildVerifyingMessage(deal);

    await this.editInlineMessage(ctx, text, buttons);
    await ctx.answerCallbackQuery({ text: "⏳ Verifying..." });

    log.info(`📤 [Bot] Deal ${deal.dealId} payment claimed by ${deal.userId}`);
  }

  private async handleCopyAddress(ctx: any): Promise<void> {
    const agentWallet = getWalletAddress() || "";
    await ctx.answerCallbackQuery({
      text: `📋 Address: ${agentWallet}`,
      show_alert: true,
    });
  }

  private async handleCopyMemo(ctx: any, deal: DealContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: `📋 Memo: ${deal.dealId}`,
      show_alert: true,
    });
  }

  private async handleRefresh(ctx: any, deal: DealContext): Promise<void> {
    // Reload deal from DB
    const freshDeal = getDeal(this.db, deal.dealId);
    if (!freshDeal) {
      await ctx.answerCallbackQuery({ text: "Deal not found" });
      return;
    }

    // Update message with current state
    const agentWallet = getWalletAddress() || "";
    const { text, buttons } = buildMessageForState(freshDeal, agentWallet);

    await this.editInlineMessage(ctx, text, buttons);
    await ctx.answerCallbackQuery({ text: "🔄 Refreshed" });
  }

  private async editInlineMessage(
    ctx: any,
    text: string,
    buttons: StyledButtonDef[][]
  ): Promise<void> {
    const inlineMsgId = ctx.callbackQuery?.inline_message_id;
    if (!inlineMsgId) return;

    if (this.gramjsBot?.isConnected()) {
      try {
        await this.editViaGramJS(inlineMsgId, text, buttons);
        return;
      } catch (error: any) {
        if (error?.errorMessage === "MESSAGE_NOT_MODIFIED") return;
        log.warn(
          { err: error },
          `[Bot] GramJS edit failed, falling back to Grammy: ${error?.errorMessage || error}`
        );
      }
    }

    try {
      const keyboard = hasStyledButtons(buttons) ? toGrammyKeyboard(buttons) : undefined;
      await ctx.editMessageText(stripCustomEmoji(text), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
    } catch (error: any) {
      if (error?.description?.includes("message is not modified")) return;
      log.error({ err: error }, "[Bot] Failed to edit inline message");
    }
  }

  async editMessageByInlineId(
    inlineMessageId: string,
    text: string,
    buttons?: StyledButtonDef[][]
  ): Promise<void> {
    if (this.gramjsBot?.isConnected() && buttons) {
      try {
        await this.editViaGramJS(inlineMessageId, text, buttons);
        return;
      } catch (error: any) {
        if (error?.errorMessage === "MESSAGE_NOT_MODIFIED") return;
        log.warn(
          { err: error },
          `[Bot] GramJS edit failed, falling back to Grammy: ${error?.errorMessage || error}`
        );
      }
    }

    try {
      const keyboard = buttons && hasStyledButtons(buttons) ? toGrammyKeyboard(buttons) : undefined;
      await this.bot.api.editMessageTextInline(inlineMessageId, stripCustomEmoji(text), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard,
      });
    } catch (error) {
      log.error({ err: error }, "[Bot] Failed to edit message by inline ID");
    }
  }

  private async editViaGramJS(
    inlineMessageId: string,
    htmlText: string,
    buttons: StyledButtonDef[][]
  ): Promise<void> {
    if (!this.gramjsBot) throw new Error("GramJS bot not available");

    const { text: plainText, entities } = parseHtml(htmlText);
    const markup = hasStyledButtons(buttons) ? toTLMarkup(buttons) : undefined;

    await this.gramjsBot.editInlineMessageByStringId({
      inlineMessageId,
      text: plainText,
      entities: entities.length > 0 ? entities : undefined,
      replyMarkup: markup,
    });
  }

  private formatShortDescription(deal: DealContext): string {
    const userGives =
      deal.userGivesType === "ton"
        ? `${deal.userGivesTonAmount} TON`
        : deal.userGivesGiftSlug || "Gift";
    const agentGives =
      deal.agentGivesType === "ton"
        ? `${deal.agentGivesTonAmount} TON`
        : deal.agentGivesGiftSlug || "Gift";
    return `${userGives} → ${agentGives}`;
  }

  /**
   * Start the bot (non-blocking - long polling runs in background)
   */
  async start(): Promise<void> {
    log.info(`🤖 [Bot] Starting @${this.config.username}...`);

    // Connect GramJS bot for styled buttons (best-effort)
    if (this.gramjsBot) {
      try {
        await this.gramjsBot.connect(this.config.token);
      } catch {
        log.warn("⚠️ [Bot] GramJS MTProto connection failed, buttons will be unstyled");
        this.gramjsBot = null;
      }
    }

    // bot.init() fetches bot info without starting long polling
    await this.bot.init();
    // bot.start() launches long polling - do NOT await (it blocks forever)
    this.bot
      .start({
        onStart: () => log.info(`🤖 [Bot] @${this.config.username} polling started`),
      })
      .catch((err) => {
        log.error({ err }, "[Bot] Polling error");
      });
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    log.info(`🛑 [Bot] Stopping @${this.config.username}...`);
    await this.bot.stop();
    if (this.gramjsBot) {
      await this.gramjsBot.disconnect();
    }
  }

  /**
   * Get bot instance for external access
   */
  getBot(): Bot {
    return this.bot;
  }
}

export {
  getDeal,
  getDealsAwaitingVerification,
  getDealsAwaitingExecution,
} from "./services/deal-service.js";
export {
  buildCompletedMessage,
  buildMessageForState,
  buildSendingMessage,
  buildFailedMessage,
} from "./services/message-builder.js";
export { VerificationPoller } from "./services/verification-poller.js";
