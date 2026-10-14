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
