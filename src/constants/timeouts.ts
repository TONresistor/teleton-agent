/**
 * Centralized timeout values (in milliseconds)
 *
 * All timeout constants used across the codebase.
 * Import from here instead of using inline magic numbers.
 */

/** TTS generation timeout for OpenAI and ElevenLabs (30s) */
export const TTS_TIMEOUT_MS = 30_000;

/** Playwright page navigation timeout for market scraper (30s) */
export const BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;

/** Per-chat lock timeout to prevent stuck message handlers (2min) */
export const MESSAGE_HANDLER_LOCK_TIMEOUT_MS = 120_000;

/** Onboarding wizard prompt timeout - e.g. Playwright install (2min) */
export const ONBOARDING_PROMPT_TIMEOUT_MS = 120_000;

/** Delay between batch dependency triggers to avoid Telegram rate limits */
export const BATCH_TRIGGER_DELAY_MS = 500;

/** Default fetch timeout for fetchWithTimeout wrapper (15s) */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/** Scraper: initial page load wait (ms) */
export const SCRAPER_PAGE_LOAD_MS = 2_500;

/** Scraper: filter button click timeout (ms) */
export const SCRAPER_FILTER_CLICK_MS = 3_000;

/** Scraper: model button click timeout (ms) */
export const SCRAPER_MODEL_CLICK_MS = 2_000;

/** Scraper: wait after filter opens (ms) */
export const SCRAPER_FILTER_OPEN_MS = 600;

/** Scraper: wait after model list opens (ms) */
export const SCRAPER_MODEL_OPEN_MS = 800;

/** Scraper: wait between scroll iterations (ms) */
export const SCRAPER_SCROLL_STEP_MS = 80;

/** Scraper: wait before starting scroll (ms) */
export const SCRAPER_PRE_SCROLL_MS = 4_000;

/** Scraper: wait between collection page scrolls (ms) */
export const SCRAPER_COLLECTION_SCROLL_MS = 200;

/** Scraper: scroll increment in pixels */
export const SCRAPER_SCROLL_INCREMENT_PX = 250;

/** Scraper: scroll overflow padding in pixels */
export const SCRAPER_SCROLL_PADDING_PX = 500;

/** Scraper: window scroll step for collection list (px) */
export const SCRAPER_WINDOW_SCROLL_PX = 2_000;

/** Scraper: max scroll iterations for collection list */
export const SCRAPER_MAX_SCROLL_ITERATIONS = 15;

/** Scraper: page navigation timeout for collection pages (60s) */
export const SCRAPER_COLLECTION_NAV_MS = 60_000;

// ── Retry / Backoff ──

/** Default retry: max attempts */
export const RETRY_DEFAULT_MAX_ATTEMPTS = 3;

/** Default retry: base delay (ms) */
export const RETRY_DEFAULT_BASE_DELAY_MS = 1_000;

/** Default retry: max delay (ms) */
export const RETRY_DEFAULT_MAX_DELAY_MS = 10_000;

/** Default retry: operation timeout (ms) */
export const RETRY_DEFAULT_TIMEOUT_MS = 15_000;

/** Blockchain retry: base delay (ms) */
export const RETRY_BLOCKCHAIN_BASE_DELAY_MS = 2_000;

/** Blockchain retry: max delay (ms) */
export const RETRY_BLOCKCHAIN_MAX_DELAY_MS = 15_000;

/** Blockchain retry: operation timeout (ms) */
export const RETRY_BLOCKCHAIN_TIMEOUT_MS = 30_000;

/** GramJS MTProto reconnect delay (ms) */
export const GRAMJS_RETRY_DELAY_MS = 1_000;
