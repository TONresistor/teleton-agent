import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginSDKError } from "@teleton-agent/sdk";
import {
  Address,
  beginCell,
  Dictionary,
  TupleReader,
  type Message,
  type Transaction,
} from "@ton/core";
import { WalletContractV5R1 } from "@ton/ton";

const mocks = vi.hoisted(() => ({
  tonapiFetch: vi.fn(),
  loadWallet: vi.fn(),
  getKeyPair: vi.fn(),
  getCachedTonClient: vi.fn(),
  sendWalletTx: vi.fn(),
  getTransactions: vi.fn(),
  tryLocateResultTx: vi.fn(),
  runMethod: vi.fn(),
  linkDnsWallet: vi.fn(),
  unlinkDnsWallet: vi.fn(),
  setDnsSite: vi.fn(),
}));

vi.mock("../../constants/api-endpoints.js", () => ({ tonapiFetch: mocks.tonapiFetch }));
vi.mock("../../ton/wallet-service.js", () => ({
  loadWallet: mocks.loadWallet,
  getKeyPair: mocks.getKeyPair,
  getCachedTonClient: mocks.getCachedTonClient,
}));
vi.mock("../../ton/confirm.js", () => ({ sendWalletTx: mocks.sendWalletTx }));
vi.mock("../../ton/tx-lock.js", () => ({ withTxLock: (fn: () => Promise<unknown>) => fn() }));
vi.mock("../../constants/timeouts.js", () => ({
  TON_CONFIRM_TIMEOUT_MS: 120,
  TON_CONFIRM_POLL_INTERVAL_MS: 10,
}));
vi.mock("../../ton/dns-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../ton/dns-service.js")>();
  return {
    ...original,
    linkDnsWallet: mocks.linkDnsWallet,
    unlinkDnsWallet: mocks.unlinkDnsWallet,
    setDnsSite: mocks.setDnsSite,
  };
});

import { DnsUpdateError } from "../../ton/dns-service.js";
import { createDnsSDK } from "../ton-dns.js";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ROOT = Address.parse("EQC3dNlesgVD8YbAazcauIrXBPfiVhMMr5YYk2in0Mtsz0Bz");
const NFT = Address.parse(`0:${"22".repeat(32)}`);
const OTHER = Address.parse(`0:${"33".repeat(32)}`);
const WALLET = WalletContractV5R1.create({ workchain: 0, publicKey: Buffer.alloc(32) }).address;
const WALLET_TX_HASH = "ab".repeat(32);
const EMPTY = beginCell().endCell();

function chainMessage(
  src: Address,
  dest: Address,
  createdLt: bigint,
  body = EMPTY,
  value = 1_000_000_000n
): Message {
  return {
    info: {
      type: "internal",
      ihrDisabled: true,
      bounce: true,
      bounced: false,
      src,
      dest,
      value: { coins: value },
      ihrFee: 0n,
      forwardFee: 1n,
      createdLt,
      createdAt: 1,
    },
    body,
  };
}

function transaction(inMessage: Message, messages: Message[] = []): Transaction {
  const outMessages = Dictionary.empty<number, Message>();
  messages.forEach((message, index) => outMessages.set(index, message));
  return {
    address: 0n,
    lt: 100n,
    prevTransactionHash: 0n,
    prevTransactionLt: 0n,
    now: Math.floor(Date.now() / 1000),
    outMessagesCount: messages.length,
    oldStatus: "active",
    endStatus: "active",
    inMessage: { ...inMessage, info: { ...inMessage.info } },
    outMessages,
    totalFees: { coins: 0n },
    stateUpdate: { oldHash: Buffer.alloc(32), newHash: Buffer.alloc(32) },
    raw: EMPTY,
    hash: () => Buffer.from(WALLET_TX_HASH, "hex"),
    description: {
      type: "generic",
      creditFirst: false,
      aborted: false,
      destroyed: false,
      computePhase: {
        type: "vm",
        success: true,
        messageStateUsed: false,
        accountActivated: false,
        gasFees: 0n,
        gasUsed: 0n,
        gasLimit: 0n,
        mode: 0,
        exitCode: 0,
        vmSteps: 1,
        vmInitStateHash: 0n,
        vmFinalStateHash: 0n,
      },
      actionPhase: {
        success: true,
        valid: true,
        noFunds: false,
        statusChange: "unchanged",
        resultCode: 0,
        totalActions: messages.length,
        specActions: 0,
        skippedActions: 0,
        messagesCreated: messages.length,
        actionListHash: 0n,
        totalMessageSize: { cells: 0n, bits: 0n },
      },
    },
  };
}

interface AuctionTrace {
  wallet: Transaction;
  receiver: Transaction;
  nft?: Transaction;
}

let trace: AuctionTrace;
let configureTrace: (value: AuctionTrace) => void;
let auctionEndTime: number;

function bid(amount = 2) {
  mocks.tonapiFetch.mockResolvedValue(
    response({ wallet: { address: WALLET.toRawString() }, item: { address: NFT.toRawString() } })
  );
  return createDnsSDK(log).bid("example", amount);
}

async function expectUnknown(pending: Promise<unknown>) {
  const rejected = expect(pending).rejects.toMatchObject({
    code: "NOT_AVAILABLE",
    message: expect.stringContaining("Do not automatically resend"),
  });
  await vi.runAllTimersAsync();
  await rejected;
  expect(mocks.sendWalletTx).toHaveBeenCalledTimes(1);
}

describe("createDnsSDK", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    configureTrace = () => {};
    auctionEndTime = Math.floor(Date.now() / 1000) + 100;
    mocks.loadWallet.mockReturnValue({ address: "EQ-wallet" });
    mocks.getKeyPair.mockResolvedValue({
      publicKey: Buffer.alloc(32),
      secretKey: Buffer.alloc(64),
    });
    mocks.getCachedTonClient.mockResolvedValue({
      open: vi.fn(() => ({ address: WALLET })),
      getTransactions: mocks.getTransactions,
      tryLocateResultTx: mocks.tryLocateResultTx,
      runMethod: mocks.runMethod,
    });
    mocks.runMethod.mockImplementation(async () => ({
      stack: new TupleReader([
        { type: "null" },
        { type: "int", value: 1_000_000_000n },
        { type: "int", value: BigInt(auctionEndTime) },
      ]),
    }));
    mocks.sendWalletTx.mockImplementation(async (_client, _contract, { messages }) => {
      const sent = messages[0];
      const outgoing = chainMessage(WALLET, sent.info.dest, 11n, sent.body, sent.info.value.coins);
      const wallet = transaction(
        {
          info: { type: "external-in", dest: WALLET, importFee: 0n },
          body: EMPTY,
        },
        [outgoing]
      );
      if (sent.info.dest.equals(ROOT)) {
        const label = sent.body.beginParse().skip(32).loadStringTail();
        const deployment = chainMessage(
          ROOT,
          NFT,
          21n,
          beginCell().storeAddress(WALLET).storeRef(beginCell().storeStringTail(label)).endCell()
        );
        deployment.init = { code: EMPTY, data: EMPTY };
        trace = {
          wallet,
          receiver: transaction(outgoing, [deployment]),
          nft: transaction(deployment),
        };
      } else {
        const notification = chainMessage(
          NFT,
          OTHER,
          31n,
          beginCell().storeUint(0x557cea20, 32).storeUint(100n, 64).endCell()
        );
        trace = { wallet, receiver: transaction(outgoing, [notification]) };
      }
      configureTrace(trace);
      return { hash: WALLET_TX_HASH, seqno: 1 };
    });
    mocks.getTransactions.mockImplementation(async () => [trace.wallet]);
    mocks.tryLocateResultTx.mockImplementation(async (_source, _destination, lt) => {
      if (lt === "11") return trace.receiver;
      if (lt === "21" && trace.nft) return trace.nft;
      throw new Error("not indexed yet");
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(["check", "resolve"] as const)(
    "%s reads wallet records from the resolve endpoint",
    async (method) => {
      mocks.tonapiFetch
        .mockResolvedValueOnce(
          response({ item: { address: "EQ-nft", owner: { address: "EQ-owner" } } })
        )
        .mockResolvedValueOnce(response({ wallet: { address: "EQ-wallet-record" } }));
      expect(await createDnsSDK(log)[method]("example.ton")).toMatchObject({
        walletAddress: "EQ-wallet-record",
        nftAddress: "EQ-nft",
      });
      expect(mocks.tonapiFetch).toHaveBeenNthCalledWith(2, "/dns/example.ton/resolve");
    }
  );

  it("bounds actual auction results and resolves NFT addresses from domain info", async () => {
    mocks.tonapiFetch.mockImplementation(async (path: string) =>
      path.startsWith("/dns/auctions")
        ? response({
            data: ["first.ton", "second.ton", "third.ton"].map((domain) => ({
              domain,
              owner: "EQ-bidder",
              price: "1234567891",
              bids: 1,
              date: 1,
            })),
          })
        : response({ item: { address: `EQ-${path}` } })
    );
    const auctions = await createDnsSDK(log).getAuctions(2);
    expect(auctions).toHaveLength(2);
    expect(auctions[0]).toMatchObject({
      owner: "EQ-bidder",
      nftAddress: "EQ-/dns/first.ton",
      lastBid: "1.234567891",
    });
    expect(mocks.tonapiFetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["four", "100"],
    ["five5", "50"],
    ["long-domain-name", "1"],
    ["ab-c", "100"],
    ["a--b", "100"],
    ["1111", "100"],
    ["a".repeat(126), "1"],
  ])("encodes auction %s with its minimum bid of %s TON", async (label, amount) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-07T00:00:00Z"));
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    expect(await createDnsSDK(log).startAuction(label)).toEqual({
      domain: `${label}.ton`,
      success: true,
      bidAmount: amount,
    });
    const message = mocks.sendWalletTx.mock.calls[0][2].messages[0];
    expect(message.info.value.coins).toBe(BigInt(amount) * 1_000_000_000n);
    const body = message.body.beginParse();
    expect(body.loadUint(32)).toBe(0);
    expect(body.loadStringTail()).toBe(label);
  });

  it.each([
    "--ab",
    "abcd-",
    "a.b.c",
    "name.eth",
    "éééé",
    "ab cd",
    "ab_cd",
    "ab/cd",
    "abcd\n.ton",
    "abcd\r.ton",
    "abcd\u2028.ton",
    "abcd\u2029.ton",
    "ab\0cd",
    "abc",
    "a".repeat(127),
    "",
  ])("rejects invalid auction name %j before pricing or external calls", async (domain) => {
    const pricingClock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-07T00:00:00Z"));
    await expect(createDnsSDK(log).startAuction(domain)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(pricingClock).not.toHaveBeenCalled();
    expect(mocks.loadWallet).not.toHaveBeenCalled();
    expect(mocks.tonapiFetch).not.toHaveBeenCalled();
    expect(mocks.getKeyPair).not.toHaveBeenCalled();
    expect(mocks.getCachedTonClient).not.toHaveBeenCalled();
    expect(mocks.sendWalletTx).not.toHaveBeenCalled();
  });

  it("validates the normalized auction label", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-07T00:00:00Z"));
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    await expect(createDnsSDK(log).startAuction(" A--B.TON ")).resolves.toMatchObject({
      domain: "a--b.ton",
      bidAmount: "100",
    });
    const body = mocks.sendWalletTx.mock.calls[0][2].messages[0].body.beginParse();
    expect(body.loadUint(32)).toBe(0);
    expect(body.loadStringTail()).toBe("a--b");
  });

  it("retains the contract's monthly auction-price reduction", async () => {
    vi.spyOn(Date, "now").mockReturnValue((1659171600 + 2592000) * 1000);
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    expect((await createDnsSDK(log).startAuction("four")).bidAmount).toBe("900");
  });

  it("does not submit auctions before the contract's opening time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1659171600 * 1000);
    await expect(createDnsSDK(log).startAuction("four")).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
    });
    expect(mocks.sendWalletTx).not.toHaveBeenCalled();
  });

  it("does not send an auction for an existing domain or an invalid label", async () => {
    mocks.tonapiFetch.mockResolvedValue(
      response({ wallet: { address: "EQ-record" }, item: { address: "EQ-nft" } })
    );
    await expect(createDnsSDK(log).startAuction("existing")).rejects.toMatchObject({
      code: "OPERATION_FAILED",
    });
    await expect(createDnsSDK(log).startAuction("abc")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(mocks.sendWalletTx).not.toHaveBeenCalled();
  });

  it("normalizes domains and reports availability on 404", async () => {
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    await expect(createDnsSDK(log).check(" Example.TON ")).resolves.toEqual({
      domain: "example.ton",
      available: true,
    });
    expect(mocks.tonapiFetch).toHaveBeenCalledWith("/dns/example.ton");
  });

  it("maps a registered domain response", async () => {
    mocks.tonapiFetch.mockResolvedValue(
      response({
        wallet: { address: "EQ-record" },
        item: { address: "EQ-nft", owner: { address: "EQ-owner" } },
      })
    );
    await expect(createDnsSDK(log).check("example")).resolves.toEqual({
      domain: "example.ton",
      available: false,
      owner: "EQ-owner",
      nftAddress: "EQ-nft",
      walletAddress: "EQ-record",
    });
  });

  it("fails with a typed error for an empty domain", async () => {
    await expect(createDnsSDK(log).check("  ")).rejects.toMatchObject({
      name: "PluginSDKError",
      code: "INVALID_INPUT",
    });
    expect(mocks.tonapiFetch).not.toHaveBeenCalled();
  });

  it("returns null when resolution is unavailable", async () => {
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    await expect(createDnsSDK(log).resolve("missing")).resolves.toBeNull();
  });

  it("bounds auction queries and maps their result", async () => {
    mocks.tonapiFetch.mockResolvedValue(
      response({
        data: [
          {
            domain: "sale.ton",
            nft: { address: "EQ-nft" },
            owner: { address: "EQ-owner" },
            price: "1500000000",
            date: 123,
            bids: 4,
          },
        ],
      })
    );
    await expect(createDnsSDK(log).getAuctions(500)).resolves.toEqual([
      {
        domain: "sale.ton",
        nftAddress: "EQ-nft",
        owner: "EQ-owner",
        lastBid: "1.50",
        endTime: 123,
        bids: 4,
      },
    ]);
    expect(mocks.tonapiFetch).toHaveBeenCalledWith("/dns/auctions?tld=ton&limit=100");
  });

  it("rejects an invalid auction limit and bid amount", async () => {
    const sdk = createDnsSDK(log);
    await expect(sdk.getAuctions(0)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(sdk.bid("example", Number.NaN)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("requires a wallet before starting an auction", async () => {
    mocks.loadWallet.mockReturnValue(null);
    await expect(createDnsSDK(log).startAuction("example")).rejects.toMatchObject({
      code: "WALLET_NOT_INITIALIZED",
    });
  });

  it("waits for both collection and NFT acceptance before reporting a new auction", async () => {
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    await expect(createDnsSDK(log).startAuction("example")).resolves.toMatchObject({
      success: true,
    });
    expect(mocks.getTransactions.mock.calls[0][0].equals(WALLET)).toBe(true);
    expect(mocks.getTransactions.mock.calls[0][1]).toEqual({ limit: 10 });
    expect(
      mocks.tryLocateResultTx.mock.calls.map(([source, destination, lt]) => [
        source.toRawString(),
        destination.toRawString(),
        lt,
      ])
    ).toEqual([
      [WALLET.toRawString(), ROOT.toRawString(), "11"],
      [ROOT.toRawString(), NFT.toRawString(), "21"],
    ]);
    expect(mocks.sendWalletTx).toHaveBeenCalledTimes(1);
  });

  it.each(["collection", "NFT"])("rejects an auction rejected by the %s", async (target) => {
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    configureTrace = (value) => {
      const tx = target === "collection" ? value.receiver : value.nft!;
      if (tx.description.type === "generic" && tx.description.computePhase.type === "vm") {
        tx.description.aborted = true;
        tx.description.computePhase.success = false;
        tx.description.computePhase.exitCode = target === "collection" ? 205 : 405;
      }
    };
    await expect(createDnsSDK(log).startAuction("example")).rejects.toMatchObject({
      code: "OPERATION_FAILED",
      message: expect.stringContaining("DNS contract rejected"),
    });
    expect(mocks.sendWalletTx).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful NFT transaction that refunds a concurrent initialization", async () => {
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    configureTrace = (value) => {
      value.nft = transaction(value.nft!.inMessage!, [
        chainMessage(NFT, WALLET, 31n, beginCell().storeUint(0, 32).storeUint(100n, 64).endCell()),
      ]);
    };
    await expect(createDnsSDK(log).startAuction("example")).rejects.toMatchObject({
      code: "OPERATION_FAILED",
      message: expect.stringContaining("refunded the initial bid"),
    });
    expect(mocks.sendWalletTx).toHaveBeenCalledTimes(1);
  });

  it.each(["wallet", "collection", "NFT"])(
    "reports an unknown result when the %s transaction cannot be read",
    async (target) => {
      vi.useFakeTimers();
      mocks.tonapiFetch.mockResolvedValue(response({}, 404));
      if (target === "wallet") mocks.getTransactions.mockResolvedValue([]);
      else {
        mocks.tryLocateResultTx.mockImplementation(async (_source, _destination, lt) => {
          if (target === "NFT" && lt === "11") return trace.receiver;
          throw new Error("RPC lookup unavailable");
        });
      }
      await expectUnknown(createDnsSDK(log).startAuction("example"));
    }
  );

  it("does not mistake another confirmed wallet transaction for this send", async () => {
    vi.useFakeTimers();
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    configureTrace = (value) => {
      value.wallet.hash = () => Buffer.alloc(32);
    };
    await expectUnknown(createDnsSDK(log).startAuction("example"));
    expect(mocks.tryLocateResultTx).not.toHaveBeenCalled();
  });

  it.each(["source", "destination", "logical time", "value", "body", "bounced"])(
    "does not accept a destination transaction with the wrong %s",
    async (field) => {
      vi.useFakeTimers();
      configureTrace = (value) => {
        const message = value.receiver.inMessage!;
        if (message.info.type === "internal") {
          if (field === "source") message.info.src = OTHER;
          if (field === "destination") message.info.dest = OTHER;
          if (field === "logical time") message.info.createdLt += 1n;
          if (field === "value") message.info.value = { coins: 1n };
          if (field === "bounced") message.info.bounced = true;
        }
        if (field === "body") message.body = beginCell().storeUint(42, 32).endCell();
      };
      await expectUnknown(bid());
    }
  );

  it("retries lagging receipts without sending the bid again", async () => {
    vi.useFakeTimers();
    mocks.tryLocateResultTx.mockRejectedValueOnce(new Error("not indexed yet"));
    const pending = bid();
    const accepted = expect(pending).resolves.toMatchObject({ success: true });
    await vi.runAllTimersAsync();
    await accepted;
    expect(mocks.tryLocateResultTx).toHaveBeenCalledTimes(2);
    expect(mocks.sendWalletTx).toHaveBeenCalledTimes(1);
  });

  it("accepts a bid at the observed auction deadline without an outgoing refund", async () => {
    configureTrace = (value) => {
      value.receiver = transaction(value.receiver.inMessage!);
      value.receiver.now = auctionEndTime;
      if (value.receiver.description.type === "generic") {
        value.receiver.description.actionPhase = undefined;
      }
    };
    await expect(bid()).resolves.toEqual({
      domain: "example.ton",
      bidAmount: "2",
      success: true,
    });
    expect(mocks.runMethod.mock.calls[0][0].equals(NFT)).toBe(true);
    expect(mocks.runMethod.mock.calls[0][1]).toBe("get_auction_info");
    expect(mocks.runMethod).toHaveBeenCalledTimes(1);
  });

  it("accepts a bid after another bidder extended the observed deadline", async () => {
    configureTrace = (value) => {
      value.receiver.now = auctionEndTime + 1;
    };
    await expect(bid()).resolves.toMatchObject({ success: true });
  });

  it("recognizes an accepted self-outbid rather than treating its refund as a rejection", async () => {
    configureTrace = (value) => {
      const notification = value.receiver.outMessages.get(0)!;
      if (notification.info.type === "internal") notification.info.dest = WALLET;
    };
    await expect(bid()).resolves.toMatchObject({ success: true });
  });

  it("never reports a late owner's successful top-up as an accepted bid", async () => {
    configureTrace = (value) => {
      value.receiver = transaction(value.receiver.inMessage!);
      value.receiver.now = auctionEndTime + 1;
    };
    await expect(bid()).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect(mocks.sendWalletTx).toHaveBeenCalledTimes(1);
  });

  it.each(["low bid", "ended auction", "action failure", "aborted", "skipped compute"])(
    "rejects a DNS bid with %s despite wallet confirmation",
    async (reason) => {
      configureTrace = (value) => {
        const description = value.receiver.description;
        if (description.type !== "generic") throw new Error("invalid fixture");
        if (reason === "aborted") description.aborted = true;
        else if (reason === "action failure") description.actionPhase!.success = false;
        else if (reason === "skipped compute") {
          description.computePhase = { type: "skipped", reason: "no-state" };
        } else if (description.computePhase.type === "vm") {
          description.computePhase.success = false;
          description.computePhase.exitCode = reason === "low bid" ? 407 : 406;
        }
      };
      await expect(bid()).rejects.toMatchObject({ code: "OPERATION_FAILED" });
      expect(mocks.sendWalletTx).toHaveBeenCalledTimes(1);
    }
  );

  it("does not send a bid when the NFT has no auction", async () => {
    auctionEndTime = 0;
    await expect(bid()).rejects.toMatchObject({ code: "OPERATION_FAILED" });
    expect(mocks.sendWalletTx).not.toHaveBeenCalled();
  });

  it("does not send a bid when auction state cannot be read", async () => {
    mocks.runMethod.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(bid()).rejects.toMatchObject({ code: "OPERATION_FAILED" });
    expect(mocks.sendWalletTx).not.toHaveBeenCalled();
  });

  it("delegates owned-record updates to the canonical DNS service", async () => {
    const sdk = createDnsSDK(log);
    await sdk.link("example", "EQ-address");
    await sdk.unlink("example");
    await sdk.setSiteRecord("example", "a".repeat(64));

    expect(mocks.linkDnsWallet).toHaveBeenCalledWith("example", "EQ-address");
    expect(mocks.unlinkDnsWallet).toHaveBeenCalledWith("example");
    expect(mocks.setDnsSite).toHaveBeenCalledWith("example", "a".repeat(64));
  });

  it("maps canonical DNS validation failures to SDK error codes", async () => {
    mocks.setDnsSite.mockRejectedValue(new DnsUpdateError("Invalid ADNL", "INVALID_ADNL_ADDRESS"));
    await expect(createDnsSDK(log).setSiteRecord("example", "bad")).rejects.toEqual(
      new PluginSDKError("Invalid ADNL", "INVALID_INPUT")
    );
  });
});
