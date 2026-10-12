import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolEntry } from "../../types.js";
import { getClient } from "../../../../sdk/telegram-utils.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { getTelegramWalletBootstrap } from "../../../../telegram/wallet-bootstrap.js";

export function walletData(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(walletData);
  if (value && typeof value === "object") {
    if ("toJSNumber" in value) return value.toString();
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, entry]) => !key.startsWith("_") && typeof entry !== "function")
        .map(([key, entry]) => [key, walletData(entry)])
    );
  }
  return value;
}

export function walletError(error: unknown): string {
  const message = getErrorMessage(error);
  return message.includes("WALLET_UNAVAILABLE")
    ? `${message}. Telegram's wallet service is unavailable for this request. This is not proof that the target user has no wallet.`
    : message;
}

type ReadParams = {
  offset?: string;
  limit?: number;
  inbound?: boolean;
  outbound?: boolean;
  ids?: string[];
  hashes?: string[];
};
const ids = Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100 });
const definitions: Array<{ tool: Tool; request: (params: ReadParams) => Api.AnyRequest }> = [
  {
    tool: {
      name: "telegram_wallet_get_state",
      description:
        "Read the Telegram account's own wallet address, public key, raw balance and availability. For TgWallet agents, this is the same wallet used by Teleton's TON methods.",
      category: "data-bearing",
      parameters: Type.Object({}),
    },
    request: () => new Api.wallet.GetState(),
  },
  {
    tool: {
      name: "telegram_wallet_get_transactions",
      description:
        "Read the Telegram wallet transaction history with pagination. Amounts and fees are raw protocol units.",
      category: "data-bearing",
      parameters: Type.Object({
        offset: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
        inbound: Type.Optional(Type.Boolean()),
        outbound: Type.Optional(Type.Boolean()),
      }),
    },
    request: (p) =>
      new Api.wallet.GetTransactions({
        offset: p.offset ?? "",
        limit: p.limit ?? 20,
        inbound: p.inbound || undefined,
        outbound: p.outbound || undefined,
      }),
  },
  {
    tool: {
      name: "telegram_wallet_get_transactions_by_ids",
      description: "Read Telegram wallet transactions by their Telegram transaction IDs.",
      category: "data-bearing",
      parameters: Type.Object({ ids }),
    },
    request: (p) => new Api.wallet.GetTransactionsByIDs({ id: p.ids ?? [] }),
  },
  {
    tool: {
      name: "telegram_wallet_get_transactions_by_hash",
      description:
        "Read Telegram wallet transactions by message hashes. Use this to inspect a submitted transfer before considering another send.",
      category: "data-bearing",
      parameters: Type.Object({ hashes: ids }),
    },
    request: (p) => new Api.wallet.GetTransactionsByMsgHash({ msgHash: p.hashes ?? [] }),
  },
  {
    tool: {
      name: "telegram_wallet_get_nfts",
      description: "List NFTs in the Telegram wallet, with pagination.",
      category: "data-bearing",
      parameters: Type.Object({
        offset: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      }),
    },
    request: (p) => new Api.wallet.GetNfts({ offset: p.offset ?? "", limit: p.limit ?? 20 }),
  },
  {
    tool: {
      name: "telegram_wallet_get_gasless_info",
      description:
        "Read Telegram wallet gasless availability, quota, reset time, minimum amount and relayer address. Does not send a transfer.",
      category: "data-bearing",
      parameters: Type.Object({}),
    },
    request: () => new Api.wallet.GetGaslessInfo(),
  },
  {
    tool: {
      name: "telegram_wallet_get_existing_balance",
      description:
        "Read Telegram's existing Walt balance indicator and associated URL. This response does not contain a numeric balance.",
      category: "data-bearing",
      parameters: Type.Object({}),
    },
    request: () => new Api.wallet.GetExistingWaltBalance(),
  },
];

export const tools: ToolEntry[] = definitions.map(({ tool, request }) => {
  const executor: ToolExecutor<ReadParams> = async (params, context) => {
    try {
      const client = getClient(context.bridge);
      const result = await client.invoke(request(params));
      const data = walletData(result);
      return {
        success: true,
        data:
          tool.name === "telegram_wallet_get_state" && data && typeof data === "object"
            ? {
                ...data,
                signerStatus: getTelegramWalletBootstrap(client)?.status ?? "not_initialized",
              }
            : data,
      };
    } catch (error) {
      return { success: false, error: walletError(error) };
    }
  };
  return { tool, executor, scope: "admin-only", mode: "user", tags: ["finance"] };
});
