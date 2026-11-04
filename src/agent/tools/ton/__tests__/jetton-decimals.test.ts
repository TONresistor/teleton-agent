import { Address, type MessageRelaxed } from "@ton/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadWallet: vi.fn(),
  getCachedTonClient: vi.fn(),
  openWallet: vi.fn(),
  tonapiFetch: vi.fn(),
  sendWalletTx: vi.fn(),
}));

vi.mock("../../../../ton/wallet-service.js", () => ({
  loadWallet: mocks.loadWallet,
  getCachedTonClient: mocks.getCachedTonClient,
}));
vi.mock("../../../../ton/wallet-open.js", () => ({ openWallet: mocks.openWallet }));
vi.mock("../../../../constants/api-endpoints.js", () => ({ tonapiFetch: mocks.tonapiFetch }));
vi.mock("../../../../ton/confirm.js", () => ({
  sendWalletTx: mocks.sendWalletTx,
  tonExplorerTxUrl: () => "https://example.invalid/transaction",
}));

import { jettonSendExecutor } from "../jetton-send.js";
import { jettonBalancesExecutor } from "../jetton-balances.js";

const owner = Address.parseRaw(`0:${"11".repeat(32)}`);
const master = Address.parseRaw(`0:${"22".repeat(32)}`);
const recipient = Address.parseRaw(`0:${"33".repeat(32)}`);
const jettonWallet = Address.parseRaw(`0:${"44".repeat(32)}`);
const context = {} as never;

function respondWithBalance(decimals: number | null | undefined, balance = "2000000000") {
  mocks.tonapiFetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        balances: [
          {
            balance,
            wallet_address: { address: jettonWallet.toString() },
            jetton: { address: master.toString(), decimals, symbol: "TEST", name: "Test" },
          },
        ],
      })
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadWallet.mockReturnValue({ address: owner.toString() });
  mocks.getCachedTonClient.mockResolvedValue({});
  mocks.openWallet.mockResolvedValue({ keyPair: { secretKey: Buffer.alloc(64) }, contract: {} });
  mocks.sendWalletTx.mockResolvedValue({ hash: "test-hash" });
});

describe("jetton decimal conversion", () => {
  it.each([
    { decimals: 0, amount: 1, expected: 1n },
    { decimals: 9, amount: 1.25, expected: 1250000000n },
    { decimals: 6, amount: 1, expected: 1000000n },
    { decimals: undefined, amount: 1, expected: 1000000000n },
    { decimals: null, amount: 1, expected: 1000000000n },
  ])("encodes $amount tokens with decimals=$decimals as $expected units", async (test) => {
    respondWithBalance(test.decimals);
    const result = await jettonSendExecutor(
      { jetton_address: master.toString(), to: recipient.toString(), amount: test.amount },
      context
    );
    expect(result.success).toBe(true);
    expect(mocks.sendWalletTx).toHaveBeenCalledOnce();
    const { messages } = mocks.sendWalletTx.mock.calls[0][2] as { messages: MessageRelaxed[] };
    expect(messages[0].info.type).toBe("internal");
    if (messages[0].info.type === "internal") {
      expect(messages[0].info.dest.equals(jettonWallet)).toBe(true);
    }
    const body = messages[0].body.beginParse();
    expect(body.loadUint(32)).toBe(0xf8a7ea5);
    expect(body.loadUintBig(64)).toBe(0n);
    expect(body.loadCoins()).toBe(test.expected);
    expect(body.loadAddress().equals(recipient)).toBe(true);
  });

  it("rejects insufficient zero-decimal balance before reaching the send boundary", async () => {
    respondWithBalance(0, "2");
    expect(
      await jettonSendExecutor(
        { jetton_address: master.toString(), to: recipient.toString(), amount: 3 },
        context
      )
    ).toMatchObject({ success: false });
    expect(mocks.sendWalletTx).not.toHaveBeenCalled();
  });

  it.each([
    { decimals: 0, raw: "1234567890", expected: "1234567890", scale: 0 },
    { decimals: 9, raw: "1234000000", expected: "1.234", scale: 9 },
    { decimals: undefined, raw: "1234000000", expected: "1.234", scale: 9 },
    { decimals: null, raw: "1234000000", expected: "1.234", scale: 9 },
  ])("displays a balance with decimals=$decimals at its actual scale", async (test) => {
    respondWithBalance(test.decimals, test.raw);
    const result = await jettonBalancesExecutor({}, context);
    expect(result).toMatchObject({
      success: true,
      data: { balances: [{ balance: test.expected, rawBalance: test.raw, decimals: test.scale }] },
    });
  });
});
