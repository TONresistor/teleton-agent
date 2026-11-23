import { Api, type TelegramClient } from "telegram";
import { Address, Cell, internal, contractAddress, SendMode, toNano } from "@ton/core";
import { sendTelegramWalletMessages, type TelegramWalletMessages } from "./wallet-transfer.js";
import { randomLong, toLong } from "../utils/gramjs-bigint.js";

type GiftOperation =
  | { action: "buy"; slug: string; maxTotalTon: string }
  | { action: "set_price"; slug: string; priceTon: string; maxTotalTon: string }
  | { action: "cancel_sale"; slug: string; maxTotalTon: string }
  | { action: "offer"; slug: string; amountTon: string; duration: number; maxTotalTon: string }
  | { action: "accept"; offerMsgId: number; maxTotalTon: string }
  | { action: "cancel"; offerMsgId: number; maxTotalTon: string };

export function positiveTon(value: string): bigint {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value) || toNano(value) <= 0n)
    throw new Error("Amount must be a positive exact decimal string with at most 9 decimal places");
  return toNano(value);
}

function singleCell(bytes: Buffer): Cell {
  const cells = Cell.fromBoc(bytes);
  if (cells.length !== 1) throw new Error("Expected a single contract payload cell");
  return cells[0];
}

export function giftTransactionMessages(
  payload: Api.payments.TypeStarGiftOnchainSalePayload | Api.payments.StarGiftOnchainOfferTx
): TelegramWalletMessages {
  if (payload instanceof Api.payments.StarGiftOnchainSalePayload) {
    const value = BigInt(payload.amount.toString());
    if (value <= 0n) throw new Error("Invalid Telegram gift transaction amount");
    return {
      messages: [
        internal({
          to: Address.parse(payload.nftAddress),
          value,
          body: singleCell(payload.payload),
          bounce: true,
        }),
      ],
      sendModes: [SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS],
    };
  }
  const messages =
    payload instanceof Api.payments.StarGiftOnchainFixedSalePayload
      ? payload.messages
      : [payload.message];
  const result: TelegramWalletMessages = {
    messages: messages.map((message) => {
      const value = BigInt(message.value.toString());
      if (value < 0n || !Number.isInteger(message.mode) || message.mode < 0 || message.mode > 3)
        throw new Error("Unsupported Telegram gift transaction amount or send mode");
      const to = Address.parse(message.destination);
      const init = message.initState && {
        code: singleCell(message.initState.code),
        data: singleCell(message.initState.data),
      };
      if (init && !contractAddress(to.workChain, init).equals(to))
        throw new Error("Gift contract initialization does not match its destination");
      return internal({ to, value, body: singleCell(message.body), init, bounce: true });
    }),
    sendModes: messages.map((message) => message.mode as SendMode),
  };
  if (payload instanceof Api.payments.StarGiftOnchainOfferTx) result.expiresAt = payload.expiresAt;
  return result;
}

export async function executeGiftTransaction(client: TelegramClient, operation: GiftOperation) {
  const budget = positiveTon(operation.maxTotalTon);
  if (operation.action === "set_price") positiveTon(operation.priceTon);
  if (operation.action === "offer") positiveTon(operation.amountTon);
  if ("slug" in operation && !/^[A-Za-z0-9]+-\d+$/.test(operation.slug))
    throw new Error("Provide the gift slug from its t.me/nft URL");
  if (
    "offerMsgId" in operation &&
    (!Number.isSafeInteger(operation.offerMsgId) || operation.offerMsgId <= 0)
  )
    throw new Error("Offer message ID must be a positive integer");
  if (
    operation.action === "offer" &&
    (!Number.isInteger(operation.duration) || operation.duration <= 0)
  )
    throw new Error("Offer duration must be a positive whole number of seconds");
  const result = await sendTelegramWalletMessages(client, {
    maxTotalTon: operation.maxTotalTon,
    prepare: async (state) => {
      if (operation.action === "accept" || operation.action === "cancel") {
        const request =
          operation.action === "accept"
            ? new Api.payments.AcceptStarGiftOnchainOffer({ offerMsgId: operation.offerMsgId })
            : new Api.payments.CancelStarGiftOnchainOffer({ offerMsgId: operation.offerMsgId });
        return giftTransactionMessages(await client.invoke(request));
      }
      const { gift } = await client.invoke(
        new Api.payments.GetUniqueStarGift({ slug: operation.slug })
      );
      if (!(gift instanceof Api.StarGiftUnique))
        throw new Error("Gift is not a unique collectible");
      if (operation.action === "buy") {
        if (!gift.onchainSale) throw new Error("Gift is not listed for an on-chain purchase");
        const price = gift.resellAmount?.find((amount) => amount instanceof Api.StarsTonAmount);
        if (!price || BigInt(price.amount.toString()) <= 0n)
          throw new Error("No on-chain gift price is available");
        if (BigInt(price.amount.toString()) > budget)
          throw new Error("Gift price exceeds the approved budget");
        return giftTransactionMessages(
          await client.invoke(
            new Api.payments.BuyStarGiftOnchain({
              slug: operation.slug,
              expectedAmount: price.amount,
            })
          )
        );
      }
      if (operation.action === "offer") {
        const amount = positiveTon(operation.amountTon);
        if (amount > budget) throw new Error("Offer amount exceeds the approved budget");
        if (gift.offerMinAmount && amount < BigInt(gift.offerMinAmount.toString()))
          throw new Error("Offer amount is below this gift's minimum");
        return giftTransactionMessages(
          await client.invoke(
            new Api.payments.SendStarGiftOnchainOffer({
              slug: operation.slug,
              amount: toLong(amount),
              duration: operation.duration,
              randomId: randomLong(),
            })
          )
        );
      }
      const owned =
        gift.mySale ||
        (gift.ownerAddress &&
          Address.parse(gift.ownerAddress).equals(Address.parse(state.address)));
      if (!gift.onchainSale || !owned)
        throw new Error("Gift must be an on-chain sale owned by the Telegram wallet");
      const request =
        operation.action === "set_price"
          ? new Api.payments.UpdateStarGiftOnchainPrice({
              slug: operation.slug,
              amount: toLong(positiveTon(operation.priceTon)),
            })
          : new Api.payments.CancelStarGiftOnchainSale({ slug: operation.slug });
      return giftTransactionMessages(await client.invoke(request));
    },
  });
  return {
    ...result,
    action: operation.action,
    ...("slug" in operation ? { slug: operation.slug } : { offerMsgId: operation.offerMsgId }),
  };
}
