/**
 * Centralized API base URLs
 *
 * All external API endpoints used across the codebase.
 * Import from here instead of defining locally in each file.
 */

import { fetchWithTimeout } from "../utils/fetch.js";

/** TON API v2 base URL - blockchain data, jetton info, DNS, etc. */
export const TONAPI_BASE_URL = "https://tonapi.io/v2";

/** TonAPI key (set at startup if configured) */
let _tonapiKey: string | undefined;

/** Set TonAPI key at startup */
export function setTonapiKey(key: string | undefined): void {
  _tonapiKey = key;
}

/** Get headers for TonAPI requests (includes Bearer auth if key is set) */
export function tonapiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (_tonapiKey) {
    headers["Authorization"] = `Bearer ${_tonapiKey}`;
  }
  return headers;
}

/** Sliding window rate limiter for TonAPI (5 req/s) */
const TONAPI_MAX_RPS = 5;
const _tonapiTimestamps: number[] = [];

async function waitForTonapiSlot(): Promise<void> {
  // Clean expired timestamps
  const clean = () => {
    const cutoff = Date.now() - 1000;
    while (_tonapiTimestamps.length > 0 && _tonapiTimestamps[0] <= cutoff) {
      _tonapiTimestamps.shift();
    }
  };

  clean();
  if (_tonapiTimestamps.length >= TONAPI_MAX_RPS) {
    const waitMs = _tonapiTimestamps[0] + 1000 - Date.now() + 50; // +50ms safety margin
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    clean(); // Re-clean after waiting
  }
  _tonapiTimestamps.push(Date.now());
}

/**
 * Rate-limited fetch for TonAPI. Pass the path after /v2 (e.g. "/rates?tokens=ton").
 * Automatically adds base URL, auth headers, and respects 5 req/s limit.
 */
export async function tonapiFetch(
  path: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  await waitForTonapiSlot();
  return fetchWithTimeout(`${TONAPI_BASE_URL}${path}`, {
    ...init,
    headers: { ...tonapiHeaders(), ...(init?.headers as Record<string, string>) },
  });
}

/** STON.fi DEX API v1 - pools, trending, search */
export const STONFI_API_BASE_URL = "https://api.ston.fi/v1";

/** GeckoTerminal API v2 - token price history charts */
export const GECKOTERMINAL_API_URL = "https://api.geckoterminal.com/api/v2";

/** CoinGecko API v3 - TON/USD price */
export const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";

/** MarketApp.ws - Gift marketplace scraping */
export const MARKETAPP_BASE_URL = "https://marketapp.ws";

/** OpenAI TTS API endpoint */
export const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";

/** ElevenLabs TTS API base */
export const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

/** Voyage AI embeddings API */
export const VOYAGE_API_URL = "https://api.voyageai.com/v1";
