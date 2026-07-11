import { describe, expect, it, vi } from "vitest";
import { PoolType, ReadinessStatus } from "@dedust/sdk";
import type { Asset, Factory } from "@dedust/sdk";
import type { OpenedContract, TonClient } from "@ton/ton";
import { findDedustPool } from "../dedust-pool.js";

describe("DeDust pool selection", () => {
  it("falls back to the alternate pool type and reports the actual match", async () => {
    const volatilePool = {
      getReadinessStatus: vi.fn().mockResolvedValue(ReadinessStatus.NOT_READY),
    };
    const stablePool = { getReadinessStatus: vi.fn().mockResolvedValue(ReadinessStatus.READY) };
    const getPool = vi
      .fn()
      .mockResolvedValueOnce({ id: "volatile" })
      .mockResolvedValueOnce({ id: "stable" });
    const factory = { getPool } as unknown as OpenedContract<Factory>;
    const open = vi.fn().mockReturnValueOnce(volatilePool).mockReturnValueOnce(stablePool);
    const tonClient = { open } as unknown as TonClient;
    const fromAsset = { type: "native" } as unknown as Asset;
    const toAsset = { type: "jetton" } as unknown as Asset;

    const result = await findDedustPool(tonClient, factory, fromAsset, toAsset, "volatile");

    expect(getPool).toHaveBeenNthCalledWith(1, PoolType.VOLATILE, [fromAsset, toAsset]);
    expect(getPool).toHaveBeenNthCalledWith(2, PoolType.STABLE, [fromAsset, toAsset]);
    expect(result).toEqual({ pool: stablePool, poolType: "stable" });
  });
});
