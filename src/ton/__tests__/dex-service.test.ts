import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StonApiClient } from "@ston-fi/api";
import type { TonClient } from "@ton/ton";

const mocks = vi.hoisted(() => ({ findDedustPool: vi.fn() }));

vi.mock("../dedust-pool.js", () => ({ findDedustPool: mocks.findDedustPool }));

import { estimateDedustSwap, minimumAmountOut, simulateStonfiSwap } from "../dex-service.js";
import { STONFI_PTON_ADDRESS } from "../dex-constants.js";

describe("DEX simulation service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds the canonical STON.fi simulation request and resolves both decimal scales", async () => {
    const simulateSwap = vi.fn().mockResolvedValue({
      offerUnits: "1250000000",
      askUnits: "2500000",
      minAskUnits: "2475000",
      feeUnits: "2500",
    });
    const client = { simulateSwap } as unknown as StonApiClient;
    const resolveDecimals = vi.fn(async (asset: string) => (asset === "ton" ? 9 : 6));

    const result = await simulateStonfiSwap(
      { fromAsset: "TON", toAsset: `0:${"11".repeat(32)}`, amount: 1.25, slippage: 0.01 },
      { client, resolveDecimals }
    );

    expect(simulateSwap).toHaveBeenCalledWith({
      offerAddress: STONFI_PTON_ADDRESS,
      askAddress: `0:${"11".repeat(32)}`,
      offerUnits: "1250000000",
      slippageTolerance: "0.01",
    });
    expect(resolveDecimals).toHaveBeenNthCalledWith(1, "ton");
    expect(resolveDecimals).toHaveBeenNthCalledWith(2, `0:${"11".repeat(32)}`);
    expect(result).toMatchObject({ isTonInput: true, isTonOutput: false, toDecimals: 6 });
  });

  it("uses one DeDust pool estimate for amounts, fees, decimals, and slippage", async () => {
    const pool = {
      getEstimatedSwapOut: vi.fn().mockResolvedValue({ amountOut: 2_000_000n, tradeFee: 2_000n }),
    };
    mocks.findDedustPool.mockResolvedValue({ pool, poolType: "stable" });
    const factory = { id: "factory" };
    const tonClient = { open: vi.fn(() => factory) } as unknown as TonClient;
    const jetton = `0:${"22".repeat(32)}`;
    const resolveDecimals = vi.fn(async (asset: string) => (asset === "ton" ? 9 : 6));

    const result = await estimateDedustSwap(
      { fromAsset: "ton", toAsset: jetton, amount: 1.5, slippage: 0.02 },
      { tonClient, preferredPoolType: "stable", resolveDecimals }
    );

    expect(mocks.findDedustPool).toHaveBeenCalledWith(
      tonClient,
      factory,
      expect.anything(),
      expect.anything(),
      "stable"
    );
    expect(pool.getEstimatedSwapOut).toHaveBeenCalledWith({
      assetIn: expect.anything(),
      amountIn: 1_500_000_000n,
    });
    expect(result).toMatchObject({
      poolType: "stable",
      amountIn: 1_500_000_000n,
      amountOut: 2_000_000n,
      tradeFee: 2_000n,
      minAmountOut: 1_960_000n,
      fromDecimals: 9,
      toDecimals: 6,
    });
  });

  it("calculates minimum output in basis points", () => {
    expect(minimumAmountOut(10_000n, 0.0125)).toBe(9_875n);
  });
});
