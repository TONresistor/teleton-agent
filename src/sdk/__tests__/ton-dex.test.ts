import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginSDKError } from "@teleton-agent/sdk";

const mocks = vi.hoisted(() => ({
  getStonfiQuote: vi.fn(),
  getDedustQuote: vi.fn(),
  executeStonfiSwap: vi.fn(),
  executeDedustSwap: vi.fn(),
}));

vi.mock("../ton/dex-quotes.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../ton/dex-quotes.js")>();
  return {
    ...original,
    getStonfiQuote: mocks.getStonfiQuote,
    getDedustQuote: mocks.getDedustQuote,
  };
});

vi.mock("../ton/dex-swaps.js", () => ({
  executeStonfiSwap: mocks.executeStonfiSwap,
  executeDedustSwap: mocks.executeDedustSwap,
}));

import { createDexSDK } from "../ton-dex.js";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const params = { fromAsset: "TON", toAsset: "JETTON", amount: 10 };
const stonfi = {
  dex: "stonfi" as const,
  expectedOutput: "110.000000",
  minOutput: "108.000000",
  rate: "11.000000",
  fee: "0.100000",
};
const dedust = {
  dex: "dedust" as const,
  expectedOutput: "100.000000",
  minOutput: "98.000000",
  rate: "10.000000",
  fee: "0.100000",
};

describe("createDexSDK", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStonfiQuote.mockResolvedValue(stonfi);
    mocks.getDedustQuote.mockResolvedValue(dedust);
    mocks.executeStonfiSwap.mockResolvedValue({ dex: "stonfi", txRef: "stonfi-hash" });
    mocks.executeDedustSwap.mockResolvedValue({ dex: "dedust", txRef: "dedust-hash" });
  });

  it("compares both quotes and reports the savings", async () => {
    const result = await createDexSDK(log).quote(params);

    expect(result).toEqual({ stonfi, dedust, recommended: "stonfi", savings: "10.00%" });
    expect(mocks.getStonfiQuote).toHaveBeenCalledWith("TON", "JETTON", 10, 0.01, log);
    expect(mocks.getDedustQuote).toHaveBeenCalledWith("TON", "JETTON", 10, 0.01, log);
  });

  it("selects the only DEX with liquidity", async () => {
    mocks.getStonfiQuote.mockResolvedValue(null);
    await expect(createDexSDK(log).quote(params)).resolves.toMatchObject({
      recommended: "dedust",
      savings: "0%",
    });
  });

  it("fails when neither DEX has liquidity", async () => {
    mocks.getStonfiQuote.mockResolvedValue(null);
    mocks.getDedustQuote.mockResolvedValue(null);
    await expect(createDexSDK(log).quote(params)).rejects.toMatchObject({
      name: "PluginSDKError",
      code: "OPERATION_FAILED",
    });
  });

  it.each(["quote", "quoteSTONfi", "quoteDeDust", "swap", "swapSTONfi", "swapDeDust"] as const)(
    "validates pair, amount, and slippage for %s",
    async (method) => {
      const sdk = createDexSDK(log);
      await expect(sdk[method]({ ...params, fromAsset: " " })).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
      await expect(sdk[method]({ ...params, toAsset: "ton" })).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
      await expect(sdk[method]({ ...params, amount: 0 })).rejects.toBeInstanceOf(PluginSDKError);
      await expect(sdk[method]({ ...params, slippage: 1.01 })).rejects.toBeInstanceOf(
        PluginSDKError
      );
    }
  );

  it("dispatches forced swaps to the requested DEX", async () => {
    const sdk = createDexSDK(log);
    await sdk.swap({ ...params, dex: "stonfi" });
    await sdk.swap({ ...params, dex: "dedust" });

    expect(mocks.executeStonfiSwap).toHaveBeenCalledOnce();
    expect(mocks.executeDedustSwap).toHaveBeenCalledOnce();
  });

  it("uses the best quote for an automatic swap", async () => {
    await createDexSDK(log).swap(params);
    expect(mocks.executeStonfiSwap).toHaveBeenCalledWith(params);
    expect(mocks.executeDedustSwap).not.toHaveBeenCalled();
  });
});
