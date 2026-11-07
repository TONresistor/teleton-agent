/**
 * Bot SDK — per-plugin frozen SDK for inline mode.
 * Follows the same pattern as src/sdk/telegram.ts.
 */

import type { BotSDK, BotManifest, BotKeyboard, ButtonDef, PluginLogger } from "@teleton-agent/sdk";
import type { InlineRouter, PluginBotHandlers } from "../bot/inline-router.js";
import type { GramJSBotClient } from "../bot/gramjs-bot.js";
import type { Bot } from "grammy";
import type { PluginRateLimiter } from "../bot/rate-limiter.js";
import {
  toTLMarkup,
  toGrammyKeyboard,
  prefixButtons,
  stripCustomEmoji,
  compileGlob,
} from "./formatting.js";
import { editInlineViaGramJS } from "../bot/services/inline-transport.js";
import { getGramJSErrorMessage } from "../utils/errors.js";
import { PluginSDKError } from "@teleton-agent/sdk";
import { getErrorMessage } from "../utils/errors.js";

export function createBotSDK(
  router: InlineRouter | null,
  gramjsBot: GramJSBotClient | null,
  grammyBot: Bot | null,
  pluginName: string,
  manifest: BotManifest | undefined,
  rateLimiter: PluginRateLimiter | null,
  log: PluginLogger
): BotSDK | null {
  // No router or no manifest with bot features → null
  if (!router || !manifest || (!manifest.inline && !manifest.callbacks)) {
    return null;
  }

  const inlineLimit = manifest.rateLimits?.inlinePerMinute ?? 30;
  const callbackLimit = manifest.rateLimits?.callbackPerMinute ?? 60;

  // Track accumulated handlers so incremental registration works
  const handlers: PluginBotHandlers = {};

  function syncToRouter(): void {
    router?.registerPlugin(pluginName, { ...handlers });
  }

  const sdk: BotSDK = {
    get isAvailable() {
      return !!router;
    },

    get username() {
      try {
        return grammyBot?.botInfo?.username ?? "";
      } catch {
        return "";
      }
    },

    onInlineQuery(handler) {
      if (!manifest.inline)
        throw new PluginSDKError(
          "Inline queries are not declared in the bot manifest",
          "NOT_AVAILABLE"
        );
      if (handlers.onInlineQuery) {
        log.warn("onInlineQuery called again — overwriting previous handler");
      }
      handlers.onInlineQuery = async (ctx) => {
        if (rateLimiter) {
          rateLimiter.check(pluginName, "inline", inlineLimit);
        }
        return handler(ctx);
      };
      syncToRouter();
    },

    onCallback(pattern, handler) {
      if (!manifest.callbacks)
        throw new PluginSDKError("Callbacks are not declared in the bot manifest", "NOT_AVAILABLE");
      if (!handlers.onCallback) {
        handlers.onCallback = [];
      }
      handlers.onCallback.push({
        pattern,
        regex: compileGlob(pattern),
        handler: async (ctx) => {
          if (rateLimiter) {
            rateLimiter.check(pluginName, "callback", callbackLimit);
          }
          return handler(ctx);
        },
      });
      syncToRouter();
    },

    onChosenResult(handler) {
      if (!manifest.inline)
        throw new PluginSDKError(
          "Inline queries are not declared in the bot manifest",
          "NOT_AVAILABLE"
        );
      handlers.onChosenResult = handler;
      syncToRouter();
    },

    async editInlineMessage(inlineMessageId, text, opts) {
      const keyboard = opts?.keyboard ? prefixButtons(opts.keyboard, pluginName) : undefined;
      const parseMode = opts?.parseMode ?? "HTML";

      // Try GramJS first (styled buttons)
      if (gramjsBot?.isConnected() && parseMode === "HTML") {
        try {
          await editInlineViaGramJS({
            gramjsBot,
            inlineMessageId,
            html: stripCustomEmoji(text),
            buttons: keyboard,
          });
          return;
        } catch (error: unknown) {
          if (!grammyBot)
            throw new PluginSDKError(
              `Failed to edit inline message: ${getErrorMessage(error)}`,
              "OPERATION_FAILED"
            );
          log.warn(
            `GramJS edit failed, falling back to Grammy: ${getGramJSErrorMessage(error) || error}`
          );
        }
      }

      // Grammy fallback
      if (grammyBot) {
        try {
          const kb = keyboard ? toGrammyKeyboard(keyboard) : undefined;
          await grammyBot.api.editMessageTextInline(inlineMessageId, stripCustomEmoji(text), {
            parse_mode: parseMode as "HTML" | "Markdown" | "MarkdownV2",
            link_preview_options: { is_disabled: true },
            reply_markup: kb,
          });
        } catch (error: unknown) {
          const grammyErr = error as { description?: string };
          if (grammyErr.description?.includes("message is not modified")) return;
          throw new PluginSDKError(
            `Failed to edit inline message: ${grammyErr.description || getErrorMessage(error)}`,
            "OPERATION_FAILED"
          );
        }
      } else {
        throw new PluginSDKError(
          "No bot transport is available for this inline edit",
          "NOT_AVAILABLE"
        );
      }
    },

    keyboard(rows: ButtonDef[][]): BotKeyboard {
      const prefixed = prefixButtons(rows, pluginName);
      return {
        rows: rows.map((row) =>
          row.map((btn) => ({
            ...btn,
            callback: btn.callback ? `${pluginName}:${btn.callback}` : undefined,
          }))
        ),
        toGrammy() {
          return toGrammyKeyboard(prefixed);
        },
        toTL() {
          return toTLMarkup(prefixed);
        },
      };
    },
  };

  return Object.freeze(sdk);
}
