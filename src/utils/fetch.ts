/**
 * Fetch with timeout support using AbortSignal.
 */

import { DEFAULT_FETCH_TIMEOUT_MS } from "../constants/timeouts.js";

const DEFAULT_TIMEOUT_MS = DEFAULT_FETCH_TIMEOUT_MS;

export function fetchWithTimeout(
  url: string | URL | Request,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init ?? {};

  return fetch(url, {
    ...fetchInit,
    signal: fetchInit.signal
      ? AbortSignal.any([fetchInit.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  });
}

/** Capture retry metadata even when a provider adapter never calls onResponse. */
export function createRetryAfterTracker(fetcher: typeof fetch = globalThis.fetch) {
  let retryAt: number | undefined;
  return {
    fetch: (async (input, init) => {
      retryAt = undefined;
      const response = await fetcher(input, init);
      if (!response.ok) {
        const ms = response.headers.get("retry-after-ms");
        const after = response.headers.get("retry-after");
        let delay: number | undefined;
        if (ms !== null && ms.trim() && Number.isFinite(Number(ms)) && Number(ms) >= 0)
          delay = Number(ms);
        else if (after !== null && after.trim()) {
          const seconds = Number(after);
          delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(after) - Date.now();
        }
        if (delay !== undefined && Number.isFinite(delay) && delay >= 0)
          retryAt = Date.now() + delay;
      }
      return response;
    }) as typeof fetch,
    retryAfterMs: () => (retryAt === undefined ? undefined : Math.max(0, retryAt - Date.now())),
  };
}

export async function waitForRetry(
  delayMs: number,
  signal?: AbortSignal,
  deadline?: number
): Promise<void> {
  signal?.throwIfAborted();
  if (deadline !== undefined && delayMs >= deadline - Date.now()) {
    throw new Error("Provider retry delay exceeds remaining turn budget");
  }
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Retry cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
  signal?.throwIfAborted();
}
