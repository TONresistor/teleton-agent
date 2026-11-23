import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Api } from "telegram";
import { keyPairFromSeed, signVerify } from "@ton/crypto";
import { beginCell, Cell, contractAddress, loadMessage, loadMessageRelaxed } from "@ton/core";
import { toLong } from "../../utils/gramjs-bigint.js";
import type { ToolContext } from "../../agent/tools/types.js";

const mocks = vi.hoisted(() => ({
  root: `/tmp/teleton-onchain-gifts-${process.pid}`,
  invoke: vi.fn(),
  send: vi.fn(),
  estimate: vi.fn(),
  unlock: vi.fn(),
}));
vi.mock("../../workspace/paths.js", () => ({ TELETON_ROOT: mocks.root }));
vi.mock("../../ton/wallet-service.js", () => ({
  getTelegramWalletSigningKeys: () => ({
    anchorSeed: Buffer.alloc(32, 3),
    signingSeed: Buffer.alloc(32, 4),
  }),
  getCachedTonClient: async () => ({
    getContractState: async () => ({
      state: "active",
      code: wallet.init.code.toBoc(),
      data: beginCell().storeUint(0, 72).storeBuffer(signing.publicKey).endCell().toBoc(),
    }),
    open: () => ({ getSeqno: async () => 7 }),
    estimateExternalMessageFee: mocks.estimate,
  }),
}));
vi.mock("../wallet-bootstrap.js", () => ({
  getTelegramWalletBootstrap: () => ({ unlockSigner: mocks.unlock }),
}));
vi.mock("../../sdk/telegram-utils.js", () => ({ getClient: () => client }));

import { NativeTelegramWallet } from "../wallet-protocol.js";
import { giftTransactionMessages } from "../gift-transactions.js";
import { tools } from "../../agent/tools/telegram/gifts/onchain-gifts.js";

const signing = keyPairFromSeed(Buffer.alloc(32, 4));
const wallet = new NativeTelegramWallet(keyPairFromSeed(Buffer.alloc(32, 3)).publicKey);
const destination = contractAddress(0, {
  code: beginCell().storeUint(1, 1).endCell(),
  data: beginCell().endCell(),
});
const state = new Api.WalletState({
  address: wallet.address.toString(),
  publicKey: signing.publicKey,
  balance: toLong("10000000000"),
});
const payload = beginCell().storeUint(1234, 32).endCell().toBoc();
const client = {
  invoke: mocks.invoke,
  getSender: async () => ({ send: mocks.send }),
  session: { dcId: 2 },
};
const context = {} as ToolContext;
let gift: Api.StarGiftUnique;
let contractPayload: Api.payments.TypeStarGiftOnchainSalePayload;

async function call(index: number, params: unknown) {
  return tools[index].executor(params, context);
}

beforeEach(() => {
  vi.clearAllMocks();
  rmSync(mocks.root, { recursive: true, force: true });
  mkdirSync(mocks.root, { recursive: true });
  gift = new Api.StarGiftUnique({
    id: toLong(1),
    giftId: toLong(2),
    title: "Plush",
    slug: "Plush-1",
    num: 1,
    attributes: [],
    availabilityIssued: 1,
    availabilityTotal: 2,
    onchainSale: true,
    mySale: true,
    resellAmount: [new Api.StarsTonAmount({ amount: toLong("1000000000") })],
  });
  contractPayload = new Api.payments.StarGiftOnchainSalePayload({
    nftAddress: destination.toString(),
    amount: toLong("1100000000"),
    payload,
  });
  mocks.estimate.mockResolvedValue({
    source_fees: { in_fwd_fee: 100, storage_fee: 100, gas_fee: 100, fwd_fee: 100 },
  });
  mocks.invoke.mockImplementation(async (request) => {
    if (request instanceof Api.wallet.GetState) return state;
    if (request instanceof Api.payments.GetUniqueStarGift)
      return new Api.payments.UniqueStarGift({ gift, chats: [], users: [] });
    if (request instanceof Api.payments.DeclineStarGiftOnchainOffer)
      return new Api.Updates({ updates: [], users: [], chats: [], date: 0, seq: 0 });
    if (request instanceof Api.wallet.GetTransactionsByMsgHash)
      return new Api.wallet.Transactions({
        balance: toLong(1),
        transactions: [],
        chats: [],
        users: [],
      });
    return contractPayload;
  });
  mocks.send.mockResolvedValue(
    new Api.Updates({
      updates: [new Api.UpdateSentWalletTransaction({ msgHash: "fixture-hash" })],
      users: [],
      chats: [],
      date: 0,
      seq: 0,
    })
  );
});
afterEach(() => {
  rmSync(mocks.root, { recursive: true, force: true });
});

describe("on-chain gift tools", () => {
  it("registers three native Telegram tools with object schemas and admin access", () => {
    expect(tools).toHaveLength(3);
    for (const entry of tools) {
      expect(entry.mode).toBe("user");
      expect(entry.scope).toBe("admin-only");
      expect(entry.tool.parameters.type).toBe("object");
    }
  });
  it.each([
    [0, { slug: "Plush-1", maxTotalTon: "2" }, Api.payments.BuyStarGiftOnchain],
    [
      1,
      { action: "set_price", slug: "Plush-1", priceTon: "1.000000001", maxTotalTon: "2" },
      Api.payments.UpdateStarGiftOnchainPrice,
    ],
    [
      1,
      { action: "cancel_sale", slug: "Plush-1", maxTotalTon: "2" },
      Api.payments.CancelStarGiftOnchainSale,
    ],
    [
      2,
      { action: "offer", slug: "Plush-1", amountTon: "1", maxTotalTon: "2" },
      Api.payments.SendStarGiftOnchainOffer,
    ],
    [
      2,
      { action: "accept", offerMsgId: 123, maxTotalTon: "2" },
      Api.payments.AcceptStarGiftOnchainOffer,
    ],
    [
      2,
      { action: "cancel", offerMsgId: 123, maxTotalTon: "2" },
      Api.payments.CancelStarGiftOnchainOffer,
    ],
  ] as const)(
    "prepares action %j and signs one Telegram transfer",
    async (index, params, requestType) => {
      if (index === 2)
        contractPayload = new Api.payments.StarGiftOnchainFixedSalePayload({
          saleAddress: destination.toString(),
          messages: [
            new Api.payments.StarGiftOnchainOfferTxMessage({
              destination: destination.toString(),
              value: toLong("1100000000"),
              body: payload,
              mode: 1,
            }),
          ],
        });
      const result = await call(index, params);
      expect(result).toMatchObject({
        success: true,
        data: {
          status: "submitted",
          messageHash: "fixture-hash",
          amount: "1.1",
          estimatedNetworkFeeTon: "0.0000004",
        },
      });
      const request = mocks.invoke.mock.calls.map(([r]) => r).find((r) => r instanceof requestType);
      expect(request).toBeDefined();
      if (request instanceof Api.payments.BuyStarGiftOnchain)
        expect(request.expectedAmount.toString()).toBe("1000000000");
      if (request instanceof Api.payments.UpdateStarGiftOnchainPrice)
        expect(request.amount.toString()).toBe("1000000001");
      if (request instanceof Api.payments.SendStarGiftOnchainOffer)
        expect(request.duration).toBe(86400);
      expect(mocks.send).toHaveBeenCalledOnce();
      const transfer = mocks.send.mock.calls[0][0] as Api.wallet.SendTransfer;
      const external = loadMessage(Cell.fromBoc(transfer.dataNormal)[0].beginParse());
      const body = external.body.beginParse();
      const signature = body.loadBuffer(64);
      expect(signVerify(body.asCell().hash(), signature, signing.publicKey)).toBe(true);
      body.skip(32 + 32 + 32 + 32);
      expect(body.loadUint(8)).toBe(index === 2 ? 1 : 3);
      const message = loadMessageRelaxed(body.loadRef().beginParse());
      expect(message.info.type === "internal" && message.info.value.coins).toBe(1_100_000_000n);
      expect(message.body.hash()).toEqual(Cell.fromBoc(payload)[0].hash());
    }
  );

  it("declines an offer without invoking the signer", async () => {
    expect(await call(2, { action: "decline", offerMsgId: 12 })).toMatchObject({
      success: true,
      data: { status: "declined" },
    });
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("includes fees in the budget and never sends an over-budget purchase", async () => {
    const result = await call(0, { slug: "Plush-1", maxTotalTon: "1.1" });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("fees exceed") });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(existsSync(join(mocks.root, "telegram-wallet-pending.json"))).toBe(false);
  });

  it("refuses prices above budget and sales belonging to another wallet", async () => {
    expect(await call(0, { slug: "Plush-1", maxTotalTon: "0.5" })).toMatchObject({
      success: false,
    });
    gift.mySale = false;
    expect(
      await call(1, { action: "cancel_sale", slug: "Plush-1", maxTotalTon: "2" })
    ).toMatchObject({ success: false, error: expect.stringContaining("owned") });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    [1, { action: "set_price", slug: "Plush-1", maxTotalTon: "2" }],
    [2, { action: "offer", slug: "Plush-1", maxTotalTon: "2" }],
    [2, { action: "accept", offerMsgId: 12 }],
    [2, { action: "decline" }],
  ])("rejects missing action arguments before an RPC", async (index, params) => {
    expect(await call(index as number, params)).toMatchObject({ success: false });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("preserves an ambiguous transfer outcome and does not resubmit", async () => {
    mocks.send.mockRejectedValue(new Error("network lost"));
    expect(await call(0, { slug: "Plush-1", maxTotalTon: "2" })).toMatchObject({
      success: false,
      data: { status: "unknown" },
    });
    expect(await call(0, { slug: "Plush-1", maxTotalTon: "2" })).toMatchObject({
      success: false,
      error: expect.stringContaining("still unresolved"),
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(
      mocks.invoke.mock.calls.filter(([r]) => r instanceof Api.payments.BuyStarGiftOnchain)
    ).toHaveLength(1);
  });

  it("decodes offer transactions and rejects expired ones before submission", async () => {
    const offer = new Api.payments.StarGiftOnchainOfferTx({
      offerId: toLong(1),
      offerAddress: destination.toString(),
      expiresAt: 1,
      message: new Api.payments.StarGiftOnchainOfferTxMessage({
        destination: destination.toString(),
        value: toLong("1"),
        mode: 3,
        body: payload,
      }),
    });
    expect(giftTransactionMessages(offer).expiresAt).toBe(1);
    mocks.invoke.mockImplementation(async (request) =>
      request instanceof Api.wallet.GetState ? state : offer
    );
    expect(await call(2, { action: "accept", offerMsgId: 12, maxTotalTon: "2" })).toMatchObject({
      success: false,
      error: expect.stringContaining("expired"),
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects unsafe send modes and mismatched contract initialization", () => {
    const message = new Api.payments.StarGiftOnchainOfferTxMessage({
      destination: destination.toString(),
      value: toLong(1),
      mode: 128,
      body: payload,
    });
    const fixed = new Api.payments.StarGiftOnchainFixedSalePayload({
      saleAddress: destination.toString(),
      messages: [message],
    });
    expect(() => giftTransactionMessages(fixed)).toThrow("send mode");
    message.mode = 3;
    message.initState = new Api.payments.StarGiftOnchainOfferTxInitState({
      code: payload,
      data: payload,
    });
    expect(() => giftTransactionMessages(fixed)).toThrow("initialization");
  });
});
