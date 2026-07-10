import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadWallet: vi.fn(),
  getCachedTonClient: vi.fn(),
  getKeyPair: vi.fn(),
  simulateStonfiSwap: vi.fn(),
  estimateDedustSwap: vi.fn(),
  sendWalletTx: vi.fn(),
  walletTxLt: vi.fn(),
  confirmWalletTx: vi.fn(),
  withTxLock: vi.fn((fn: () => unknown) => fn()),
  walletCreate: vi.fn(),
  internal: vi.fn((message) => message),
  dexFactory: vi.fn(),
}));

vi.mock("../../ton/wallet-service.js", () => ({
  loadWallet: mocks.loadWallet,
  getCachedTonClient: mocks.getCachedTonClient,
  getKeyPair: mocks.getKeyPair,
}));
vi.mock("../../ton/dex-service.js", () => ({
  simulateStonfiSwap: mocks.simulateStonfiSwap,
  estimateDedustSwap: mocks.estimateDedustSwap,
}));
vi.mock("../../ton/confirm.js", () => ({
  sendWalletTx: mocks.sendWalletTx,
  walletTxLt: mocks.walletTxLt,
  confirmWalletTx: mocks.confirmWalletTx,
}));
vi.mock("../../ton/tx-lock.js", () => ({ withTxLock: mocks.withTxLock }));
vi.mock("@ston-fi/sdk", () => ({ dexFactory: mocks.dexFactory }));
vi.mock("@ton/ton", () => ({
  WalletContractV5R1: { create: mocks.walletCreate },
  toNano: vi.fn((value: string) => BigInt(Math.round(Number(value) * 1e9))),
  internal: mocks.internal,
}));
vi.mock("@ton/core", () => ({
  Address: { parse: vi.fn((value: string) => ({ value })) },
}));
vi.mock("@dedust/sdk", () => ({
  JettonRoot: { createFromAddress: vi.fn((address) => ({ kind: "root", address })) },
  VaultJetton: { createSwapPayload: vi.fn(() => ({ kind: "payload" })) },
}));

import { executeDedustSwap, executeStonfiSwap } from "../ton/dex-swaps.js";

const params = { fromAsset: "TON", toAsset: "JETTON", amount: 2, slippage: 0.02 };

describe("DEX swap execution", () => {
  const wallet = { kind: "wallet", address: "EQ-wallet" };
  const walletContract = {
    address: "EQ-wallet",
    sender: vi.fn(() => ({ kind: "sender" })),
  };
  const routerContract = {
    getSwapTonToJettonTxParams: vi.fn(),
    getSwapJettonToTonTxParams: vi.fn(),
    getSwapJettonToJettonTxParams: vi.fn(),
  };
  const tonVault = { sendSwap: vi.fn() };
  const tonClient = {
    open: vi.fn((contract: { kind?: string }) => {
      if (contract === wallet) return walletContract;
      if (contract?.kind === "router") return routerContract;
      if (contract?.kind === "native-vault") return tonVault;
      return contract;
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadWallet.mockReturnValue({ address: "EQ-wallet" });
    mocks.getCachedTonClient.mockResolvedValue(tonClient);
    mocks.getKeyPair.mockResolvedValue({
      publicKey: Buffer.alloc(32),
      secretKey: Buffer.alloc(64),
    });
    mocks.walletCreate.mockReturnValue(wallet);
    mocks.dexFactory.mockReturnValue({
      Router: { create: () => ({ kind: "router" }) },
      pTON: { create: () => ({ kind: "proxy-ton" }) },
    });
    routerContract.getSwapTonToJettonTxParams.mockResolvedValue({
      to: "EQ-router",
      value: 1n,
      body: { kind: "body" },
    });
    mocks.simulateStonfiSwap.mockResolvedValue({
      simulation: {
        router: { address: "EQ-router", ptonMasterAddress: "EQ-pton" },
        offerUnits: "2000000000",
        askUnits: "4000000",
        minAskUnits: "3900000",
      },
      isTonInput: true,
      isTonOutput: false,
      fromAddress: "TON",
      toAddress: "EQ-jetton",
      toDecimals: 6,
    });
    mocks.sendWalletTx.mockResolvedValue({ hash: "stonfi-hash", seqno: 7 });
    mocks.walletTxLt.mockResolvedValue(10n);
    mocks.confirmWalletTx.mockResolvedValue({ hash: "dedust-hash", seqno: 8 });
  });

  it("executes and confirms a STON.fi TON-to-jetton swap", async () => {
    await expect(executeStonfiSwap(params)).resolves.toEqual({
      dex: "stonfi",
      fromAsset: "TON",
      toAsset: "JETTON",
      amountIn: "2",
      expectedOutput: "4.000000",
      minOutput: "3.900000",
      slippage: "2.00%",
      txRef: "stonfi-hash",
    });
    expect(routerContract.getSwapTonToJettonTxParams).toHaveBeenCalled();
    expect(mocks.sendWalletTx).toHaveBeenCalledOnce();
  });

  it("fails closed when STON.fi has no liquidity", async () => {
    mocks.simulateStonfiSwap.mockResolvedValue(null);
    await expect(executeStonfiSwap(params)).rejects.toMatchObject({ code: "OPERATION_FAILED" });
    expect(mocks.sendWalletTx).not.toHaveBeenCalled();
  });

  it("requires an initialized wallet and derived key", async () => {
    mocks.loadWallet.mockReturnValue(null);
    await expect(executeStonfiSwap(params)).rejects.toMatchObject({
      code: "WALLET_NOT_INITIALIZED",
    });

    mocks.loadWallet.mockReturnValue({ address: "EQ-wallet" });
    mocks.getKeyPair.mockResolvedValue(null);
    await expect(executeStonfiSwap(params)).rejects.toMatchObject({ code: "OPERATION_FAILED" });
  });

  it("executes and confirms a DeDust TON-to-jetton swap", async () => {
    const factory = { getNativeVault: vi.fn(async () => ({ kind: "native-vault" })) };
    mocks.estimateDedustSwap.mockResolvedValue({
      tonClient,
      factory,
      pool: { address: "EQ-pool" },
      isTonInput: true,
      toDecimals: 6,
      amountIn: 2_000_000_000n,
      amountOut: 4_000_000n,
      minAmountOut: 3_900_000n,
      fromAddress: "TON",
    });

    await expect(executeDedustSwap(params)).resolves.toMatchObject({
      dex: "dedust",
      expectedOutput: "4.000000",
      minOutput: "3.900000",
      txRef: "dedust-hash",
    });
    expect(tonVault.sendSwap).toHaveBeenCalledOnce();
    expect(mocks.confirmWalletTx).toHaveBeenCalledWith(tonClient, "EQ-wallet", 10n);
  });

  it("rethrows a DeDust broadcast error when no transaction is confirmed", async () => {
    const broadcastError = new Error("broadcast failed");
    tonVault.sendSwap.mockRejectedValue(broadcastError);
    mocks.confirmWalletTx.mockResolvedValue(null);
    mocks.estimateDedustSwap.mockResolvedValue({
      tonClient,
      factory: { getNativeVault: vi.fn(async () => ({ kind: "native-vault" })) },
      pool: { address: "EQ-pool" },
      isTonInput: true,
      toDecimals: 6,
      amountIn: 2_000_000_000n,
      amountOut: 4_000_000n,
      minAmountOut: 3_900_000n,
      fromAddress: "TON",
    });

    await expect(executeDedustSwap(params)).rejects.toBe(broadcastError);
  });
});
