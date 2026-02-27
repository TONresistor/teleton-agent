/** Maximum serialized tool result size before truncation */
export const MAX_TOOL_RESULT_SIZE = 50_000;
export const MAX_FILENAME_LENGTH = 255;
export const DEFAULT_GIFTS_QUERY_LIMIT = 50;
export const MAX_POLL_QUESTION_LENGTH = 300;
export const DEAL_VERIFICATION_WINDOW_SECONDS = 300;
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
export const MAX_JSON_FIELD_CHARS = 8_000;
export const MAX_TOTAL_PROMPT_CHARS = 32_000;
export const VOYAGE_BATCH_SIZE = 128;
export const SQLITE_CACHE_SIZE_KB = 64_000;
export const SQLITE_MMAP_SIZE = 256_000_000;
export const SECONDS_PER_DAY = 86_400;
export const SECONDS_PER_HOUR = 3_600;
export const COMPACTION_MAX_MESSAGES = 200;
export const COMPACTION_KEEP_RECENT = 20;
export const COMPACTION_MAX_TOKENS_RATIO = 0.75;
export const COMPACTION_SOFT_THRESHOLD_RATIO = 0.5;
export const PENDING_HISTORY_MAX_PER_CHAT = 50;
export const PENDING_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DEBOUNCE_MAX_MULTIPLIER = 3;
export const DEBOUNCE_MAX_BUFFER_SIZE = 20;
export const CONTEXT_MAX_RECENT_MESSAGES = 10;
export const CONTEXT_MAX_RELEVANT_CHUNKS = 5;
export const HYBRID_SEARCH_MIN_SCORE = 0.15;
export const CONTEXT_OVERFLOW_SUMMARY_MESSAGES = 15;
export const RATE_LIMIT_MAX_RETRIES = 3;
export const SERVER_ERROR_MAX_RETRIES = 3;
export const KNOWLEDGE_CHUNK_SIZE = 500;
export const PAYMENT_TOLERANCE_RATIO = 0.99;
export const TELEGRAM_CONNECTION_RETRIES = 5;
export const TELEGRAM_FLOOD_SLEEP_THRESHOLD = 60;
export const MAX_DEPENDENTS_PER_TASK = 10;
export const EMBEDDING_CACHE_MAX_ENTRIES = 50_000;
export const EMBEDDING_CACHE_TTL_DAYS = 60;
export const EMBEDDING_CACHE_EVICTION_INTERVAL = 1000;
export const MAX_WRITE_SIZE = 50 * 1024 * 1024;

// ─── Compaction & Summarization ─────────────────────────────────
export const DEFAULT_MAX_TOKENS = 96_000;
export const DEFAULT_SOFT_THRESHOLD_TOKENS = 64_000;
export const FALLBACK_SOFT_THRESHOLD_TOKENS = 6_000;
export const DEFAULT_CONTEXT_WINDOW = 150_000;
export const DEFAULT_MAX_SUMMARY_TOKENS = 2_000;
export const DEFAULT_SUMMARY_FALLBACK_TOKENS = 1_000;
export const MEMORY_FLUSH_RECENT_MESSAGES = 5;

// ─── Token Estimation ───────────────────────────────────────────
export const CHARS_PER_TOKEN_ESTIMATE = 4;
export const TOKEN_ESTIMATE_SAFETY_MARGIN = 1.2;

// ─── Adaptive Chunking ──────────────────────────────────────────
export const OVERSIZED_MESSAGE_RATIO = 0.5;
export const ADAPTIVE_CHUNK_RATIO_BASE = 0.4;
export const ADAPTIVE_CHUNK_RATIO_MIN = 0.15;
export const ADAPTIVE_CHUNK_RATIO_TRIGGER = 0.1;

// ─── Session Memory Hook ────────────────────────────────────────
export const SESSION_SLUG_RECENT_MESSAGES = 10;
export const SESSION_SLUG_MAX_TOKENS = 50;

// ─── Observation Masking ────────────────────────────────────────
export const MASKING_KEEP_RECENT_COUNT = 10;

// ─── Embedding Cache ────────────────────────────────────────────
export const EMBEDDING_CACHE_EVICTION_RATIO = 0.1;

// ─── Web Tools ─────────────────────────────────────────────────
export const WEB_FETCH_MAX_TEXT_LENGTH = 20_000; // default text truncation
export const WEB_SEARCH_MAX_RESULTS = 10; // max allowed count

// ─── Tool RAG ──────────────────────────────────────────────────
export const TOOL_RAG_DEFAULT_TOP_K = 25;
export const TOOL_RAG_MIN_SCORE = 0.1;
export const TOOL_RAG_VECTOR_WEIGHT = 0.6;
export const TOOL_RAG_KEYWORD_WEIGHT = 0.4;
