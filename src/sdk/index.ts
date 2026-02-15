import type { TelegramBridge } from "../telegram/bridge.js";
import type Database from "better-sqlite3";
import type { PluginSDK, PluginLogger } from "@teleton-agent/sdk";
import { SDK_VERSION } from "@teleton-agent/sdk";
import { createTonSDK } from "./ton.js";
import { createTelegramSDK } from "./telegram.js";
import { createSecretsSDK } from "./secrets.js";
import { createStorageSDK } from "./storage.js";

// Re-export everything from @teleton-agent/sdk for internal consumers
export type {
  PluginSDK,
  TonSDK,
  TelegramSDK,
  SecretsSDK,
  SecretDeclaration,
  StorageSDK,
  PluginLogger,
  TonBalance,
  TonPrice,
  TonSendResult,
  TonTransaction,
  TransactionType,
  JettonBalance,
  JettonInfo,
  JettonSendResult,
  NftItem,
  SDKVerifyPaymentParams,
  SDKPaymentVerification,
  DiceResult,
  TelegramUser,
  SimpleMessage,
  SendMessageOptions,
  EditMessageOptions,
  ChatInfo,
  UserInfo,
  ResolvedPeer,
  MediaSendOptions,
  PollOptions,
  StarGift,
  ReceivedGift,
  StartContext,
  SimpleToolDef,
  PluginManifest,
  ToolResult,
  ToolScope,
  ToolCategory,
} from "@teleton-agent/sdk";

export { PluginSDKError, type SDKErrorCode, SDK_VERSION } from "@teleton-agent/sdk";

export interface SDKDependencies {
  bridge: TelegramBridge;
}

export interface CreatePluginSDKOptions {
  pluginName: string;
  db: Database.Database | null;
  sanitizedConfig: Record<string, unknown>;
  pluginConfig: Record<string, unknown>;
}

export function createPluginSDK(deps: SDKDependencies, opts: CreatePluginSDKOptions): PluginSDK {
  const log = createLogger(opts.pluginName);

  const ton = Object.freeze(createTonSDK(log, opts.db));
  const telegram = Object.freeze(createTelegramSDK(deps.bridge, log));
  const secrets = Object.freeze(createSecretsSDK(opts.pluginName, opts.pluginConfig, log));
  const storage = opts.db ? Object.freeze(createStorageSDK(opts.db)) : null;
  const frozenLog = Object.freeze(log);
  const frozenConfig = Object.freeze(opts.sanitizedConfig);
  const frozenPluginConfig = Object.freeze(opts.pluginConfig);

  return Object.freeze({
    version: SDK_VERSION,
    ton,
    telegram,
    secrets,
    storage,
    db: opts.db,
    config: frozenConfig,
    pluginConfig: frozenPluginConfig,
    log: frozenLog,
  });
}

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

export function semverSatisfies(current: string, range: string): boolean {
  const cur = parseSemver(current);
  if (!cur) {
    console.warn(`⚠️  [SDK] Could not parse current version "${current}", skipping check`);
    return true;
  }

  if (range.startsWith(">=")) {
    const req = parseSemver(range.slice(2));
    if (!req) {
      console.warn(`⚠️  [SDK] Malformed sdkVersion range "${range}", skipping check`);
      return true;
    }
    return semverGte(cur, req);
  }

  if (range.startsWith("^")) {
    const req = parseSemver(range.slice(1));
    if (!req) {
      console.warn(`⚠️  [SDK] Malformed sdkVersion range "${range}", skipping check`);
      return true;
    }
    if (req.major === 0) {
      return cur.major === 0 && cur.minor === req.minor && semverGte(cur, req);
    }
    return cur.major === req.major && semverGte(cur, req);
  }

  const req = parseSemver(range);
  if (!req) {
    console.warn(`⚠️  [SDK] Malformed sdkVersion "${range}", skipping check`);
    return true;
  }
  return cur.major === req.major && cur.minor === req.minor && cur.patch === req.patch;
}
