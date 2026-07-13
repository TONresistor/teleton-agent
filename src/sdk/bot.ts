/**
 * Bot SDK — per-plugin frozen SDK for inline mode.
 * Follows the same pattern as src/sdk/telegram.ts.
 */

import type { BotSDK, BotManifest, BotKeyboard, ButtonDef, PluginLogger } from "@teleton-agent/sdk";
import type { PluginBotHandlers, PluginBotRegistrationTarget } from "../bot/inline-router.js";
import type { PluginExecutionGate } from "../agent/tools/plugin-execution-gate.js";
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

export function createBotSDK(
  router: PluginBotRegistrationTarget | null,
  gramjsBot: GramJSBotClient | null,
  grammyBot: Bot | null,
  pluginName: string,
  manifest: BotManifest | undefined,
  rateLimiter: PluginRateLimiter | null,
  log: PluginLogger,
  executionGate?: PluginExecutionGate
): BotSDK | null {
  // No router or no manifest with bot features → null
  if (!router || !manifest || (!manifest.inline && !manifest.callbacks)) {
    return null;
  }

  const inlineLimit = manifest.rateLimits?.inlinePerMinute ?? 30;
  const callbackLimit = manifest.rateLimits?.callbackPerMinute ?? 60;

  // Track accumulated handlers so incremental registration works
  const handlers: PluginBotHandlers = {};

  async function withExecutionGate<T>(operation: () => Promise<T>): Promise<T> {
    const release = executionGate?.enter(pluginName);
    if (executionGate && !release) {
      throw new Error(`Plugin "${pluginName}" is reloading`);
    }
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

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
      if (handlers.onInlineQuery) {
        log.warn("onInlineQuery called again — overwriting previous handler");
      }
      handlers.onInlineQuery = async (ctx) => {
        if (rateLimiter) {
          rateLimiter.check(pluginName, "inline", inlineLimit);
        }
        return withExecutionGate(() => handler(ctx));
      };
      syncToRouter();
    },

    onCallback(pattern, handler) {
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
          return withExecutionGate(() => handler(ctx));
        },
      });
      syncToRouter();
    },

    onChosenResult(handler) {
      handlers.onChosenResult = (ctx) => withExecutionGate(() => handler(ctx));
      syncToRouter();
    },

    async editInlineMessage(inlineMessageId, text, opts) {
      const keyboard = opts?.keyboard ? prefixButtons(opts.keyboard, pluginName) : undefined;

      // Try GramJS first (styled buttons)
      if (gramjsBot?.isConnected() && keyboard) {
        try {
          await editInlineViaGramJS({
            gramjsBot,
            inlineMessageId,
            html: stripCustomEmoji(text),
            buttons: keyboard,
          });
          return;
        } catch (error: unknown) {
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
            parse_mode: (opts?.parseMode as "HTML" | "MarkdownV2") ?? "HTML",
            link_preview_options: { is_disabled: true },
            reply_markup: kb,
          });
        } catch (error: unknown) {
          const grammyErr = error as { description?: string };
          if (grammyErr.description?.includes("message is not modified")) return;
          log.error(`Failed to edit inline message: ${grammyErr.description || error}`);
        }
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
