import {
  RETRY_DEFAULT_MAX_ATTEMPTS,
  RETRY_DEFAULT_BASE_DELAY_MS,
  RETRY_DEFAULT_MAX_DELAY_MS,
  RETRY_DEFAULT_TIMEOUT_MS,
  RETRY_BLOCKCHAIN_BASE_DELAY_MS,
  RETRY_BLOCKCHAIN_MAX_DELAY_MS,
  RETRY_BLOCKCHAIN_TIMEOUT_MS,
} from "../constants/timeouts.js";
import { getErrorMessage } from "./errors.js";
import { createLogger } from "./logger.js";

const log = createLogger("Utils");

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error("Operation timeout")), opts.timeout);
        }),
      ]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log.warn(`Retry attempt ${attempt}/${opts.maxAttempts} failed: ${lastError.message}`);

      if (attempt < opts.maxAttempts) {
        const delay = Math.min(opts.baseDelayMs * Math.pow(2, attempt - 1), opts.maxDelayMs);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error("All retry attempts failed");
}
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
    const message = getErrorMessage(error);
    throw new Error(`${operation} failed after retries: ${message}`);
  }
}
