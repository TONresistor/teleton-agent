/**
 * Claude Code credential reader.
 *
 * Reads OAuth tokens from the local Claude Code installation:
 * - Linux/Windows: ~/.claude/.credentials.json
 * - macOS: Keychain (service "Claude Code-credentials") → file fallback
 *
 * Tokens are cached in memory and re-read only on expiration or forced refresh.
 */

import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("ClaudeCodeCreds");

// ── Types ──────────────────────────────────────────────────────────────

interface ClaudeOAuthCredentials {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
  };
}

// ── Module-level cache ─────────────────────────────────────────────────

let cachedToken: string | null = null;
let cachedExpiresAt = 0;

// ── Internal helpers ───────────────────────────────────────────────────

function getClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

function getCredentialsFilePath(): string {
  return join(getClaudeConfigDir(), ".credentials.json");
}

/** Read credentials from ~/.claude/.credentials.json */
function readCredentialsFile(): ClaudeOAuthCredentials | null {
  const filePath = getCredentialsFilePath();
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ClaudeOAuthCredentials;
  } catch (e) {
    log.warn({ err: e, path: filePath }, "Failed to parse Claude Code credentials file");
    return null;
  }
}

/** Read credentials from macOS Keychain via security CLI */
function readKeychainCredentials(): ClaudeOAuthCredentials | null {
  // Try the standard service name, then the legacy one (bug #1311)
  const serviceNames = ["Claude Code-credentials", "Claude Code"];

  for (const service of serviceNames) {
    try {
      const raw = execSync(`security find-generic-password -s "${service}" -w`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return JSON.parse(raw) as ClaudeOAuthCredentials;
    } catch {
      // Not found under this service name, try next
    }
  }
  return null;
}

/** Read credentials using the appropriate platform method */
function readCredentials(): ClaudeOAuthCredentials | null {
  if (process.platform === "darwin") {
    // macOS: Keychain first, file fallback
    const keychainCreds = readKeychainCredentials();
    if (keychainCreds) return keychainCreds;
    log.debug("Keychain read failed, falling back to credentials file");
  }

  return readCredentialsFile();
}

/** Extract and validate token + expiresAt from raw credentials */
function extractToken(creds: ClaudeOAuthCredentials): {
  token: string;
  expiresAt: number;
} | null {
  const oauth = creds.claudeAiOauth;
  if (!oauth?.accessToken) {
    log.warn("Claude Code credentials found but missing accessToken");
    return null;
  }
  return {
    token: oauth.accessToken,
    expiresAt: oauth.expiresAt ?? 0,
  };
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Get the Claude Code API key with intelligent caching.
 *
 * Resolution order:
 * 1. Return cached token if still valid (Date.now() < expiresAt)
 * 2. Read from disk/Keychain and cache
 * 3. Fall back to `fallbackKey` if provided
 * 4. Throw if nothing works
 */
export function getClaudeCodeApiKey(fallbackKey?: string): string {
  // Fast path: cached and valid
  if (cachedToken && Date.now() < cachedExpiresAt) {
    return cachedToken;
  }

  // Read from disk
  const creds = readCredentials();
  if (creds) {
    const extracted = extractToken(creds);
    if (extracted) {
      cachedToken = extracted.token;
      cachedExpiresAt = extracted.expiresAt;
      log.debug("Claude Code credentials loaded successfully");
      return cachedToken;
    }
  }

  // Fallback to manual key
  if (fallbackKey && fallbackKey.length > 0) {
    log.warn("Claude Code credentials not found, using fallback api_key from config");
    return fallbackKey;
  }

  throw new Error("No Claude Code credentials found. Run 'claude login' or set api_key in config.");
}

/**
 * Force re-read credentials from disk (called on 401 or manual refresh).
 * Returns the new token or null if unavailable.
 */
export function refreshClaudeCodeApiKey(): string | null {
  // Clear cache
  cachedToken = null;
  cachedExpiresAt = 0;

  const creds = readCredentials();
  if (creds) {
    const extracted = extractToken(creds);
    if (extracted) {
      cachedToken = extracted.token;
      cachedExpiresAt = extracted.expiresAt;
      log.info("Claude Code credentials refreshed from disk");
      return cachedToken;
    }
  }

  log.warn("Failed to refresh Claude Code credentials from disk");
  return null;
}

/** Check if the currently cached token is still valid */
export function isClaudeCodeTokenValid(): boolean {
  return cachedToken !== null && Date.now() < cachedExpiresAt;
}

/** Reset internal cache — exposed for testing only */
export function _resetCache(): void {
  cachedToken = null;
  cachedExpiresAt = 0;
}
