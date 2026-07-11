import type { Api } from "telegram";
import { PluginSDKError } from "@teleton-agent/sdk";
import type { ITelegramBridge } from "../../telegram/bridge-interface.js";
import { getErrorMessage } from "../../utils/errors.js";
import {
  getApi,
  getClient as getClientUtil,
  requireBridge as requireBridgeUtil,
} from "../telegram-utils.js";

export type TelegramUserOpContext = {
  client: ReturnType<typeof getClientUtil>;
  Api: typeof Api;
};

export function createTelegramRuntime(bridge: ITelegramBridge, mode?: "user" | "bot") {
  const telegramMode = mode ?? bridge.getMode();

  function requireBridge(): void {
    requireBridgeUtil(bridge);
  }

  function requireUserMode(methodName: string): void {
    if (telegramMode === "bot") {
      throw new PluginSDKError(`sdk.telegram.${methodName}() requires user mode`, "NOT_AVAILABLE");
    }
  }

  function getClient() {
    return getClientUtil(bridge);
  }

  async function userOp<T>(
    name: string,
    label: string,
    fn: (ctx: TelegramUserOpContext) => Promise<T>
  ): Promise<T> {
    requireUserMode(name);
    requireBridge();
    try {
      return await fn({ client: getClient(), Api: await getApi() });
    } catch (error) {
      if (error instanceof PluginSDKError) throw error;
      throw new PluginSDKError(`Failed to ${label}: ${getErrorMessage(error)}`, "OPERATION_FAILED");
    }
  }

  return { telegramMode, requireBridge, requireUserMode, getClient, userOp } as const;
}
