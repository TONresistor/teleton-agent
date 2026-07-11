/**
 * Inline router — Grammy middleware that routes inline queries and callbacks
 * to registered plugin handlers by prefix.
 *
 * Queries/callbacks without a known plugin prefix fall through via next().
 */

import type { Context, MiddlewareFn } from "grammy";
import type { InlineQueryResult } from "@grammyjs/types";
import { getGramJSErrorMessage } from "../utils/errors.js";
import type {
  InlineQueryContext,
  InlineResult,
  CallbackContext,
  ChosenResultContext,
  ButtonDef,
  PluginCallbackEvent,
} from "@teleton-agent/sdk";
import type { GramJSBotClient } from "./gramjs-bot.js";
import { splitPrefix } from "./types.js";
import { createLogger } from "../utils/logger.js";
import { toGrammyKeyboard, prefixButtons, stripCustomEmoji } from "../sdk/formatting.js";
import { editInlineViaGramJS } from "./services/inline-transport.js";
import { answerCallbackOnce, hasAnsweredCallback } from "./callback-answer.js";

// Re-exported for callers that import the router's glob compiler (now shared).
export { compileGlob } from "../sdk/formatting.js";

const log = createLogger("InlineRouter");

const INLINE_TIMEOUT_MS = 5_000;
const CALLBACK_TIMEOUT_MS = 15_000;

export interface CallbackEntry {
  pattern: string;
  regex: RegExp;
  handler: (ctx: CallbackContext) => Promise<void>;
}

export interface PluginBotHandlers {
  onInlineQuery?: (ctx: InlineQueryContext) => Promise<InlineResult[]>;
  onCallback?: CallbackEntry[];
  onChosenResult?: (ctx: ChosenResultContext) => Promise<void>;
}

/**
 * Match a pre-compiled glob regex against a string.
 * Returns match groups (the parts matched by `*`) or null.
 */
function globMatch(regex: RegExp, input: string): string[] | null {
  const match = input.match(regex);
  if (!match) return null;
  return match.slice(1);
}

export class InlineRouter {
  private plugins = new Map<string, PluginBotHandlers>();
  private gramjsBot: GramJSBotClient | null = null;
  private callbackObserver: ((event: PluginCallbackEvent) => Promise<void>) | null = null;

  /** Set GramJS bot reference for styled button edits in callbacks */
  setGramJSBot(bot: GramJSBotClient | null): void {
    this.gramjsBot = bot;
  }

  registerPlugin(name: string, handlers: PluginBotHandlers): void {
    this.plugins.set(name, handlers);
    log.info(`Registered plugin "${name}" for inline routing`);
  }

  unregisterPlugin(name: string): void {
    this.plugins.delete(name);
    log.info(`Unregistered plugin "${name}" from inline routing`);
  }

  clearPlugins(): void {
    this.plugins.clear();
  }

  setCallbackObserver(observer: ((event: PluginCallbackEvent) => Promise<void>) | null): void {
    this.callbackObserver = observer;
  }

  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  // ── Prefix routing contract ──────────────────────────────────────────────
  // This middleware peels a `prefix:rest` segment off inline queries / callback
  // data / chosen-result ids (via splitPrefix) and dispatches to the matching
  // registered plugin. Any prefix without a registered plugin handler (or no
  // colon at all) falls through via next().
  middleware(): MiddlewareFn<Context> {
    return async (ctx, next) => {
      // ── Inline Query ─────────────────────────────────
      if (ctx.inlineQuery) {
        const split = splitPrefix(ctx.inlineQuery.query.trim());
        if (split) {
          const plugin = this.plugins.get(split.prefix);
          if (plugin?.onInlineQuery) {
            await this.handleInlineQuery(ctx, split.prefix, split.rest, plugin);
            return; // handled, don't fall through
          }
        }
        // No match — fall through
        return next();
      }

      // ── Callback Query ───────────────────────────────
      if (ctx.callbackQuery?.data) {
        await this.notifyCallbackObserver(ctx);
        const split = splitPrefix(ctx.callbackQuery.data);
        if (split) {
          const plugin = this.plugins.get(split.prefix);
          if (plugin?.onCallback) {
            await this.handleCallback(ctx, split.prefix, split.rest, plugin);
            return;
          }
        }
        return next();
      }

      // ── Chosen Inline Result ─────────────────────────
      if (ctx.chosenInlineResult) {
        const split = splitPrefix(ctx.chosenInlineResult.result_id);
        if (split) {
          const plugin = this.plugins.get(split.prefix);
          if (plugin?.onChosenResult) {
            await this.handleChosenResult(ctx, split.prefix, plugin);
            return;
          }
        }
        return next();
      }

      // Not an inline/callback/chosen event
      return next();
    };
  }

  private async handleInlineQuery(
    ctx: Context,
    pluginName: string,
    query: string,
    plugin: PluginBotHandlers
  ): Promise<void> {
    try {
      const inlineQuery = ctx.inlineQuery;
      const from = ctx.from;
      if (!inlineQuery || !from || !plugin.onInlineQuery) return;

      const iqCtx: InlineQueryContext = {
        query,
        queryId: inlineQuery.id,
        userId: from.id,
        offset: inlineQuery.offset,
      };

      const results = await withTimeout(
        plugin.onInlineQuery(iqCtx),
        INLINE_TIMEOUT_MS,
        `Plugin "${pluginName}" inline handler timed out`
      );

      // Convert plugin results to Grammy inline results
      const grammyResults = results.map((r) => this.toGrammyInlineResult(r, pluginName));

      await ctx.answerInlineQuery(grammyResults, {
        cache_time: 0,
        is_personal: true,
      });
    } catch (error) {
      log.error({ err: error }, `Plugin "${pluginName}" inline query handler failed`);
      // Answer with empty results to avoid Telegram timeout
      try {
        await ctx.answerInlineQuery([], { cache_time: 0, is_personal: true });
      } catch {
        // ignore
      }
    }
  }

  private async handleCallback(
    ctx: Context,
    pluginName: string,
    strippedData: string,
    plugin: PluginBotHandlers
  ): Promise<void> {
    try {
      // Find matching handler
      let matchedHandler: ((ctx: CallbackContext) => Promise<void>) | undefined;
      let matchGroups: string[] = [];

      for (const entry of plugin.onCallback ?? []) {
        const groups = globMatch(entry.regex, strippedData);
        if (groups !== null) {
          matchedHandler = entry.handler;
          matchGroups = groups;
          break;
        }
      }

      if (!matchedHandler) {
        // No pattern match — answer with empty and return
        await answerCallbackOnce(ctx);
        return;
      }

      const gramjsBotRef = this.gramjsBot;
      const callbackQuery = ctx.callbackQuery;
      const from = ctx.from;
      if (!from || !callbackQuery) return;

      const cbCtx: CallbackContext = {
        data: strippedData,
        match: matchGroups,
        userId: from.id,
        username: from.username,
        inlineMessageId: callbackQuery.inline_message_id,
        chatId: ctx.chat?.id?.toString(),
        messageId: callbackQuery.message?.message_id,
        async answer(text?: string, alert?: boolean) {
          await answerCallbackOnce(ctx, { text, show_alert: alert });
        },
        async editMessage(text: string, opts?: { keyboard?: ButtonDef[][]; parseMode?: string }) {
          const styledButtons = opts?.keyboard
            ? prefixButtons(opts.keyboard, pluginName)
            : undefined;

          // Try GramJS for inline messages (styled/colored buttons via MTProto)
          const inlineMsgId = ctx.callbackQuery?.inline_message_id;
          if (inlineMsgId && gramjsBotRef?.isConnected() && styledButtons) {
            try {
              await editInlineViaGramJS({
                gramjsBot: gramjsBotRef,
                inlineMessageId: inlineMsgId,
                html: stripCustomEmoji(text),
                buttons: styledButtons,
              });
              return;
            } catch (error: unknown) {
              log.debug(
                `GramJS edit failed, falling back to Grammy: ${getGramJSErrorMessage(error) || error}`
              );
            }
          }

          // Grammy fallback (no colored buttons)
          const replyMarkup = styledButtons ? toGrammyKeyboard(styledButtons) : undefined;
          await ctx.editMessageText(text, {
            parse_mode: (opts?.parseMode as "HTML" | "MarkdownV2") ?? "HTML",
            link_preview_options: { is_disabled: true },
            reply_markup: replyMarkup,
          });
        },
      };

      await withTimeout(
        matchedHandler(cbCtx),
        CALLBACK_TIMEOUT_MS,
        `Plugin "${pluginName}" callback handler timed out`
      );

      // Auto-answer if plugin didn't
      if (!hasAnsweredCallback(ctx)) {
        await answerCallbackOnce(ctx);
      }
    } catch (error) {
      log.error({ err: error }, `Plugin "${pluginName}" callback handler failed`);
      if (!hasAnsweredCallback(ctx)) {
        try {
          await answerCallbackOnce(ctx, { text: "Error processing action" });
        } catch {
          // ignore
        }
      }
    }
  }

  private async notifyCallbackObserver(ctx: Context): Promise<void> {
    if (!this.callbackObserver || !ctx.callbackQuery?.data) return;

    const data = ctx.callbackQuery.data;
    const parts = data.split(":");
    const event: PluginCallbackEvent = {
      data,
      action: parts[0],
      params: parts.slice(1),
      chatId: ctx.callbackQuery.message?.chat.id?.toString() ?? "",
      messageId: ctx.callbackQuery.message?.message_id ?? 0,
      userId: ctx.callbackQuery.from.id,
      answer: async (text?: string, alert = false) => {
        await answerCallbackOnce(ctx, { text, show_alert: alert });
      },
    };

    try {
      await this.callbackObserver(event);
    } catch (error) {
      log.error({ err: error }, "Plugin callback observer failed");
    }
  }

  private async handleChosenResult(
    ctx: Context,
    pluginName: string,
    plugin: PluginBotHandlers
  ): Promise<void> {
    try {
      const chosenResult = ctx.chosenInlineResult;
      if (!chosenResult || !plugin.onChosenResult) return;

      const resultId = chosenResult.result_id;
      const strippedResultId = splitPrefix(resultId)?.rest ?? resultId;

      const crCtx: ChosenResultContext = {
        resultId: strippedResultId,
        inlineMessageId: chosenResult.inline_message_id,
        query: chosenResult.query,
      };

      await plugin.onChosenResult(crCtx);
    } catch (error) {
      log.error({ err: error }, `Plugin "${pluginName}" chosen result handler failed`);
    }
  }

  /**
   * Convert a plugin InlineResult to a Grammy-compatible inline query result.
   * Result IDs are prefixed with plugin name for routing chosen_inline_result.
   */
  private toGrammyInlineResult(result: InlineResult, pluginName: string): InlineQueryResult {
    const prefixedId = `${pluginName}:${result.id}`;
    const content = result.content;

    // Build reply_markup from plugin keyboard (auto-prefix callbacks)
    const reply_markup = result.keyboard
      ? toGrammyKeyboard(prefixButtons(result.keyboard, pluginName))
      : undefined;

    if ("text" in content) {
      return {
        type: "article" as const,
        id: prefixedId,
        title: result.title,
        description: result.description,
        thumbnail_url: result.thumbUrl,
        reply_markup,
        input_message_content: {
          message_text: content.text,
          parse_mode: content.parseMode ?? "HTML",
          link_preview_options: { is_disabled: true },
        },
      };
    }

    if ("photoUrl" in content) {
      return {
        type: "photo" as const,
        id: prefixedId,
        photo_url: content.photoUrl,
        thumbnail_url: content.thumbUrl ?? content.photoUrl,
        title: result.title,
        description: result.description,
        caption: content.caption,
        reply_markup,
      };
    }

    if ("gifUrl" in content) {
      return {
        type: "gif" as const,
        id: prefixedId,
        gif_url: content.gifUrl,
        thumbnail_url: content.thumbUrl ?? content.gifUrl,
        title: result.title,
        caption: content.caption,
        reply_markup,
      };
    }

    // Fallback to article
    return {
      type: "article" as const,
      id: prefixedId,
      title: result.title,
      description: result.description,
      reply_markup,
      input_message_content: {
        message_text: result.title,
      },
    };
  }
}

/** Run a promise with a timeout. Rejects with TimeoutError if exceeded. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
