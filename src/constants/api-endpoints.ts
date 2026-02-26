import { fetchWithTimeout } from "../utils/fetch.js";
export const TONAPI_BASE_URL = "https://tonapi.io/v2";

let _tonapiKey: string | undefined;

export function setTonapiKey(key: string | undefined): void {
  _tonapiKey = key;
}
export function tonapiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (_tonapiKey) {
    headers["Authorization"] = `Bearer ${_tonapiKey}`;
  }
  return headers;
}

const TONAPI_RPS_WITH_KEY = 5;
const TONAPI_RPS_WITHOUT_KEY = 1;
const _tonapiTimestamps: number[] = [];

async function waitForTonapiSlot(): Promise<void> {
  const maxRps = _tonapiKey ? TONAPI_RPS_WITH_KEY : TONAPI_RPS_WITHOUT_KEY;
  const clean = () => {
    const cutoff = Date.now() - 1000;
    while (_tonapiTimestamps.length > 0 && _tonapiTimestamps[0] <= cutoff) {
      _tonapiTimestamps.shift();
    }
  };

  clean();
  if (_tonapiTimestamps.length >= maxRps) {
    const waitMs = _tonapiTimestamps[0] + 1000 - Date.now() + 50;
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    clean();
  }
  _tonapiTimestamps.push(Date.now());
}
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

export const STONFI_API_BASE_URL = "https://api.ston.fi/v1";
export const GECKOTERMINAL_API_URL = "https://api.geckoterminal.com/api/v2";
export const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";
export const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
export const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
export const VOYAGE_API_URL = "https://api.voyageai.com/v1";
