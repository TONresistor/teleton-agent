/**
 * @teleton-agent/sdk — Plugin SDK for Teleton Agent
 *
 * Provides TypeScript types and utilities for building
 * Teleton Agent plugins with full autocompletion and type safety.
 *
 * @example
 * ```typescript
 * import type { PluginSDK, SimpleToolDef, PluginManifest } from "@teleton-agent/sdk";
 * import { PluginSDKError } from "@teleton-agent/sdk";
 *
 * export const manifest: PluginManifest = {
 *   name: "my-plugin",
 *   version: "1.0.0",
 * };
 *
 * export const tools = (sdk: PluginSDK): SimpleToolDef[] => [
 *   {
 *     name: "my_tool",
 *     description: "Does something useful",
 *     execute: async (params, context) => {
 *       const balance = await sdk.ton.getBalance();
 *       return { success: true, data: balance };
 *     },
 *   },
 * ];
 * ```
 *
 * @packageDocumentation
 */

// ─── Types ───────────────────────────────────────────────────────

export type {
  // Root SDK
  PluginSDK,
  // TON
  TonSDK,
  TonBalance,
  TonPrice,
  TonSendResult,
  TonTransaction,
  TransactionType,
  JettonBalance,
  JettonInfo,
  JettonSendResult,
  NftItem,
  // Payment
  SDKVerifyPaymentParams,
  SDKPaymentVerification,
  // Telegram
  TelegramSDK,
  SendMessageOptions,
  EditMessageOptions,
  DiceResult,
  TelegramUser,
  SimpleMessage,
  ChatInfo,
  UserInfo,
  ResolvedPeer,
  MediaSendOptions,
  PollOptions,
  StarGift,
  ReceivedGift,
  StartContext,
  // Logger
  PluginLogger,
  // Secrets
  SecretsSDK,
  SecretDeclaration,
  // Storage
  StorageSDK,
  // Plugin definitions
  SimpleToolDef,
  PluginManifest,
  ToolResult,
  ToolScope,
  ToolCategory,
} from "./types.js";

// ─── Errors ──────────────────────────────────────────────────────

export { PluginSDKError, type SDKErrorCode } from "./errors.js";

// ─── Constants ───────────────────────────────────────────────────

/** Current SDK version (semver) */
export const SDK_VERSION = "1.0.0";
