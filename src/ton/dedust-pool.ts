import { PoolType, ReadinessStatus } from "@dedust/sdk";
import type { Factory, Asset, Pool } from "@dedust/sdk";
import type { OpenedContract, TonClient } from "@ton/ton";

export interface DedustPoolMatch {
  pool: OpenedContract<Pool>;
  poolType: "volatile" | "stable";
}

/** Find a READY DeDust pool, preferring the requested type and falling back once. */
export async function findDedustPool(
  tonClient: TonClient,
  factory: OpenedContract<Factory>,
  fromAsset: Asset,
  toAsset: Asset,
  preferred: "volatile" | "stable" = "volatile"
): Promise<DedustPoolMatch | null> {
  const order: Array<"volatile" | "stable"> =
    preferred === "stable" ? ["stable", "volatile"] : ["volatile", "stable"];

  try {
    for (const type of order) {
      const poolType = type === "stable" ? PoolType.STABLE : PoolType.VOLATILE;
      const pool = tonClient.open(await factory.getPool(poolType, [fromAsset, toAsset]));
      if ((await pool.getReadinessStatus()) === ReadinessStatus.READY) {
        return { pool, poolType: type };
      }
    }
  } catch {
    return null;
  }

  return null;
}
