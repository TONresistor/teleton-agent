/**
 * Tonnet Plugin SDK — public type definitions.
 *
 * These interfaces define the contract between the core platform
 * and external plugins. Plugin authors use these types for
 * TypeScript autocompletion and type safety.
 *
 * @module @tonnet/sdk
 * @version 1.0.0
 */

import type Database from "better-sqlite3";
import type { TransactionType } from "../ton/format-transactions.js";

// ─── TON Types ───────────────────────────────────────────────────

/** Balance information for a TON address */
export interface TonBalance {
  /** Human-readable balance (e.g. "12.50") */
  balance: string;
  /** Balance in nanoTON as string */
  balanceNano: string;
}

/** TON/USD price information */
export interface TonPrice {
  /** Price in USD */
  usd: number;
  /** Data source ("TonAPI" or "CoinGecko") */
  source: string;
  /** Timestamp of price fetch (ms since epoch) */
  timestamp: number;
}

/** Result of a TON send operation */
export interface TonSendResult {
  /** Transaction reference (format: seqno_timestamp_amount) */
  txRef: string;
  /** Amount sent in TON */
  amount: number;
}

/** Formatted transaction from blockchain history */
export interface TonTransaction {
  /** Transaction type */
  type: TransactionType;
  /** Amount string (e.g. "1.5 TON") */
  amount?: string;
  /** Sender address */
  from?: string;
  /** Recipient address */
  to?: string;
  /** Transaction comment/memo */
  comment?: string | null;
  /** ISO 8601 date string */
  date: string;
  /** Seconds elapsed since this transaction */
  secondsAgo: number;
  /** Tonviewer explorer link */
  explorer: string;
  /** Jetton amount (raw, not formatted) */
  jettonAmount?: string;
  /** Jetton wallet address */
  jettonWallet?: string;
  /** NFT address */
  nftAddress?: string;
  /** For multi_send: array of individual transfers */
  transfers?: TonTransaction[];
}

// ─── Payment Verification Types ─────────────────────────────────

/** Parameters for verifying a TON payment */
export interface SDKVerifyPaymentParams {
  /** Expected payment amount in TON */
  amount: number;
  /** Expected memo/comment in the transaction (e.g. username, dealId) */
  memo: string;
  /** Game/operation type for replay protection grouping */
  gameType: string;
  /** Maximum age of valid payments in minutes (default: 10) */
  maxAgeMinutes?: number;
}

/** Result of payment verification */
export interface SDKPaymentVerification {
  /** Whether a valid payment was found */
  verified: boolean;
  /** Composite key used for replay protection */
  compositeKey?: string;
  /** Verified amount in TON */
  amount?: number;
  /** Sender's wallet address (for auto-payout) */
  playerWallet?: string;
  /** ISO 8601 date string of the transaction */
  date?: string;
  /** Seconds since the transaction */
  secondsAgo?: number;
  /** Error message if verification failed */
  error?: string;
}

// ─── Telegram Types ──────────────────────────────────────────────

/** Options for sending a message */
export interface SendMessageOptions {
  /** Message ID to reply to */
  replyToId?: number;
  /** Inline keyboard buttons (2D array: rows of buttons) */
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
}

/** Options for editing a message */
export interface EditMessageOptions {
  /** Updated inline keyboard (omit to keep existing) */
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
}

/** Result of sending a dice animation */
export interface DiceResult {
  /** The dice value (1-6 for dice, 1-64 for slots, etc.) */
  value: number;
  /** Message ID of the dice message */
  messageId: number;
}

/** User info returned by getMe */
export interface TelegramUser {
  /** Telegram user ID */
  id: number;
  /** Username without @ (may be undefined) */
  username?: string;
  /** First name */
  firstName?: string;
  /** Whether the user is a bot */
  isBot: boolean;
}

/** Simplified message from getMessages */
export interface SimpleMessage {
  /** Message ID */
  id: number;
  /** Message text */
  text: string;
  /** Sender user ID */
  senderId: number;
  /** Sender username */
  senderUsername?: string;
  /** Message timestamp */
  timestamp: Date;
}

// ─── SDK Interfaces ──────────────────────────────────────────────

/**
 * TON blockchain operations.
 *
 * Provides safe access to wallet, balance, price, and transfer
 * functionality without exposing private keys or mnemonics.
 */
export interface TonSDK {
  /**
   * Get the bot's own TON wallet address.
   * @returns Wallet address, or null if wallet is not initialized.
   */
  getAddress(): string | null;

  /**
   * Get balance for a TON address.
   * Defaults to the bot's own wallet if no address provided.
   *
   * @param address — TON address (EQ... or UQ... format)
   * @returns Balance info, or null on error.
   */
  getBalance(address?: string): Promise<TonBalance | null>;

  /**
   * Get current TON/USD price.
   * Uses TonAPI with CoinGecko fallback. Cached 30s internally.
   *
   * @returns Price info, or null if all sources fail.
   */
  getPrice(): Promise<TonPrice | null>;

  /**
   * Send TON to a recipient address.
   *
   * WARNING: This performs an irreversible blockchain transaction.
   * Always validate amount and address before calling.
   *
   * @param to — Recipient TON address
   * @param amount — Amount in TON (e.g. 1.5)
   * @param comment — Optional transaction comment/memo
   * @throws {PluginSDKError} WALLET_NOT_INITIALIZED, INVALID_ADDRESS, OPERATION_FAILED
   */
  sendTON(to: string, amount: number, comment?: string): Promise<TonSendResult>;

  /**
   * Get transaction history for a TON address.
   *
   * @param address — TON address to query
   * @param limit — Max transactions to return (default: 10, max: 50)
   * @returns Array of formatted transactions, or empty array on error.
   */
  getTransactions(address: string, limit?: number): Promise<TonTransaction[]>;

  /**
   * Verify a TON payment was received with memo matching and replay protection.
   *
   * Checks recent transactions for a matching payment:
   * - Amount >= expected (1% tolerance for fees)
   * - Memo matches expected identifier (case-insensitive)
   * - Within time window (default 10 minutes)
   * - Not already used (INSERT OR IGNORE into used_transactions)
   *
   * Requires the plugin to export a migrate() that creates the used_transactions table.
   *
   * @param params — Payment verification parameters
   * @returns Verification result with sender wallet for auto-payout
   * @throws {PluginSDKError} WALLET_NOT_INITIALIZED, OPERATION_FAILED
   */
  verifyPayment(params: SDKVerifyPaymentParams): Promise<SDKPaymentVerification>;
}

/**
 * Telegram messaging and user operations.
 *
 * All methods that interact with Telegram require the bridge to be connected.
 * They throw PluginSDKError with code BRIDGE_NOT_CONNECTED if called
 * before the bridge is ready (i.e., during plugin loading).
 */
export interface TelegramSDK {
  /**
   * Send a text message to a chat.
   *
   * @param chatId — Telegram chat ID
   * @param text — Message text
   * @param opts — Reply-to and inline keyboard options
   * @returns Message ID of the sent message
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<number>;

  /**
   * Edit an existing message.
   *
   * @param chatId — Chat ID where the message lives
   * @param messageId — ID of the message to edit
   * @param text — New message text
   * @param opts — Updated inline keyboard
   * @returns Message ID of the edited message
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  editMessage(
    chatId: string,
    messageId: number,
    text: string,
    opts?: EditMessageOptions
  ): Promise<number>;

  /**
   * Send a dice/slot animation and get the result value.
   *
   * Supported emoticons and their value ranges:
   * - "🎲" (dice: 1-6)
   * - "🎯" (darts: 1-6)
   * - "🏀" (basketball: 1-5)
   * - "⚽" (football: 1-5)
   * - "🎳" (bowling: 1-6)
   * - "🎰" (slots: 1-64)
   *
   * @param chatId — Chat ID to send to
   * @param emoticon — Dice emoticon
   * @param replyToId — Optional message to reply to
   * @returns Dice result with value and message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendDice(chatId: string, emoticon: string, replyToId?: number): Promise<DiceResult>;

  /**
   * Send an emoji reaction to a message.
   *
   * @param chatId — Chat ID
   * @param messageId — Message to react to
   * @param emoji — Reaction emoji (e.g. "👍", "🔥")
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendReaction(chatId: string, messageId: number, emoji: string): Promise<void>;

  /**
   * Get recent messages from a chat.
   *
   * @param chatId — Chat ID to fetch from
   * @param limit — Max messages (default: 50)
   * @returns Simplified message objects, or empty array on error.
   */
  getMessages(chatId: string, limit?: number): Promise<SimpleMessage[]>;

  /**
   * Get bot's own user info.
   * @returns Own user info, or null if not connected.
   */
  getMe(): TelegramUser | null;

  /**
   * Check if the Telegram bridge is connected and ready.
   */
  isAvailable(): boolean;

  /**
   * Get the raw GramJS TelegramClient for advanced operations.
   *
   * WARNING: This is an escape hatch. Using the raw client bypasses
   * SDK error handling and safety checks. Prefer SDK methods when possible.
   *
   * @returns GramJS TelegramClient instance
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED
   */
  getRawClient(): unknown;
}

/**
 * Prefixed logger for plugin output.
 * All methods prepend the plugin name automatically.
 */
export interface PluginLogger {
  /** Log informational message. Output: [plugin-name] message */
  info(...args: unknown[]): void;
  /** Log warning. Output: [plugin-name] message */
  warn(...args: unknown[]): void;
  /** Log error. Output: [plugin-name] message */
  error(...args: unknown[]): void;
  /** Log debug message (only visible when DEBUG or VERBOSE env vars are set) */
  debug(...args: unknown[]): void;
}

// ─── Root SDK ────────────────────────────────────────────────────

/**
 * The complete Plugin SDK passed to plugins via `tools(sdk)`.
 *
 * Provides namespaced access to TON blockchain, Telegram messaging,
 * and plugin infrastructure (DB, config, logging).
 *
 * @example
 * ```javascript
 * export const tools = (sdk) => [{
 *   name: "my_tool",
 *   description: "Does something cool",
 *   async execute(params, context) {
 *     const balance = await sdk.ton.getBalance();
 *     await sdk.telegram.sendMessage(context.chatId, `Balance: ${balance?.balance}`);
 *     return { success: true };
 *   }
 * }];
 * ```
 */
export interface PluginSDK {
  /** SDK version (semver, e.g. "1.0.0") */
  readonly version: string;

  /** TON blockchain operations */
  readonly ton: TonSDK;

  /** Telegram messaging and user operations */
  readonly telegram: TelegramSDK;

  /** Plugin's isolated SQLite database (null if no migrate() exported) */
  readonly db: Database.Database | null;

  /** Sanitized application config (no API keys or secrets) */
  readonly config: Record<string, unknown>;

  /** Plugin-specific config from config.yaml plugins section */
  readonly pluginConfig: Record<string, unknown>;

  /** Prefixed logger */
  readonly log: PluginLogger;
}
