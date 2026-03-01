import type { TelegramBridge } from "../telegram/bridge.js";
import type Database from "better-sqlite3";
import type { PluginSDK, PluginLogger } from "@teleton-agent/sdk";
import { SDK_VERSION } from "@teleton-agent/sdk";
import { createTonSDK } from "./ton.js";
import { createTelegramSDK } from "./telegram.js";
import { createSecretsSDK } from "./secrets.js";
import { createStorageSDK } from "./storage.js";
import { createLogger as pinoCreateLogger } from "../utils/logger.js";

const sdkLog = pinoCreateLogger("SDK");

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
  JettonPrice,
  JettonHolder,
  JettonHistory,
  DexSDK,
  DexQuoteParams,
  DexQuoteResult,
  DexSingleQuote,
  DexSwapParams,
  DexSwapResult,
  DnsSDK,
  DnsCheckResult,
  DnsAuction,
  DnsAuctionResult,
  DnsBidResult,
  DnsResolveResult,
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
  Dialog,
  StarsTransaction,
  TransferResult,
  CollectibleInfo,
  UniqueGift,
  GiftValue,
  GiftOfferOptions,
  SimpleToolDef,
  PluginManifest,
  PluginToolContext,
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

/** Block ATTACH/DETACH to prevent cross-plugin DB access */
const BLOCKED_SQL_RE = /\b(ATTACH|DETACH)\s+DATABASE\b/i;

/** Strip SQL comments so they can't be used to bypass keyword detection */
export function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments /* ... */
    .replace(/--[^\n]*/g, " "); // line comments -- ...
}

function isSqlBlocked(sql: string): boolean {
  return BLOCKED_SQL_RE.test(stripSqlComments(sql));
}

function createSafeDb(db: Database.Database): Database.Database {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "exec") {
        return (sql: string) => {
          if (isSqlBlocked(sql)) {
            throw new Error("ATTACH/DETACH DATABASE is not allowed in plugin context");
          }
          return target.exec(sql);
        };
      }
      if (prop === "prepare") {
        return (sql: string) => {
          if (isSqlBlocked(sql)) {
            throw new Error("ATTACH/DETACH DATABASE is not allowed in plugin context");
          }
          return target.prepare(sql);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createPluginSDK(deps: SDKDependencies, opts: CreatePluginSDKOptions): PluginSDK {
  const log = createLogger(opts.pluginName);

  const safeDb = opts.db ? createSafeDb(opts.db) : null;
  const ton = Object.freeze(createTonSDK(log, safeDb));
  const telegram = Object.freeze(createTelegramSDK(deps.bridge, log));
  const secrets = Object.freeze(createSecretsSDK(opts.pluginName, opts.pluginConfig, log));
  const storage = safeDb ? Object.freeze(createStorageSDK(safeDb)) : null;
  const frozenLog = Object.freeze(log);
  const frozenConfig = Object.freeze(JSON.parse(JSON.stringify(opts.sanitizedConfig ?? {})));
  const frozenPluginConfig = Object.freeze(JSON.parse(JSON.stringify(opts.pluginConfig ?? {})));

  return Object.freeze({
    version: SDK_VERSION,
    ton,
    telegram,
    secrets,
    storage,
    db: safeDb,
    config: frozenConfig,
    pluginConfig: frozenPluginConfig,
    log: frozenLog,
  });
}

function createLogger(pluginName: string): PluginLogger {
  const pinoChild = pinoCreateLogger(`plugin:${pluginName}`);
  return {
    info: (...args) => pinoChild.info(args.map(String).join(" ")),
    warn: (...args) => pinoChild.warn(args.map(String).join(" ")),
    error: (...args) => pinoChild.error(args.map(String).join(" ")),
    debug: (...args) => pinoChild.debug(args.map(String).join(" ")),
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
    sdkLog.warn(`[SDK] Could not parse current version "${current}", rejecting`);
    return false;
  }

  if (range.startsWith(">=")) {
    const req = parseSemver(range.slice(2));
    if (!req) {
      sdkLog.warn(`[SDK] Malformed sdkVersion range "${range}", rejecting`);
      return false;
    }
    return semverGte(cur, req);
  }

  if (range.startsWith("^")) {
    const req = parseSemver(range.slice(1));
    if (!req) {
      sdkLog.warn(`[SDK] Malformed sdkVersion range "${range}", rejecting`);
      return false;
    }
    if (req.major === 0) {
      return cur.major === 0 && cur.minor === req.minor && semverGte(cur, req);
    }
    return cur.major === req.major && semverGte(cur, req);
  }

  const req = parseSemver(range);
  if (!req) {
    sdkLog.warn(`[SDK] Malformed sdkVersion "${range}", rejecting`);
    return false;
  }
  return cur.major === req.major && cur.minor === req.minor && cur.patch === req.patch;
}
