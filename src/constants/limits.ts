/**
 * Centralized size and count limits
 *
 * All numeric limits and thresholds used across the codebase.
 * Import from here instead of using inline magic numbers.
 */

/** Maximum serialized tool result size before truncation (~50KB) */
export const MAX_TOOL_RESULT_SIZE = 50_000;

/** Maximum filename length (filesystem limit) */
export const MAX_FILENAME_LENGTH = 255;

/** Default limit for gift queries in GiftDetector */
export const DEFAULT_GIFTS_QUERY_LIMIT = 50;

/** Maximum poll/quiz question length (Telegram API limit) */
export const MAX_POLL_QUESTION_LENGTH = 300;

/** Time window (seconds) for deal verification validity (5 minutes) */
export const DEAL_VERIFICATION_WINDOW_SECONDS = 300;

/** Telegram maximum message text length */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/** Maximum characters for a single JSON field in task prompts */
export const MAX_JSON_FIELD_CHARS = 8_000;

/** Maximum total characters for task executor prompts */
export const MAX_TOTAL_PROMPT_CHARS = 32_000;

/** Voyage AI embedding batch size limit */
export const VOYAGE_BATCH_SIZE = 128;

/** SQLite cache size in KB (64MB) */
export const SQLITE_CACHE_SIZE_KB = 64_000;

/** SQLite mmap size in bytes (30GB) */
export const SQLITE_MMAP_SIZE = 30_000_000_000;

/** Seconds in a day (24 * 60 * 60) */
export const SECONDS_PER_DAY = 86_400;

/** Seconds in an hour */
export const SECONDS_PER_HOUR = 3_600;

/** Default compaction maxMessages */
export const COMPACTION_MAX_MESSAGES = 200;

/** Default compaction keepRecentMessages */
export const COMPACTION_KEEP_RECENT = 20;

/** Compaction max tokens ratio (fraction of context window) */
export const COMPACTION_MAX_TOKENS_RATIO = 0.75;

/** Compaction soft threshold ratio (fraction of context window) */
export const COMPACTION_SOFT_THRESHOLD_RATIO = 0.5;

/** Market scraper parallel workers count */
export const SCRAPER_PARALLEL_WORKERS = 4;

// ── Pending History ──

/** Maximum pending messages per group chat before eviction */
export const PENDING_HISTORY_MAX_PER_CHAT = 50;

/** Maximum age of pending messages before eviction (24h) */
export const PENDING_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ── Debounce ──

/** Default debounce max multiplier (maxDebounceMs = debounceMs * this) */
export const DEBOUNCE_MAX_MULTIPLIER = 3;

/** Default max messages in debounce buffer before force flush */
export const DEBOUNCE_MAX_BUFFER_SIZE = 20;

// ── Agent Runtime Context ──

/** Max recent messages used for context building (RAG) */
export const CONTEXT_MAX_RECENT_MESSAGES = 10;

/** Max relevant knowledge chunks for context building (RAG) */
export const CONTEXT_MAX_RELEVANT_CHUNKS = 5;

/** Max messages in context summary on overflow */
export const CONTEXT_OVERFLOW_SUMMARY_MESSAGES = 15;

/** Max rate limit retries before giving up */
export const RATE_LIMIT_MAX_RETRIES = 3;

// ── Knowledge Indexing ──

/** Chunk size (characters) for knowledge markdown splitting */
export const KNOWLEDGE_CHUNK_SIZE = 500;

/** Overlap (characters) between consecutive knowledge chunks */
export const KNOWLEDGE_CHUNK_OVERLAP = 50;

// ── Casino ──

/** Payment tolerance ratio (accept 99% of expected amount to account for fees) */
export const PAYMENT_TOLERANCE_RATIO = 0.99;

// ── Telegram Connection ──

/** Telegram connection retry attempts */
export const TELEGRAM_CONNECTION_RETRIES = 5;

/** Telegram flood sleep threshold (seconds) */
export const TELEGRAM_FLOOD_SLEEP_THRESHOLD = 60;
