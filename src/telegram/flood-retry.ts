import { createLogger } from "../utils/logger.js";

const log = createLogger("Telegram");

const DEFAULT_MAX_WAIT_SECONDS = 120;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Adaptive per-chat flood gate.
 *
 * Tracks FLOOD_WAIT penalties per chat and enforces a proactive cooldown
 * so subsequent sends wait *before* hitting the API, avoiding the
 * error → wait → retry cycle entirely.
 *
 * Cooldown decays by half every `DECAY_INTERVAL_MS` until it drops
 * below 1 s, at which point it is cleared.
 */
const DECAY_INTERVAL_MS = 60_000; // halve cooldown every minute
const MIN_COOLDOWN_MS = 1_000; // stop tracking below 1 s
const MAX_TRACKED_CHATS = 1_000; // prevent unbounded Map growth

interface CooldownEntry {
  /** Earliest wall-clock time (ms) at which a send is allowed. */
  nextSendAt: number;
  /** Current cooldown duration (ms) — decays over time. */
  cooldownMs: number;
  /** Timer handle for the decay tick. */
  decayTimer: NodeJS.Timeout;
}

export interface FloodRetryBudget {
  signal?: AbortSignal;
  deadline?: number;
}
export function assertFloodBudget(budget?: FloodRetryBudget): void {
  if (budget?.signal?.aborted) throw new Error("Telegram send cancelled before RPC");
  if (budget?.deadline !== undefined && Date.now() >= budget.deadline)
    throw new Error("Telegram send deadline expired before RPC");
}
async function waitWithinBudget(ms: number, budget?: FloodRetryBudget): Promise<void> {
  assertFloodBudget(budget);
  if (budget?.deadline !== undefined && Date.now() + ms >= budget.deadline) {
    throw new Error("Telegram send deadline expires during cooldown");
  }
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      budget?.signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      budget?.signal?.removeEventListener("abort", abort);
      reject(new Error("Telegram send cancelled during cooldown"));
    };
    budget?.signal?.addEventListener("abort", abort, { once: true });
    if (budget?.signal?.aborted) abort();
  });
  assertFloodBudget(budget);
}

class FloodGate {
  private cooldowns = new Map<string, CooldownEntry>();

  /** Wait until the chat's cooldown has elapsed (if any). */
  async waitFor(chatId: string, budget?: FloodRetryBudget): Promise<void> {
    assertFloodBudget(budget);
    const entry = this.cooldowns.get(chatId);
    if (!entry) return;

    const now = Date.now();
    const remaining = entry.nextSendAt - now;
    if (remaining <= 0) return;

    log.debug(`[FloodGate] ${chatId}: waiting ${(remaining / 1000).toFixed(1)}s (cooldown)`);
    await waitWithinBudget(remaining, budget);
  }

  /** Record a FLOOD_WAIT penalty for a chat. */
  recordFlood(chatId: string, waitSeconds: number): void {
    const cooldownMs = waitSeconds * 1000;
    const existing = this.cooldowns.get(chatId);

    if (existing) {
      clearTimeout(existing.decayTimer);
    }

    const entry: CooldownEntry = {
      nextSendAt: Date.now() + cooldownMs,
      cooldownMs,
      decayTimer: null as unknown as NodeJS.Timeout,
    };
    entry.decayTimer = this.scheduleDecay(chatId, entry);
    entry.decayTimer.unref?.();
    this.cooldowns.set(chatId, entry);

    // Evict oldest entry if Map grows too large
    if (this.cooldowns.size > MAX_TRACKED_CHATS) {
      const oldest = this.cooldowns.keys().next().value;
      if (oldest !== undefined && oldest !== chatId) {
        const stale = this.cooldowns.get(oldest);
        if (stale) clearTimeout(stale.decayTimer);
        this.cooldowns.delete(oldest);
      }
    }

    log.debug(`[FloodGate] ${chatId}: cooldown set to ${waitSeconds}s`);
  }

  /** After a successful send, maintain spacing only if still inside the cooldown window. */
  recordSuccess(chatId: string): void {
    const entry = this.cooldowns.get(chatId);
    if (!entry) return;
    const now = Date.now();
    // Only extend if the previous cooldown hasn't naturally elapsed yet
    if (now < entry.nextSendAt) return;
    entry.nextSendAt = now + entry.cooldownMs;
  }

  private scheduleDecay(chatId: string, entry: CooldownEntry): NodeJS.Timeout {
    return setTimeout(() => {
      entry.cooldownMs = Math.floor(entry.cooldownMs / 2);
      if (entry.cooldownMs < MIN_COOLDOWN_MS) {
        this.cooldowns.delete(chatId);
        log.debug(`[FloodGate] ${chatId}: cooldown cleared`);
        return;
      }
      log.debug(
        `[FloodGate] ${chatId}: cooldown decayed to ${(entry.cooldownMs / 1000).toFixed(1)}s`
      );
      entry.decayTimer = this.scheduleDecay(chatId, entry);
      entry.decayTimer.unref?.();
    }, DECAY_INTERVAL_MS);
  }
}

/** Singleton flood gate shared across all callers. */
export const floodGate = new FloodGate();

export async function withFloodRetry<T>(
  fn: () => Promise<T>,
  maxWaitSeconds = DEFAULT_MAX_WAIT_SECONDS,
  maxRetries = DEFAULT_MAX_RETRIES,
  chatId?: string,
  budget?: FloodRetryBudget
): Promise<T> {
  // Proactive wait: if this chat has an active cooldown, wait first
  if (chatId) {
    await floodGate.waitFor(chatId, budget);
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      assertFloodBudget(budget);
      const result = await fn();
      // Successful send — maintain spacing for this chat
      if (chatId) {
        floodGate.recordSuccess(chatId);
      }
      return result;
    } catch (error) {
      // GramJS FloodWaitError has a .seconds property
      let waitSeconds = (error as Record<string, unknown>).seconds;

      // Grammy GrammyError 429: parse retry delay from description
      if (typeof waitSeconds !== "number") {
        const errAny = error as Record<string, unknown>;
        if (errAny.error_code === 429 && typeof errAny.description === "string") {
          const match = (errAny.description as string).match(/retry after (\d+)/i);
          if (match) waitSeconds = parseInt(match[1], 10);
        }
      }

      if (typeof waitSeconds !== "number") {
        throw error;
      }

      lastError = error as Error;

      if (waitSeconds > maxWaitSeconds) {
        throw new Error(`FLOOD_WAIT ${waitSeconds}s exceeds max ${maxWaitSeconds}s — aborting`);
      }

      // Record the penalty so future sends to this chat wait proactively
      if (chatId) {
        floodGate.recordFlood(chatId, waitSeconds);
      }

      if (attempt >= maxRetries) break;

      log.warn(`[FLOOD_WAIT] Waiting ${waitSeconds}s before retry ${attempt + 1}/${maxRetries}`);
      await waitWithinBudget(waitSeconds * 1000, budget);
    }
  }

  throw lastError ?? new Error("FLOOD_WAIT retries exhausted");
}
