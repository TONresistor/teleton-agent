/**
 * Tonnet Plugin SDK — factory and version.
 *
 * Creates fully-featured SDK instances for external plugins.
 * Internal services are accessed lazily — the bridge may not be connected
 * when the SDK is created, but it will be by the time any tool executor runs.
 *
 * @module @tonnet/sdk
 */

import type { TelegramBridge } from "../telegram/bridge.js";
import type Database from "better-sqlite3";
import type { PluginSDK, PluginLogger } from "./types.js";
import { createTonSDK } from "./ton.js";
import { createTelegramSDK } from "./telegram.js";

// Re-export public types for plugin authors
export type {
  PluginSDK,
  TonSDK,
  TelegramSDK,
  PluginLogger,
  TonBalance,
  TonPrice,
  TonSendResult,
  TonTransaction,
  SDKVerifyPaymentParams,
  SDKPaymentVerification,
  DiceResult,
  TelegramUser,
  SimpleMessage,
  SendMessageOptions,
  EditMessageOptions,
} from "./types.js";

export { PluginSDKError, type SDKErrorCode } from "./errors.js";

/** Current SDK version — bumped on breaking or feature changes */
export const SDK_VERSION = "1.0.0";

/** Dependencies injected into the SDK factory (from the core app) */
export interface SDKDependencies {
  /** Telegram bridge reference (may not be connected yet at creation time) */
  bridge: TelegramBridge;
}

/** Per-plugin options for SDK creation */
export interface CreatePluginSDKOptions {
  pluginName: string;
  db: Database.Database | null;
  sanitizedConfig: Record<string, unknown>;
  pluginConfig: Record<string, unknown>;
}

/**
 * Create a complete PluginSDK instance for a plugin.
 *
 * The returned SDK captures a lazy reference to the bridge.
 * Methods that require the bridge check `bridge.isAvailable()` at
 * call time, not at creation time.
 */
export function createPluginSDK(deps: SDKDependencies, opts: CreatePluginSDKOptions): PluginSDK {
  const log = createLogger(opts.pluginName);

  // Deep freeze: freeze all nested objects to prevent mutation
  const ton = Object.freeze(createTonSDK(log, opts.db));
  const telegram = Object.freeze(createTelegramSDK(deps.bridge, log));
  const frozenLog = Object.freeze(log);
  const frozenConfig = Object.freeze(opts.sanitizedConfig);
  const frozenPluginConfig = Object.freeze(opts.pluginConfig);

  return Object.freeze({
    version: SDK_VERSION,
    ton,
    telegram,
    db: opts.db,
    config: frozenConfig,
    pluginConfig: frozenPluginConfig,
    log: frozenLog,
  });
}

/**
 * Create a prefixed logger for a plugin.
 */
function createLogger(pluginName: string): PluginLogger {
  const prefix = `[${pluginName}]`;
  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(`⚠️ ${prefix}`, ...args),
    error: (...args) => console.error(`❌ ${prefix}`, ...args),
    debug: (...args) => {
      if (process.env.DEBUG || process.env.VERBOSE) {
        console.log(`🔍 ${prefix}`, ...args);
      }
    },
  };
}

// ─── Semver Utilities ────────────────────────────────────────────

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(v: string): SemVer | null {
  const match = v.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
  };
}

function semverGte(a: SemVer, b: SemVer): boolean {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch >= b.patch;
}

/**
 * Minimal semver range check.
 * Supports: ">=1.0.0", "^1.0.0", exact "1.0.0"
 */
export function semverSatisfies(current: string, range: string): boolean {
  const cur = parseSemver(current);
  if (!cur) {
    console.warn(`⚠️  [SDK] Could not parse current version "${current}", skipping check`);
    return true;
  }

  // >=X.Y.Z
  if (range.startsWith(">=")) {
    const req = parseSemver(range.slice(2));
    if (!req) {
      console.warn(`⚠️  [SDK] Malformed sdkVersion range "${range}", skipping check`);
      return true;
    }
    return semverGte(cur, req);
  }

  // ^X.Y.Z — compatible: same major (1.x+), or same minor (0.x)
  if (range.startsWith("^")) {
    const req = parseSemver(range.slice(1));
    if (!req) {
      console.warn(`⚠️  [SDK] Malformed sdkVersion range "${range}", skipping check`);
      return true;
    }
    if (req.major === 0) {
      // ^0.Y.Z locks minor: >=0.Y.Z <0.(Y+1).0
      return cur.major === 0 && cur.minor === req.minor && semverGte(cur, req);
    }
    return cur.major === req.major && semverGte(cur, req);
  }

  // Exact match
  const req = parseSemver(range);
  if (!req) {
    console.warn(`⚠️  [SDK] Malformed sdkVersion "${range}", skipping check`);
    return true;
  }
  return cur.major === req.major && cur.minor === req.minor && cur.patch === req.patch;
}
