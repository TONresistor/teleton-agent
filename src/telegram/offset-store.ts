import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { join } from "path";
import { TELETON_ROOT } from "../workspace/paths.js";

const OFFSET_FILE = join(TELETON_ROOT, "telegram-offset.json");

interface OffsetState {
  version: number;
  /** Per-chat message offsets */
  perChat: Record<string, number>;
  accountId?: string;
}

const STORE_VERSION = 2;

// In-memory cache for fast access
let offsetCache: OffsetState | null = null;

/**
 * Load offset state from disk (or cache)
 */
function loadState(): OffsetState {
  if (offsetCache) return offsetCache;

  try {
    if (!existsSync(OFFSET_FILE)) {
      offsetCache = { version: STORE_VERSION, perChat: {} };
      return offsetCache;
    }

    const raw = readFileSync(OFFSET_FILE, "utf-8");
    const state = JSON.parse(raw);

    // Migrate from v1 (global offset) to v2 (per-chat)
    if (state.version === 1 || !state.perChat) {
      offsetCache = { version: STORE_VERSION, perChat: {} };
      return offsetCache;
    }

    offsetCache = state as OffsetState;
    return offsetCache;
  } catch (error) {
    console.warn("Failed to read offset store:", error);
    offsetCache = { version: STORE_VERSION, perChat: {} };
    return offsetCache;
  }
}

/**
 * Save offset state to disk
 */
function saveState(state: OffsetState): void {
  try {
    const dir = dirname(OFFSET_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(OFFSET_FILE, JSON.stringify(state, null, 2), "utf-8");
    offsetCache = state;
  } catch (error) {
    console.error("Failed to write offset store:", error);
  }
}

/**
 * Read the last processed message ID for a specific chat
 */
export function readOffset(chatId?: string): number | null {
  const state = loadState();
  if (!chatId) return null;
  return state.perChat[chatId] ?? null;
}

/**
 * Write the last processed message ID for a specific chat
 */
export function writeOffset(messageId: number, chatId?: string): void {
  if (!chatId) return;

  const state = loadState();
  const currentOffset = state.perChat[chatId] ?? 0;

  // Only update if new message ID is higher
  if (messageId > currentOffset) {
    state.perChat[chatId] = messageId;
    saveState(state);
  }
}

/**
 * Get all chat offsets (for debugging)
 */
export function getAllOffsets(): Record<string, number> {
  return loadState().perChat;
}
