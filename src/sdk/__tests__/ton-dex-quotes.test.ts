import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  simulateStonfiSwap: vi.fn(),
  estimateDedustSwap: vi.fn(),
}));

vi.mock("../../ton/dex-service.js", () => ({
  simulateStonfiSwap: mocks.simulateStonfiSwap,
  estimateDedustSwap: mocks.estimateDedustSwap,
}));

import { getDedustQuote, getStonfiQuote } from "../ton/dex-quotes.js";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("DEX quote adapters", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes STON.fi units", async () => {
    mocks.simulateStonfiSwap.mockResolvedValue({
      simulation: {
        askUnits: "2500000",
        minAskUnits: "2400000",
        feeUnits: "10000",
        priceImpact: "0.2",
      },
      toDecimals: 6,
    });

    await expect(getStonfiQuote("TON", "JETTON", 2, 0.01, log)).resolves.toEqual({
      dex: "stonfi",
      expectedOutput: "2.500000",
      minOutput: "2.400000",
      rate: "1.250000",
      priceImpact: "0.2",
      fee: "0.010000",
    });
  });

  it("normalizes DeDust units", async () => {
    mocks.estimateDedustSwap.mockResolvedValue({
      amountOut: 5_000_000n,
      minAmountOut: 4_900_000n,
      tradeFee: 25_000n,
      toDecimals: 6,
      poolType: "volatile",
    });

    await expect(getDedustQuote("TON", "JETTON", 2, 0.01, log)).resolves.toEqual({
      dex: "dedust",
      expectedOutput: "5.000000",
      minOutput: "4.900000",
      rate: "2.500000",
      fee: "0.025000",
      poolType: "volatile",
    });
  });

  it("degrades a provider failure to a null quote", async () => {
    mocks.simulateStonfiSwap.mockRejectedValue(new Error("unavailable"));
    await expect(getStonfiQuote("TON", "JETTON", 2, 0.01, log)).resolves.toBeNull();
    expect(log.debug).toHaveBeenCalled();
  });
});
