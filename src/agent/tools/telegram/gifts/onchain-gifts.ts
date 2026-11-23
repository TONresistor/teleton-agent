import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolEntry, ToolExecutor } from "../../types.js";
import { getClient } from "../../../../sdk/telegram-utils.js";
import { executeGiftTransaction } from "../../../../telegram/gift-transactions.js";
import { getErrorMessage } from "../../../../utils/errors.js";

const ton = Type.String({
  pattern: "^\\d+(?:\\.\\d{1,9})?$",
  description: "Exact TON/GRAM decimal amount",
});
const slug = Type.String({
  pattern: "^[A-Za-z0-9]+-\\d+$",
  description: "Gift slug from t.me/nft/<slug>",
});
const budget = Type.String({
  ...ton,
  description:
    "Owner-approved maximum total TON/GRAM, including estimated network fees. Actual network fees may differ from the estimate.",
});
const instructions =
  "Confirm the gift, action, amount and total budget with the owner. Submitted or unknown transactions must never be automatically retried. Check completion with telegram_wallet_get_transactions_by_hash. If unlocking requires 2FA, follow the private backend request without asking for secrets as an AI.";

const buy: Tool = {
  name: "telegram_buy_onchain_gift",
  description: `Buy a gift with the agent's Telegram wallet. Returns the submitted wallet transaction hash; gift delivery must be checked separately. ${instructions}`,
  parameters: Type.Object({ slug, maxTotalTon: budget }),
};
const sale: Tool = {
  name: "telegram_manage_onchain_gift_sale",
  description: `Change the price or cancel an existing on-chain gift sale owned by the Telegram wallet. ${instructions}`,
  parameters: Type.Object({
    action: Type.Union([Type.Literal("set_price"), Type.Literal("cancel_sale")]),
    slug,
    priceTon: Type.Optional(ton),
    maxTotalTon: budget,
  }),
};
const offer: Tool = {
  name: "telegram_manage_onchain_gift_offer",
  description: `Create, accept, decline or cancel an on-chain gift offer. Creating, accepting and cancelling may send a wallet transaction. ${instructions}`,
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("offer"),
      Type.Literal("accept"),
      Type.Literal("decline"),
      Type.Literal("cancel"),
    ]),
    slug: Type.Optional(slug),
    amountTon: Type.Optional(ton),
    duration: Type.Optional(
      Type.Integer({ minimum: 1, description: "Offer validity in seconds (default 86400)" })
    ),
    offerMsgId: Type.Optional(Type.Integer({ minimum: 1 })),
    maxTotalTon: Type.Optional(budget),
  }),
};

type Params =
  | Parameters<typeof executeGiftTransaction>[1]
  | { action: "decline"; offerMsgId: number };

const executor: ToolExecutor<Params> = async (params, context) => {
  try {
    const client = getClient(context.bridge);
    if (params.action === "decline") {
      if (!Number.isSafeInteger(params.offerMsgId) || params.offerMsgId <= 0)
        throw new Error("Invalid offer message ID");
      await client.invoke(
        new Api.payments.DeclineStarGiftOnchainOffer({ offerMsgId: params.offerMsgId })
      );
      return {
        success: true,
        data: { action: "decline", status: "declined", offerMsgId: params.offerMsgId },
      };
    }
    const data = await executeGiftTransaction(client, params);
    return {
      success: data.status === "submitted",
      data,
      ...(data.status === "unknown" ? { error: data.warning } : {}),
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
};

export const tools: ToolEntry[] = [
  {
    tool: buy,
    executor: (params: { slug: string; maxTotalTon: string }, context) =>
      executor({ ...params, action: "buy" }, context),
    scope: "admin-only",
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: sale,
    executor: (
      params: {
        action: "set_price" | "cancel_sale";
        slug: string;
        priceTon?: string;
        maxTotalTon: string;
      },
      context
    ) => executor({ ...params, priceTon: params.priceTon ?? "" }, context),
    scope: "admin-only",
    mode: "user",
    tags: ["finance"],
  },
  {
    tool: offer,
    executor: (
      params: {
        action: "offer" | "accept" | "decline" | "cancel";
        slug?: string;
        amountTon?: string;
        duration?: number;
        offerMsgId?: number;
        maxTotalTon?: string;
      },
      context
    ) => {
      if (params.action === "offer")
        return executor(
          {
            action: "offer",
            slug: params.slug ?? "",
            amountTon: params.amountTon ?? "",
            duration: params.duration ?? 86400,
            maxTotalTon: params.maxTotalTon ?? "",
          },
          context
        );
      if (params.action === "decline")
        return executor({ action: "decline", offerMsgId: params.offerMsgId ?? 0 }, context);
      return executor(
        {
          action: params.action,
          offerMsgId: params.offerMsgId ?? 0,
          maxTotalTon: params.maxTotalTon ?? "",
        },
        context
      );
    },
    scope: "admin-only",
    mode: "user",
    tags: ["finance"],
  },
];
