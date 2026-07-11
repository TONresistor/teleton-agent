import { Address as TonAddress } from "@ton/core";
import { tonapiFetch } from "../../constants/api-endpoints.js";

export interface TonApiJettonBalance {
  jetton: {
    address: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    image?: string;
  };
  balance: string;
  wallet_address?: { address: string };
  price?: { prices?: Record<string, string> };
}

export interface JettonMeta {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
  totalSupply: string;
  holdersCount: number;
  verified: boolean;
  description?: string;
  image?: string;
}

/** Format a raw BigInt token balance to a human-readable string. */
export function formatTokenBalance(rawBalance: bigint, decimals: number): string {
  const divisor = BigInt(10) ** BigInt(decimals);
  const wholePart = rawBalance / divisor;
  const fractionalPart = rawBalance % divisor;
  return fractionalPart === 0n
    ? wholePart.toString()
    : `${wholePart}.${fractionalPart.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

/** Match a jetton in a balances array by raw address or parsed canonical form. */
export function findJettonBalance(
  balances: TonApiJettonBalance[],
  jettonAddress: string
): TonApiJettonBalance | undefined {
  return balances.find((balance) => {
    if (balance.jetton.address.toLowerCase() === jettonAddress.toLowerCase()) return true;
    try {
      return (
        TonAddress.parse(balance.jetton.address).toString() ===
        TonAddress.parse(jettonAddress).toString()
      );
    } catch {
      return false;
    }
  });
}

/** Fetch normalized jetton metadata while preserving the caller's error policy. */
export async function fetchJettonMeta(
  jettonAddress: string
): Promise<{ ok: boolean; status: number; meta: JettonMeta | null }> {
  const response = await tonapiFetch(`/jettons/${encodeURIComponent(jettonAddress)}`);
  if (!response.ok) {
    return { ok: false, status: response.status, meta: null };
  }

  const data = await response.json();
  const metadata = data.metadata || {};
  const parsedDecimals = Number.parseInt(metadata.decimals || "9", 10);
  const decimals = Number.isSafeInteger(parsedDecimals) && parsedDecimals >= 0 ? parsedDecimals : 9;
  return {
    ok: true,
    status: response.status,
    meta: {
      address: metadata.address || jettonAddress,
      decimals,
      symbol: metadata.symbol || "UNKNOWN",
      name: metadata.name || "Unknown",
      totalSupply: data.total_supply || "0",
      holdersCount: data.holders_count || 0,
      verified: data.verification === "whitelist",
      description: metadata.description || undefined,
      image: data.preview || metadata.image || undefined,
    },
  };
}
