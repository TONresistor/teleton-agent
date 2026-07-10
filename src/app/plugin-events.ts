import type { PluginCallbackEvent, PluginMessageEvent } from "@teleton-agent/sdk";
import type { PluginModule } from "../agent/tools/types.js";
import type { PluginModuleWithHooks } from "../agent/tools/plugin-loader.js";
import type { GramJSUserBridge } from "../telegram/bridges/user.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("App");

export async function dispatchPluginMessage(
  modules: PluginModule[],
  event: PluginMessageEvent
): Promise<void> {
  for (const module of modules) {
    const withHooks = module as PluginModuleWithHooks;
    if (!withHooks.onMessage) continue;
    try {
      await withHooks.onMessage(event);
    } catch (error: unknown) {
      log.error(`❌ [${module.name}] onMessage error: ${getErrorMessage(error)}`);
    }
  }
}

export async function dispatchPluginCallback(
  modules: PluginModule[],
  event: PluginCallbackEvent
): Promise<void> {
  for (const module of modules) {
    const withHooks = module as PluginModuleWithHooks;
    if (!withHooks.onCallbackQuery) continue;
    try {
      await withHooks.onCallbackQuery(event);
    } catch (error: unknown) {
      log.error(`❌ [${module.name}] onCallbackQuery error: ${getErrorMessage(error)}`);
    }
  }
}

export function countPluginEventHooks(
  modules: PluginModule[],
  hook: "onMessage" | "onCallbackQuery"
): number {
  return modules.filter((module) => Boolean((module as PluginModuleWithHooks)[hook])).length;
}

/** Convert a raw GramJS callback update into the stable plugin callback contract. */
export function createUserPluginCallbackHandler(
  bridge: GramJSUserBridge,
  onCallback: (event: PluginCallbackEvent) => Promise<void>
): (update: unknown) => Promise<void> {
  return async (update: unknown) => {
    if (!update || typeof update !== "object") return;
    const callbackUpdate = update as {
      queryId?: unknown;
      data?: { toString(): string } | string;
      peer?: {
        channelId?: { toString(): string };
        chatId?: { toString(): string };
        userId?: { toString(): string };
      };
      msgId?: unknown;
      userId?: unknown;
    };
    const data =
      typeof callbackUpdate.data === "string"
        ? callbackUpdate.data
        : callbackUpdate.data?.toString() || "";
    const [action = "", ...params] = data.split(":");
    const chatId =
      callbackUpdate.peer?.channelId?.toString() ??
      callbackUpdate.peer?.chatId?.toString() ??
      callbackUpdate.peer?.userId?.toString() ??
      "";
    const messageId =
      typeof callbackUpdate.msgId === "number"
        ? callbackUpdate.msgId
        : Number(callbackUpdate.msgId || 0);
    const userId = Number(callbackUpdate.userId);
    const answer = async (text?: string, alert = false): Promise<void> => {
      try {
        await bridge.getClient().answerCallbackQuery(callbackUpdate.queryId, {
          message: text,
          alert,
        });
      } catch (error: unknown) {
        log.error(`❌ Failed to answer callback query: ${getErrorMessage(error)}`);
      }
    };

    await onCallback({ data, action, params, chatId, messageId, userId, answer });
  };
}
