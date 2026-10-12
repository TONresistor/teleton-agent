import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor } from "../../types.js";
import { getClient } from "../../../../sdk/telegram-utils.js";
import { sendTelegramWalletTransfer } from "../../../../telegram/wallet-transfer.js";
import { walletError } from "./reads.js";

type Params = { to: string; amount: string; comment?: string };
export const telegramWalletSendTool: Tool = {
  name: "telegram_wallet_send_transfer",
  description:
    "Send a normal transfer from the Telegram wallet to a TON address or Telegram user. The private backend recovers and unlocks the native signer automatically. If 2FA is pending, the owner must reply to the backend's exact private request; NEVER ask for passwords or recovery phrases as an AI. ALWAYS confirm the exact amount and destination with the owner. A submitted or unknown outcome must never be automatically retried. No gasless, TON Connect or backup changes.",
  parameters: Type.Object({
    to: Type.String({
      minLength: 1,
      description: "Exact TON address, Telegram user ID or @username",
    }),
    amount: Type.String({
      pattern: "^\\d+(?:\\.\\d{1,9})?$",
      description: "Amount in human TON/GRAM units as an exact decimal string, e.g. '0.1'",
    }),
    comment: Type.Optional(Type.String({ maxLength: 1024 })),
  }),
};
export const telegramWalletSendExecutor: ToolExecutor<Params> = async (params, context) => {
  try {
    const data = await sendTelegramWalletTransfer(getClient(context.bridge), params);
    return {
      success: data.status === "submitted",
      data,
      ...(data.status === "unknown" ? { error: data.warning } : {}),
    };
  } catch (error) {
    return { success: false, error: walletError(error) };
  }
};
