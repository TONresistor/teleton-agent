/**
 * Retry utility with exponential backoff for blockchain operations
 */

import {
  RETRY_DEFAULT_MAX_ATTEMPTS,
  RETRY_DEFAULT_BASE_DELAY_MS,
  RETRY_DEFAULT_MAX_DELAY_MS,
  RETRY_DEFAULT_TIMEOUT_MS,
  RETRY_BLOCKCHAIN_BASE_DELAY_MS,
  RETRY_BLOCKCHAIN_MAX_DELAY_MS,
  RETRY_BLOCKCHAIN_TIMEOUT_MS,
} from "../constants/timeouts.js";

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeout?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: RETRY_DEFAULT_MAX_ATTEMPTS,
  baseDelayMs: RETRY_DEFAULT_BASE_DELAY_MS,
  maxDelayMs: RETRY_DEFAULT_MAX_DELAY_MS,
  timeout: RETRY_DEFAULT_TIMEOUT_MS,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      // Add timeout wrapper
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Operation timeout")), opts.timeout)
        ),
      ]);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`Retry attempt ${attempt}/${opts.maxAttempts} failed:`, lastError.message);

      // Don't wait after last attempt
      if (attempt < opts.maxAttempts) {
        // Exponential backoff: 1s, 2s, 4s, ...
        const delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1), opts.maxDelayMs);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error("All retry attempts failed");
}

/**
 * Retry specifically for blockchain operations (longer timeouts)
 */
export async function withBlockchainRetry<T>(
  fn: () => Promise<T>,
  operation: string = "blockchain operation"
): Promise<T> {
  try {
    return await withRetry(fn, {
      maxAttempts: RETRY_DEFAULT_MAX_ATTEMPTS,
      baseDelayMs: RETRY_BLOCKCHAIN_BASE_DELAY_MS,
      maxDelayMs: RETRY_BLOCKCHAIN_MAX_DELAY_MS,
      timeout: RETRY_BLOCKCHAIN_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${operation} failed after retries: ${message}`);
  }
}
