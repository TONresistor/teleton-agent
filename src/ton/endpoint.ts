/**
 * Cached wrapper for @orbs-network/ton-access getHttpEndpoint()
 *
 * The upstream function makes a network call to discover a healthy
 * TON HTTP-API node.  Caching avoids repeating that round-trip on
 * every payment verification / payout within a short window.
 */

import { getHttpEndpoint } from "@orbs-network/ton-access";

const ENDPOINT_CACHE_TTL_MS = 60_000; // 60 seconds

let _cache: { url: string; ts: number } | null = null;

/**
 * Return a mainnet TON HTTP endpoint, re-using a cached value
 * when it is less than 60 seconds old.
 */
export async function getCachedHttpEndpoint(): Promise<string> {
  if (_cache && Date.now() - _cache.ts < ENDPOINT_CACHE_TTL_MS) {
    return _cache.url;
  }

  const url = await getHttpEndpoint({ network: "mainnet" });
  _cache = { url, ts: Date.now() };
  return url;
}
