/**
 * Fetch wrapper with timeout support
 * Prevents infinite hangs on unresponsive APIs
 */

import { DEFAULT_FETCH_TIMEOUT_MS } from "../constants/timeouts.js";

const DEFAULT_TIMEOUT_MS = DEFAULT_FETCH_TIMEOUT_MS;

/**
 * Fetch with automatic timeout via AbortSignal.
 * Drop-in replacement for global fetch().
 */
export function fetchWithTimeout(
  url: string | URL | Request,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init ?? {};

  // If caller already provided a signal, don't override it
  if (fetchInit.signal) {
    return fetch(url, fetchInit);
  }

  return fetch(url, {
    ...fetchInit,
    signal: AbortSignal.timeout(timeoutMs),
  });
}
