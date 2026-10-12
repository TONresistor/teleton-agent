import * as WalletTestTON from "@ton/ton";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const contract = {
    address: { toString: () => "EQwallet" },
    getSeqno: vi.fn(),
    sendTransfer: vi.fn(),
  };
  const client = { open: vi.fn(() => contract), getTransactions: vi.fn() };
  return {
    contract,
    client,
    getKeyPair: vi.fn(),
    getCachedTonClient: vi.fn(),
    invalidateTonClientCache: vi.fn(),
    addressParse: vi.fn(),
  };
});

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../wallet-service.js", () => ({
  createWalletContract: (keys: { publicKey: Buffer }) =>
    WalletTestTON.WalletContractV5R1.create({ workchain: 0, publicKey: keys.publicKey }),
  getKeyPair: h.getKeyPair,
  getCachedTonClient: h.getCachedTonClient,
  invalidateTonClientCache: h.invalidateTonClientCache,
}));

vi.mock("../../utils/retry.js", () => ({
  withBlockchainRetry: (fn: () => unknown) => fn(),
}));

vi.mock("../../constants/timeouts.js", () => ({
  TON_CONFIRM_TIMEOUT_MS: 200,
  TON_CONFIRM_POLL_INTERVAL_MS: 10,
}));

vi.mock("@ton/core", () => ({
  Address: { parse: h.addressParse },
  SendMode: { PAY_GAS_SEPARATELY: 1 },
}));

vi.mock("@ton/ton", () => ({
  WalletContractV5R1: { create: vi.fn(() => ({ address: { toString: () => "EQwallet" } })) },
  toNano: (n: number) => BigInt(Math.round(n * 1e9)),
  internal: (x: unknown) => x,
}));

// ─── Imports (after mocks) ────────────────────────────────────────

import { sendTon } from "../transfer.js";

// ─── Helpers ──────────────────────────────────────────────────────

const GOOD = "EQrecipient";

interface TxOpts {
  lt: bigint;
  external?: boolean;
  computeOk?: boolean;
  actionOk?: boolean;
  noFunds?: boolean;
  hash?: string;
  now?: number;
}

function makeTx(o: TxOpts) {
  return {
    lt: o.lt,
    now: o.now ?? 1000,
    inMessage: { info: { type: o.external === false ? "internal" : "external-in" } },
    description: {
      type: "generic",
      computePhase: { type: "vm", success: o.computeOk ?? true, exitCode: 0 },
      actionPhase: { success: o.actionOk ?? true, resultCode: 0, noFunds: o.noFunds ?? false },
    },
    hash: () => Buffer.from((o.hash ?? "ab".repeat(32)).padEnd(64, "0").slice(0, 64), "hex"),
  } as unknown as import("@ton/core").Transaction;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("sendTon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getCachedTonClient.mockResolvedValue(h.client);
    h.client.open.mockReturnValue(h.contract);
    h.addressParse.mockImplementation((s: string) => {
      if (s === "BAD") throw new Error("invalid address");
      return { toString: () => s };
    });
    h.getKeyPair.mockResolvedValue({ publicKey: Buffer.alloc(32), secretKey: Buffer.alloc(64) });
    h.contract.getSeqno.mockResolvedValue(5);
    h.contract.sendTransfer.mockResolvedValue(undefined);
    h.client.getTransactions.mockResolvedValue([]);
  });

  it("rejects a non-positive amount without broadcasting", async () => {
    expect(await sendTon({ toAddress: GOOD, amount: 0 })).toBeNull();
    expect(h.contract.sendTransfer).not.toHaveBeenCalled();
  });

  it("rejects an invalid address without broadcasting", async () => {
    expect(await sendTon({ toAddress: "BAD", amount: 1 })).toBeNull();
    expect(h.contract.sendTransfer).not.toHaveBeenCalled();
  });

  it("returns null when the wallet is not initialized", async () => {
    h.getKeyPair.mockResolvedValue(null);
    expect(await sendTon({ toAddress: GOOD, amount: 1 })).toBeNull();
    expect(h.contract.sendTransfer).not.toHaveBeenCalled();
  });

  it("returns the real on-chain hash once the transfer commits", async () => {
    h.client.getTransactions
      .mockResolvedValueOnce([makeTx({ lt: 100n, external: false })]) // pre-send snapshot
      .mockResolvedValue([makeTx({ lt: 101n, hash: "cd".repeat(32), now: 2000 })]); // confirm

    const result = await sendTon({ toAddress: GOOD, amount: 1.5, comment: "hi" });

    expect(result).toEqual({ hash: "cd".repeat(32), seqno: 5, at: 2_000_000 });
    expect(h.contract.sendTransfer).toHaveBeenCalledTimes(1);
    expect(h.contract.sendTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ seqno: 5, sendMode: 1 })
    );
  });

  it("returns null when the action phase fails (funds never left the wallet)", async () => {
    h.client.getTransactions
      .mockResolvedValueOnce([makeTx({ lt: 100n, external: false })])
      .mockResolvedValue([makeTx({ lt: 101n, actionOk: false, noFunds: true })]);

    expect(await sendTon({ toAddress: GOOD, amount: 999 })).toBeNull();
    expect(h.contract.sendTransfer).toHaveBeenCalledTimes(1);
  });

  it("returns null when the transfer is not confirmed within the window", async () => {
    h.client.getTransactions.mockResolvedValue([]); // never appears
    expect(await sendTon({ toAddress: GOOD, amount: 1 })).toBeNull();
  });

  it("still confirms via the chain when the broadcast call errors but the message lands", async () => {
    h.contract.sendTransfer.mockRejectedValue(new Error("ETIMEDOUT"));
    h.client.getTransactions
      .mockResolvedValueOnce([]) // snapshot
      .mockResolvedValue([makeTx({ lt: 1n, hash: "ef".repeat(32) })]); // landed despite RPC error

    const result = await sendTon({ toAddress: GOOD, amount: 1 });
    expect(result?.hash).toBe("ef".repeat(32));
  });

  it("rethrows the broadcast error when nothing lands on-chain", async () => {
    h.contract.sendTransfer.mockRejectedValue(new Error("network down"));
    h.client.getTransactions.mockResolvedValue([]);

    await expect(sendTon({ toAddress: GOOD, amount: 1 })).rejects.toThrow("network down");
  });

  it("invalidates the node cache on a 5xx broadcast error", async () => {
    h.contract.sendTransfer.mockRejectedValue({ status: 503 });
    h.client.getTransactions.mockResolvedValue([]);

    await expect(sendTon({ toAddress: GOOD, amount: 1 })).rejects.toBeDefined();
    expect(h.invalidateTonClientCache).toHaveBeenCalled();
  });
});
