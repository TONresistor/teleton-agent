/**
 * Teleton Plugin SDK — public type definitions.
 *
 * These interfaces define the contract between the core platform
 * and external plugins. Plugin authors use these types for
 * TypeScript autocompletion and type safety.
 *
 * @module @teleton-agent/sdk
 * @version 1.0.0
 */

import type Database from "better-sqlite3";

// ─── TON Types ───────────────────────────────────────────────────

/** Transaction type from blockchain history */
export type TransactionType =
  | "ton_received"
  | "ton_sent"
  | "jetton_received"
  | "jetton_sent"
  | "nft_received"
  | "nft_sent"
  | "gas_refund"
  | "bounce"
  | "contract_call"
  | "multi_send";

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
  /** Blockchain transaction hash (hex) */
  hash: string;
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

/** Jetton (token) balance for a specific jetton */
export interface JettonBalance {
  /** Jetton master contract address */
  jettonAddress: string;
  /** Owner's jetton wallet address */
  walletAddress: string;
  /** Balance in raw units (string to avoid precision loss) */
  balance: string;
  /** Human-readable balance (e.g. "100.50") */
  balanceFormatted: string;
  /** Token ticker symbol (e.g. "USDT") */
  symbol: string;
  /** Token name (e.g. "Tether USD") */
  name: string;
  /** Token decimals (e.g. 6 for USDT, 9 for TON) */
  decimals: number;
  /** Whether the token is verified on TonAPI */
  verified: boolean;
  /** USD price per token (if available) */
  usdPrice?: number;
}

/** Jetton metadata information */
export interface JettonInfo {
  /** Jetton master contract address */
  address: string;
  /** Token name */
  name: string;
  /** Token ticker symbol */
  symbol: string;
  /** Token decimals */
  decimals: number;
  /** Total supply in raw units */
  totalSupply: string;
  /** Number of unique holders */
  holdersCount: number;
  /** Whether verified on TonAPI */
  verified: boolean;
  /** Token description (if available) */
  description?: string;
  /** Token image URL (if available) */
  image?: string;
}

/** Result of a jetton transfer */
export interface JettonSendResult {
  /** Whether the transaction was successfully sent */
  success: boolean;
  /** Wallet sequence number used */
  seqno: number;
}

/** NFT item information */
export interface NftItem {
  /** NFT item contract address */
  address: string;
  /** Index within collection */
  index: number;
  /** Current owner address */
  ownerAddress?: string;
  /** Collection contract address */
  collectionAddress?: string;
  /** Collection name */
  collectionName?: string;
  /** NFT name */
  name?: string;
  /** NFT description */
  description?: string;
  /** NFT image URL */
  image?: string;
  /** Whether the NFT/collection is verified */
  verified: boolean;
}

// ─── Jetton Analytics Types ─────────────────────────────────────

/** Jetton price data from TonAPI /rates */
export interface JettonPrice {
  /** Price in USD */
  priceUSD: number | null;
  /** Price in TON */
  priceTON: number | null;
  /** 24h change (USD) e.g. "-2.5%" */
  change24h: string | null;
  /** 7d change (USD) */
  change7d: string | null;
  /** 30d change (USD) */
  change30d: string | null;
}

/** Top holder of a jetton */
export interface JettonHolder {
  /** Rank (1 = top holder) */
  rank: number;
  /** Holder's TON address */
  address: string;
  /** Human-readable name if known (e.g. "Binance") */
  name: string | null;
  /** Formatted balance (e.g. "1,234.56") */
  balance: string;
  /** Raw balance in smallest units */
  balanceRaw: string;
}

/** Jetton market analytics (TonAPI + GeckoTerminal) */
export interface JettonHistory {
  /** Token symbol */
  symbol: string;
  /** Token name */
  name: string;
  /** Current price in USD */
  currentPrice: string;
  /** Current price in TON */
  currentPriceTON: string;
  /** Price changes */
  changes: { "24h": string; "7d": string; "30d": string };
  /** 24h trading volume in USD */
  volume24h: string;
  /** Fully diluted valuation */
  fdv: string;
  /** Market cap */
  marketCap: string;
  /** Number of holders */
  holders: number;
}

// ─── DEX Types ──────────────────────────────────────────────────

/** Parameters for DEX quote/swap */
export interface DexQuoteParams {
  /** Source asset: "ton" or jetton master address */
  fromAsset: string;
  /** Destination asset: "ton" or jetton master address */
  toAsset: string;
  /** Amount in human-readable units */
  amount: number;
  /** Slippage tolerance (0.01 = 1%, default 0.01, range 0.001-0.5) */
  slippage?: number;
}

/** Aggregated quote comparing both DEXes */
export interface DexQuoteResult {
  /** STON.fi quote (null if no liquidity) */
  stonfi: DexSingleQuote | null;
  /** DeDust quote (null if no liquidity) */
  dedust: DexSingleQuote | null;
  /** Recommended DEX */
  recommended: "stonfi" | "dedust";
  /** Savings vs the other DEX (e.g. "0.5%") */
  savings: string;
}

/** Quote from a single DEX */
export interface DexSingleQuote {
  /** DEX name */
  dex: "stonfi" | "dedust";
  /** Expected output amount (string to avoid precision loss) */
  expectedOutput: string;
  /** Minimum output after slippage */
  minOutput: string;
  /** Exchange rate */
  rate: string;
  /** Price impact percentage */
  priceImpact?: string;
  /** Fee amount */
  fee: string;
  /** Pool type (DeDust: "volatile" | "stable") */
  poolType?: string;
}

/** Parameters for DEX swap (extends quote params) */
export interface DexSwapParams extends DexQuoteParams {
  /** Force a specific DEX (omit for auto-selection) */
  dex?: "stonfi" | "dedust";
}

/** Result of a DEX swap execution */
export interface DexSwapResult {
  /** DEX used */
  dex: "stonfi" | "dedust";
  /** Source asset address */
  fromAsset: string;
  /** Destination asset address */
  toAsset: string;
  /** Amount sent */
  amountIn: string;
  /** Expected output */
  expectedOutput: string;
  /** Minimum output after slippage */
  minOutput: string;
  /** Slippage used */
  slippage: string;
}

/** DEX sub-namespace on TonSDK */
export interface DexSDK {
  /** Compare quotes from STON.fi and DeDust, recommend the best */
  quote(params: DexQuoteParams): Promise<DexQuoteResult>;
  /** Get quote from STON.fi only */
  quoteSTONfi(params: DexQuoteParams): Promise<DexSingleQuote | null>;
  /** Get quote from DeDust only */
  quoteDeDust(params: DexQuoteParams): Promise<DexSingleQuote | null>;
  /** Execute swap via recommended DEX (or forced via params.dex) */
  swap(params: DexSwapParams): Promise<DexSwapResult>;
  /** Execute swap on STON.fi */
  swapSTONfi(params: DexSwapParams): Promise<DexSwapResult>;
  /** Execute swap on DeDust */
  swapDeDust(params: DexSwapParams): Promise<DexSwapResult>;
}

// ─── DNS Types ──────────────────────────────────────────────────

/** DNS domain check result */
export interface DnsCheckResult {
  /** Domain name (e.g. "example.ton") */
  domain: string;
  /** Whether the domain is available */
  available: boolean;
  /** Current owner address (if taken) */
  owner?: string;
  /** NFT address of the domain */
  nftAddress?: string;
  /** Linked wallet address */
  walletAddress?: string;
  /** Active auction info */
  auction?: { bids: number; lastBid: string; endTime: number };
}

/** Active DNS auction */
export interface DnsAuction {
  /** Domain name */
  domain: string;
  /** NFT address */
  nftAddress: string;
  /** Current owner/bidder */
  owner: string;
  /** Current highest bid in TON */
  lastBid: string;
  /** Auction end time (unix timestamp) */
  endTime: number;
  /** Number of bids */
  bids: number;
}

/** Result of starting a DNS auction */
export interface DnsAuctionResult {
  /** Domain name */
  domain: string;
  /** Whether auction was started successfully */
  success: boolean;
  /** Initial bid amount in TON */
  bidAmount: string;
}

/** Result of placing a DNS bid */
export interface DnsBidResult {
  /** Domain name */
  domain: string;
  /** Bid amount in TON */
  bidAmount: string;
  /** Whether bid was placed successfully */
  success: boolean;
}

/** DNS domain resolution result */
export interface DnsResolveResult {
  /** Domain name */
  domain: string;
  /** Linked wallet address */
  walletAddress: string | null;
  /** NFT address of the domain */
  nftAddress: string;
  /** Owner address */
  owner: string | null;
  /** Expiration date (unix timestamp) */
  expirationDate?: number;
}

/** DNS sub-namespace on TonSDK */
export interface DnsSDK {
  /** Check domain availability, price, and auction status */
  check(domain: string): Promise<DnsCheckResult>;
  /** Resolve a .ton domain to an address */
  resolve(domain: string): Promise<DnsResolveResult | null>;
  /** List active DNS auctions */
  getAuctions(limit?: number): Promise<DnsAuction[]>;
  /** Start a new auction for an available domain */
  startAuction(domain: string): Promise<DnsAuctionResult>;
  /** Place a bid on an active auction */
  bid(domain: string, amount: number): Promise<DnsBidResult>;
  /** Link a domain to a wallet address */
  link(domain: string, address: string): Promise<void>;
  /** Unlink a domain (clear wallet record) */
  unlink(domain: string): Promise<void>;
  /** Set or update the TON Site (ADNL) record for a .ton domain you own */
  setSiteRecord(domain: string, adnlAddress: string): Promise<void>;
}

// ─── Telegram Extension Types ───────────────────────────────────

/** Dialog/conversation from getDialogs */
export interface Dialog {
  /** Chat ID */
  id: string | null;
  /** Chat title or name */
  title: string;
  /** Chat type */
  type: "dm" | "group" | "channel";
  /** Number of unread messages */
  unreadCount: number;
  /** Number of unread mentions */
  unreadMentionsCount: number;
  /** Whether the chat is pinned */
  isPinned: boolean;
  /** Whether the chat is archived */
  isArchived: boolean;
  /** Last message date (unix timestamp) */
  lastMessageDate: number | null;
  /** Last message preview (truncated) */
  lastMessage: string | null;
}

/** Stars transaction history entry */
export interface StarsTransaction {
  /** Transaction ID */
  id: string;
  /** Amount (positive = received, negative = spent) */
  amount: number;
  /** Transaction date (unix timestamp) */
  date: number;
  /** Peer info */
  peer?: string;
  /** Description */
  description?: string;
}

/** Result of transferring a collectible */
export interface TransferResult {
  /** Message ID of the transferred gift */
  msgId: number;
  /** Recipient identifier */
  transferredTo: string;
  /** Whether transfer cost Stars */
  paidTransfer: boolean;
  /** Stars spent (if paid transfer) */
  starsSpent?: string;
}

/** Fragment collectible information */
export interface CollectibleInfo {
  /** Collectible type */
  type: "username" | "phone";
  /** The username or phone number */
  value: string;
  /** Purchase date (ISO 8601) */
  purchaseDate: string;
  /** Fiat currency */
  currency: string;
  /** Fiat amount */
  amount?: string;
  /** Crypto currency (e.g. "TON") */
  cryptoCurrency?: string;
  /** Crypto amount */
  cryptoAmount?: string;
  /** Fragment URL */
  url?: string;
}

/** Unique NFT gift details */
export interface UniqueGift {
  /** Gift ID */
  id: string;
  /** Collection gift ID */
  giftId: string;
  /** URL slug */
  slug: string;
  /** Gift title */
  title: string;
  /** Number in collection */
  num: number;
  /** Owner info */
  owner: {
    id?: string;
    name?: string;
    address?: string;
    username?: string;
  };
  /** TON address of the gift NFT */
  giftAddress?: string;
  /** NFT attributes */
  attributes: Array<{ type: string; name: string; rarityPercent?: number }>;
  /** Availability info */
  availability?: { total: number; remaining: number };
  /** Link to NFT page */
  nftLink: string;
}

/** Gift value/appraisal info */
export interface GiftValue {
  /** NFT slug */
  slug: string;
  /** Initial sale date (ISO 8601) */
  initialSaleDate?: string;
  /** Initial sale price in Stars */
  initialSaleStars?: string;
  /** Last sale date (ISO 8601) */
  lastSaleDate?: string;
  /** Last sale price */
  lastSalePrice?: string;
  /** Floor price */
  floorPrice?: string;
  /** Average price */
  averagePrice?: string;
  /** Number listed */
  listedCount?: number;
  /** Currency */
  currency?: string;
}

/** Options for sendGiftOffer */
export interface GiftOfferOptions {
  /** Offer validity in seconds (default: 86400 = 24h, min: 21600 = 6h) */
  duration?: number;
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
  /** Blockchain transaction hash used for replay protection */
  txHash?: string;
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

/** A single inline keyboard button */
export interface InlineButton {
  /** Button label text */
  text: string;
  /** Callback data sent when button is pressed */
  callback_data: string;
}

/** Options for sending a message */
export interface SendMessageOptions {
  /** Message ID to reply to */
  replyToId?: number;
  /** Inline keyboard buttons (2D array: rows of buttons) */
  inlineKeyboard?: InlineButton[][];
}

/** Options for editing a message */
export interface EditMessageOptions {
  /** Updated inline keyboard (omit to keep existing) */
  inlineKeyboard?: InlineButton[][];
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

// ─── Telegram Extended Types ────────────────────────────────────

/** Chat/group information returned by getChatInfo */
export interface ChatInfo {
  /** Chat ID as string */
  id: string;
  /** Chat title (or user's first name for private chats) */
  title: string;
  /** Chat type */
  type: "private" | "group" | "supergroup" | "channel";
  /** Number of members (groups/channels only) */
  membersCount?: number;
  /** Chat username without @ (if public) */
  username?: string;
  /** Chat/channel description/bio */
  description?: string;
}

/** Detailed user information returned by getUserInfo */
export interface UserInfo {
  /** Telegram user ID */
  id: number;
  /** First name */
  firstName: string;
  /** Last name */
  lastName?: string;
  /** Username without @ */
  username?: string;
  /** Whether the user is a bot */
  isBot: boolean;
}

/** Resolved peer from username lookup */
export interface ResolvedPeer {
  /** Entity ID */
  id: number;
  /** Entity type */
  type: "user" | "chat" | "channel";
  /** Username if available */
  username?: string;
  /** Title (for groups/channels) or first name (for users) */
  title?: string;
}

/** Options for sending media (photo, video, file, etc.) */
export interface MediaSendOptions {
  /** Media caption text */
  caption?: string;
  /** Message ID to reply to */
  replyToId?: number;
  /** Inline keyboard buttons */
  inlineKeyboard?: InlineButton[][];
  /** Duration in seconds (for video/voice) */
  duration?: number;
  /** Width in pixels (for video) */
  width?: number;
  /** Height in pixels (for video) */
  height?: number;
}

/** Options for creating a poll */
export interface PollOptions {
  /** Whether voters are anonymous (default: true) */
  isAnonymous?: boolean;
  /** Allow multiple answers (default: false) */
  multipleChoice?: boolean;
}

/** Star gift from catalog */
export interface StarGift {
  /** Gift ID */
  id: string;
  /** Cost in Telegram Stars */
  starsAmount: number;
  /** Remaining available (limited gifts) */
  availableAmount?: number;
  /** Total supply (limited gifts) */
  totalAmount?: number;
}

/** Received star gift */
export interface ReceivedGift {
  /** Gift ID */
  id: string;
  /** Sender user ID */
  fromId?: number;
  /** Unix timestamp when received */
  date: number;
  /** Stars value */
  starsAmount: number;
  /** Whether saved to profile */
  saved: boolean;
  /** Associated message ID */
  messageId?: number;
}

/** Context passed to plugin start() hook */
export interface StartContext {
  /** Telegram bridge for advanced operations */
  bridge: unknown;
  /** Plugin's isolated SQLite database (null if unavailable) */
  db: unknown;
  /** Sanitized application config (no API keys) */
  config: Record<string, unknown>;
  /** Plugin-specific config from config.yaml */
  pluginConfig: Record<string, unknown>;
  /** Prefixed logger */
  log: PluginLogger;
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

  // ─── Jettons ───────────────────────────────────────────────

  /**
   * Get jetton (token) balances for an address.
   * Defaults to the bot's own wallet.
   *
   * @param ownerAddress — TON address to query (default: bot wallet)
   * @returns Array of jetton balances, or empty array on error.
   */
  getJettonBalances(ownerAddress?: string): Promise<JettonBalance[]>;

  /**
   * Get jetton metadata (name, symbol, decimals, supply, etc.).
   *
   * @param jettonAddress — Jetton master contract address
   * @returns Jetton info, or null if not found.
   */
  getJettonInfo(jettonAddress: string): Promise<JettonInfo | null>;

  /**
   * Transfer jetton tokens to a recipient.
   *
   * WARNING: Irreversible blockchain transaction.
   *
   * @param jettonAddress — Jetton master contract address
   * @param to — Recipient TON address
   * @param amount — Amount in human-readable units (e.g. 100 for 100 USDT)
   * @param opts — Optional comment for the transfer
   * @throws {PluginSDKError} WALLET_NOT_INITIALIZED, INVALID_ADDRESS, OPERATION_FAILED
   */
  sendJetton(
    jettonAddress: string,
    to: string,
    amount: number,
    opts?: { comment?: string }
  ): Promise<JettonSendResult>;

  /**
   * Get the jetton wallet address for a specific owner and jetton.
   *
   * @param ownerAddress — Owner's TON address
   * @param jettonAddress — Jetton master contract address
   * @returns Jetton wallet address, or null if not found.
   */
  getJettonWalletAddress(ownerAddress: string, jettonAddress: string): Promise<string | null>;

  // ─── NFT ───────────────────────────────────────────────────

  /**
   * Get NFT items owned by an address.
   * Defaults to the bot's own wallet.
   *
   * @param ownerAddress — TON address to query (default: bot wallet)
   * @returns Array of NFT items, or empty array on error.
   */
  getNftItems(ownerAddress?: string): Promise<NftItem[]>;

  /**
   * Get NFT item information by address.
   *
   * @param nftAddress — NFT item contract address
   * @returns NFT info, or null if not found.
   */
  getNftInfo(nftAddress: string): Promise<NftItem | null>;

  // ─── Utilities ─────────────────────────────────────────────

  /**
   * Convert TON amount to nanoTON.
   * @param amount — Amount in TON (e.g. 1.5)
   * @returns Amount in nanoTON as bigint
   */
  toNano(amount: number | string): bigint;

  /**
   * Convert nanoTON to TON.
   * @param nano — Amount in nanoTON
   * @returns Human-readable TON string (e.g. "1.5")
   */
  fromNano(nano: bigint | string): string;

  /**
   * Validate a TON address format.
   * @param address — Address string to validate
   * @returns true if valid TON address
   */
  validateAddress(address: string): boolean;

  // ─── Jetton Analytics ─────────────────────────────────────────

  /**
   * Get current jetton price in USD and TON with change percentages.
   * @param jettonAddress — Jetton master contract address
   * @returns Price data, or null if unavailable.
   */
  getJettonPrice(jettonAddress: string): Promise<JettonPrice | null>;

  /**
   * Get top holders of a jetton.
   * @param jettonAddress — Jetton master contract address
   * @param limit — Max holders (default: 10, max: 100)
   * @returns Array of holders ranked by balance.
   */
  getJettonHolders(jettonAddress: string, limit?: number): Promise<JettonHolder[]>;

  /**
   * Get jetton market analytics: price changes, volume, FDV, holders.
   * @param jettonAddress — Jetton master contract address
   * @returns Market analytics, or null if unavailable.
   */
  getJettonHistory(jettonAddress: string): Promise<JettonHistory | null>;

  // ─── Sub-namespaces ───────────────────────────────────────────

  /** DEX quotes and swaps (STON.fi + DeDust) */
  readonly dex: DexSDK;

  /** DNS domain management (.ton domains) */
  readonly dns: DnsSDK;
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
   * Get the raw GramJS TelegramClient for advanced MTProto operations.
   *
   * Use this when the SDK methods don't cover your use case
   * (e.g., inline bots, voice transcription, WebApp auth).
   *
   * The returned object is a `TelegramClient` from the `telegram` package.
   * Cast it to the appropriate type in your plugin.
   *
   * @returns Raw GramJS client, or null if bridge not connected.
   *
   * @example
   * ```typescript
   * const client = sdk.telegram.getRawClient();
   * if (!client) return { success: false, error: "Not connected" };
   *
   * const { Api } = require("telegram");
   * const results = await client.invoke(
   *   new Api.messages.GetInlineBotResults({ bot: "@pic", query: "cat", peer: chatId })
   * );
   * ```
   */
  getRawClient(): unknown | null;

  // ─── Messages ──────────────────────────────────────────────

  /**
   * Delete a message.
   *
   * @param chatId — Chat ID
   * @param messageId — Message ID to delete
   * @param revoke — Also delete for other users (default: true)
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  deleteMessage(chatId: string, messageId: number, revoke?: boolean): Promise<void>;

  /**
   * Forward a message to another chat.
   *
   * @param fromChatId — Source chat ID
   * @param toChatId — Destination chat ID
   * @param messageId — Message ID to forward
   * @returns Message ID of the forwarded message
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  forwardMessage(fromChatId: string, toChatId: string, messageId: number): Promise<number | null>;

  /**
   * Pin or unpin a message in a chat.
   *
   * @param chatId — Chat ID
   * @param messageId — Message ID to pin/unpin
   * @param opts — Options: silent (no notification), unpin (unpin instead)
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  pinMessage(
    chatId: string,
    messageId: number,
    opts?: { silent?: boolean; unpin?: boolean }
  ): Promise<void>;

  /**
   * Search messages in a chat.
   *
   * @param chatId — Chat ID to search in
   * @param query — Search query string
   * @param limit — Max results (default: 20)
   * @returns Matching messages
   */
  searchMessages(chatId: string, query: string, limit?: number): Promise<SimpleMessage[]>;

  /**
   * Schedule a message for later delivery.
   *
   * @param chatId — Chat ID
   * @param text — Message text
   * @param scheduleDate — Unix timestamp for delivery
   * @returns Scheduled message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  scheduleMessage(chatId: string, text: string, scheduleDate: number): Promise<number | null>;

  /**
   * Get replies to a specific message (thread).
   *
   * @param chatId — Chat ID
   * @param messageId — Parent message ID
   * @param limit — Max replies (default: 50)
   * @returns Reply messages
   */
  getReplies(chatId: string, messageId: number, limit?: number): Promise<SimpleMessage[]>;

  // ─── Media ─────────────────────────────────────────────────

  /**
   * Send a photo.
   *
   * @param chatId — Chat ID
   * @param photo — File path or Buffer
   * @param opts — Caption, reply, keyboard options
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendPhoto(chatId: string, photo: string | Buffer, opts?: MediaSendOptions): Promise<number>;

  /**
   * Send a video.
   *
   * @param chatId — Chat ID
   * @param video — File path or Buffer
   * @param opts — Caption, reply, keyboard options
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendVideo(chatId: string, video: string | Buffer, opts?: MediaSendOptions): Promise<number>;

  /**
   * Send a voice message.
   *
   * @param chatId — Chat ID
   * @param voice — File path or Buffer (OGG/Opus format)
   * @param opts — Caption, reply, keyboard options
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendVoice(chatId: string, voice: string | Buffer, opts?: MediaSendOptions): Promise<number>;

  /**
   * Send a file/document.
   *
   * @param chatId — Chat ID
   * @param file — File path or Buffer
   * @param opts — Caption, reply, keyboard, fileName options
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendFile(
    chatId: string,
    file: string | Buffer,
    opts?: MediaSendOptions & { fileName?: string }
  ): Promise<number>;

  /**
   * Send an animated GIF.
   *
   * @param chatId — Chat ID
   * @param gif — File path or Buffer
   * @param opts — Caption, reply, keyboard options
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendGif(chatId: string, gif: string | Buffer, opts?: MediaSendOptions): Promise<number>;

  /**
   * Send a sticker.
   *
   * @param chatId — Chat ID
   * @param sticker — File path or Buffer (WEBP format)
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendSticker(chatId: string, sticker: string | Buffer): Promise<number>;

  /**
   * Download media from a message.
   *
   * @param chatId — Chat ID
   * @param messageId — Message ID containing media
   * @returns Media as Buffer, or null if no media found
   */
  downloadMedia(chatId: string, messageId: number): Promise<Buffer | null>;

  // ─── Chat & Users ──────────────────────────────────────────

  /**
   * Get chat/group/channel information.
   *
   * @param chatId — Chat ID
   * @returns Chat info, or null if not found
   */
  getChatInfo(chatId: string): Promise<ChatInfo | null>;

  /**
   * Get user information.
   *
   * @param userId — User ID or username
   * @returns User info, or null if not found
   */
  getUserInfo(userId: number | string): Promise<UserInfo | null>;

  /**
   * Resolve a @username to a peer entity.
   *
   * @param username — Username without @
   * @returns Resolved peer info, or null if not found
   */
  resolveUsername(username: string): Promise<ResolvedPeer | null>;

  /**
   * Get participants of a group/channel.
   *
   * @param chatId — Chat ID (must be a group or channel)
   * @param limit — Max participants (default: 100)
   * @returns Array of user info
   */
  getParticipants(chatId: string, limit?: number): Promise<UserInfo[]>;

  // ─── Interactive ───────────────────────────────────────────

  /**
   * Create a poll in a chat.
   *
   * @param chatId — Chat ID
   * @param question — Poll question
   * @param answers — Answer options (2-10)
   * @param opts — Anonymous, multiple choice options
   * @returns Message ID of the poll
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  createPoll(
    chatId: string,
    question: string,
    answers: string[],
    opts?: PollOptions
  ): Promise<number | null>;

  /**
   * Create a quiz (poll with correct answer) in a chat.
   *
   * @param chatId — Chat ID
   * @param question — Quiz question
   * @param answers — Answer options
   * @param correctIndex — Index of the correct answer (0-based)
   * @param explanation — Explanation shown after answering
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  createQuiz(
    chatId: string,
    question: string,
    answers: string[],
    correctIndex: number,
    explanation?: string
  ): Promise<number | null>;

  // ─── Moderation ────────────────────────────────────────────

  /**
   * Ban a user from a group/channel.
   *
   * @param chatId — Group/channel ID
   * @param userId — User ID to ban
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  banUser(chatId: string, userId: number | string): Promise<void>;

  /**
   * Unban a user from a group/channel.
   *
   * @param chatId — Group/channel ID
   * @param userId — User ID to unban
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  unbanUser(chatId: string, userId: number | string): Promise<void>;

  /**
   * Mute a user in a group (restrict sending messages).
   *
   * @param chatId — Group/channel ID
   * @param userId — User ID to mute
   * @param untilDate — Unix timestamp when mute expires (0 = forever)
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  muteUser(chatId: string, userId: number | string, untilDate: number): Promise<void>;

  // ─── Stars & Gifts ─────────────────────────────────────────

  /**
   * Get current Telegram Stars balance.
   *
   * @returns Stars balance
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  getStarsBalance(): Promise<number>;

  /**
   * Send a star gift to a user.
   *
   * @param userId — Recipient user ID
   * @param giftId — Gift ID from catalog
   * @param opts — Optional message and anonymity
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendGift(
    userId: number | string,
    giftId: string,
    opts?: { message?: string; anonymous?: boolean }
  ): Promise<void>;

  /**
   * Get available star gifts catalog.
   *
   * @returns Array of available gifts
   */
  getAvailableGifts(): Promise<StarGift[]>;

  /**
   * Get star gifts received by the bot.
   *
   * @param limit — Max gifts to return (default: 50)
   * @returns Array of received gifts
   */
  getMyGifts(limit?: number): Promise<ReceivedGift[]>;

  /**
   * Get star gifts available for resale from a specific collection.
   *
   * @param giftId — Collection ID (numeric string from getAvailableGifts)
   * @param limit — Max results (default: 50)
   * @returns Array of resale gift listings
   */
  getResaleGifts(giftId: string, limit?: number): Promise<StarGift[]>;

  /**
   * Buy a star gift from resale market.
   *
   * @param giftId — Gift ID to purchase
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  buyResaleGift(giftId: string): Promise<void>;

  /**
   * Post a story to the bot's profile.
   *
   * @param mediaPath — Path to photo/video file
   * @param opts — Caption options
   * @returns Story ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendStory(mediaPath: string, opts?: { caption?: string }): Promise<number | null>;

  // ─── Advanced ──────────────────────────────────────────────

  /**
   * Show "typing..." indicator in a chat.
   *
   * @param chatId — Chat ID
   */
  setTyping(chatId: string): Promise<void>;

  // ─── Scheduled Messages ───────────────────────────────────

  /**
   * Get scheduled messages in a chat.
   * @param chatId — Chat ID
   * @returns Array of scheduled messages
   */
  getScheduledMessages(chatId: string): Promise<SimpleMessage[]>;

  /**
   * Delete a scheduled message.
   * @param chatId — Chat ID
   * @param messageId — Scheduled message ID
   */
  deleteScheduledMessage(chatId: string, messageId: number): Promise<void>;

  /**
   * Send a scheduled message immediately.
   * @param chatId — Chat ID
   * @param messageId — Scheduled message ID
   */
  sendScheduledNow(chatId: string, messageId: number): Promise<void>;

  // ─── Chat ─────────────────────────────────────────────────

  /**
   * Get all dialogs (conversations).
   * @param limit — Max dialogs (default: 50, max: 100)
   * @returns Array of dialog info
   */
  getDialogs(limit?: number): Promise<Dialog[]>;

  /**
   * Get message history from a chat.
   * @param chatId — Chat ID or @username
   * @param limit — Max messages (default: 50, max: 100)
   * @returns Array of messages
   */
  getHistory(chatId: string, limit?: number): Promise<SimpleMessage[]>;

  // ─── Extended Moderation ──────────────────────────────────

  /**
   * Kick a user from a group (ban + immediate unban).
   * @param chatId — Group/channel ID
   * @param userId — User ID to kick
   */
  kickUser(chatId: string, userId: number | string): Promise<void>;

  // ─── Extended Stars & Gifts ───────────────────────────────

  /**
   * Get Stars transaction history.
   * @param limit — Max transactions (default: 50)
   * @returns Array of transactions
   */
  getStarsTransactions(limit?: number): Promise<StarsTransaction[]>;

  /**
   * Transfer a collectible gift to another user.
   * @param msgId — Message ID of the gift (from getMyGifts)
   * @param toUserId — Recipient user ID or @username
   * @returns Transfer result
   */
  transferCollectible(msgId: number, toUserId: number | string): Promise<TransferResult>;

  /**
   * Set or remove the resale price of a collectible.
   * @param msgId — Message ID of the collectible
   * @param price — Price in Stars (0 to unlist)
   */
  setCollectiblePrice(msgId: number, price: number): Promise<void>;

  /**
   * Get info about a Fragment collectible (username or phone).
   * @param slug — Username (without @) or phone number
   * @returns Collectible info, or null if not found
   */
  getCollectibleInfo(slug: string): Promise<CollectibleInfo | null>;

  /**
   * Look up a unique NFT gift by its slug.
   * @param slug — NFT slug from t.me/nft/<slug>
   * @returns Unique gift info, or null if not found
   */
  getUniqueGift(slug: string): Promise<UniqueGift | null>;

  /**
   * Get the market value of a unique NFT gift.
   * @param slug — NFT slug
   * @returns Gift value info, or null if not found
   */
  getUniqueGiftValue(slug: string): Promise<GiftValue | null>;

  /**
   * Send a buy offer on a unique NFT gift to its owner.
   * @param userId — Owner's user ID or @username
   * @param giftMsgId — Slug of the NFT gift
   * @param price — Offer price in Stars
   * @param opts — Duration options
   */
  sendGiftOffer(
    userId: number | string,
    giftSlug: string,
    price: number,
    opts?: GiftOfferOptions
  ): Promise<void>;
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

// ─── Secrets Types ──────────────────────────────────────────────

/** Manifest secret declaration */
export interface SecretDeclaration {
  /** Whether this secret is required for the plugin to function */
  required: boolean;
  /** Human-readable description shown when prompting admin */
  description: string;
  /** Environment variable name (e.g. "SWIFTGIFTS_API_KEY") */
  env?: string;
}

/**
 * Secure access to plugin secrets (API keys, tokens, credentials).
 *
 * Resolution order:
 * 1. Environment variable (PLUGINNAME_KEY)
 * 2. Secrets store (set via /plugin set command)
 * 3. pluginConfig from config.yaml
 *
 * @example
 * ```typescript
 * const apiKey = sdk.secrets.get("api_key");
 * if (!apiKey) {
 *   return { success: false, error: "API key not configured" };
 * }
 * ```
 */
export interface SecretsSDK {
  /**
   * Get a secret value by key.
   *
   * @param key — Secret key name (e.g. "api_key", "bearer_token")
   * @returns Secret value, or undefined if not configured.
   */
  get(key: string): string | undefined;

  /**
   * Get a secret value, throwing if not found.
   *
   * @param key — Secret key name
   * @throws {PluginSDKError} SECRET_NOT_FOUND
   */
  require(key: string): string;

  /**
   * Check if a secret is configured.
   *
   * @param key — Secret key name
   */
  has(key: string): boolean;
}

// ─── Storage Types ──────────────────────────────────────────────

/**
 * Simple key-value storage for plugins.
 *
 * Alternative to raw SQL for simple persistence needs.
 * Uses an auto-created `_kv` table in the plugin's isolated DB.
 * No `migrate()` export required — table is created automatically.
 *
 * Values are JSON-serialized. Optional TTL for auto-expiration.
 *
 * @example
 * ```typescript
 * // Simple counter
 * const count = sdk.storage.get<number>("visits") ?? 0;
 * sdk.storage.set("visits", count + 1);
 *
 * // Cache with 5-minute TTL
 * sdk.storage.set("api_result", data, { ttl: 300_000 });
 * ```
 */
export interface StorageSDK {
  /** Get a value by key. Returns undefined if not found or expired. */
  get<T>(key: string): T | undefined;
  /** Set a value. Optional TTL in milliseconds for auto-expiration. */
  set<T>(key: string, value: T, opts?: { ttl?: number }): void;
  /** Delete a key. Returns true if the key existed. */
  delete(key: string): boolean;
  /** Check if a key exists (and is not expired). */
  has(key: string): boolean;
  /** Delete all keys in this plugin's storage. */
  clear(): void;
}

// ─── Plugin Event Types ─────────────────────────────────────────

/** Event passed to plugin onMessage hooks */
export interface PluginMessageEvent {
  /** Telegram chat ID */
  chatId: string;
  /** Telegram user ID of the sender */
  senderId: number;
  /** Sender's @username (without @) */
  senderUsername?: string;
  /** Message text */
  text: string;
  /** Whether this is a group chat */
  isGroup: boolean;
  /** Whether the message contains media */
  hasMedia: boolean;
  /** Message ID */
  messageId: number;
  /** Message timestamp */
  timestamp: Date;
}

/** Event passed to plugin onCallbackQuery hooks */
export interface PluginCallbackEvent {
  /** Raw callback data string */
  data: string;
  /** First segment of data split by ":" */
  action: string;
  /** Remaining segments after action */
  params: string[];
  /** Chat ID where the button was pressed */
  chatId: string;
  /** Message ID the button belongs to */
  messageId: number;
  /** User ID who pressed the button */
  userId: number;
  /** Answer the callback query (shows toast or alert to user) */
  answer: (text?: string, alert?: boolean) => Promise<void>;
}

// ─── Plugin Definition Types ────────────────────────────────────

/** Tool visibility scope for context-based filtering */
export type ToolScope = "always" | "dm-only" | "group-only" | "admin-only";

/** Tool category for observation masking behavior */
export type ToolCategory = "data-bearing" | "action";

/**
 * Context passed to plugin tool executors at runtime.
 * Contains information about the current chat, sender, and services.
 */
export interface PluginToolContext {
  /** Telegram chat ID where the tool was invoked */
  chatId: string;
  /** Telegram user ID of the sender */
  senderId: number;
  /** Whether this is a group chat (vs DM) */
  isGroup: boolean;
  /** TelegramBridge instance for Telegram operations */
  bridge: unknown;
  /** Plugin's isolated SQLite database */
  db: unknown;
  /** Sanitized bot config (no API keys) */
  config?: Record<string, unknown>;
}

/** Result returned by a tool execution */
export interface ToolResult {
  /** Whether the execution was successful */
  success: boolean;
  /** Result data (serialized to JSON for the LLM) */
  data?: unknown;
  /** Error message if failed */
  error?: string;
}

/**
 * Simplified tool definition for plugins.
 *
 * This is the format plugins use to define their tools.
 * The core platform converts these into full Tool definitions.
 */
export interface SimpleToolDef {
  /** Unique tool name (e.g. "casino_spin") */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema for parameters (defaults to empty object) */
  parameters?: Record<string, unknown>;
  /** Tool executor function */
  execute: (params: Record<string, unknown>, context: PluginToolContext) => Promise<ToolResult>;
  /** Visibility scope (default: "always") */
  scope?: ToolScope;
  /** Tool category for masking behavior */
  category?: ToolCategory;
}

/**
 * Plugin manifest — optional metadata for plugin registration.
 *
 * Declares the plugin's identity, version, dependencies, and default config.
 */
export interface PluginManifest {
  /** Plugin name (lowercase alphanumeric + hyphens, 1-64 chars) */
  name: string;
  /** Semver version string (e.g. "1.0.0") */
  version: string;
  /** Plugin author */
  author?: string;
  /** Short description (max 256 chars) */
  description?: string;
  /** Required built-in modules (e.g. ["deals", "market"]) */
  dependencies?: string[];
  /** Default plugin config (merged with config.yaml plugins section) */
  defaultConfig?: Record<string, unknown>;
  /** Required SDK version range (e.g. ">=1.0.0", "^1.0.0") */
  sdkVersion?: string;
  /**
   * Secrets required by this plugin (API keys, tokens, etc.)
   *
   * When declared, the agent warns admin via Telegram if secrets are missing.
   * Admin can set them with: /plugin set <plugin-name> <key> <value>
   *
   * @example
   * ```typescript
   * secrets: {
   *   api_key: { required: true, description: "SwiftGifts API key" },
   *   webhook_url: { required: false, description: "Webhook for notifications" },
   * }
   * ```
   */
  secrets?: Record<string, SecretDeclaration>;
}

// ─── Root SDK ────────────────────────────────────────────────────

/**
 * The complete Plugin SDK passed to plugins via `tools(sdk)`.
 *
 * Provides namespaced access to TON blockchain, Telegram messaging,
 * and plugin infrastructure (DB, config, logging).
 *
 * @example
 * ```typescript
 * import type { PluginSDK, SimpleToolDef } from "@teleton-agent/sdk";
 *
 * export const tools = (sdk: PluginSDK): SimpleToolDef[] => [{
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

  /** Secure access to plugin secrets (API keys, tokens) */
  readonly secrets: SecretsSDK;

  /** Simple key-value storage (null if no DB — use migrate() or storage auto-creates _kv table) */
  readonly storage: StorageSDK | null;

  /** Prefixed logger */
  readonly log: PluginLogger;
}
