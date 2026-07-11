import type { Cell, TupleItem, Address } from "@ton/core";

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
  /** On-chain transaction hash (hex), verifiable on TON explorers */
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
  /** On-chain transaction hash (hex), verifiable on TON explorers */
  txRef?: string;
}

/**
 * Signed transfer ready for off-chain transmission (e.g. x402 payment).
 * Contains the signed BOC and wallet identity metadata.
 */
export interface SignedTransfer {
  /** Base64-encoded signed external message BOC */
  signedBoc: string;
  /** Hex-encoded ed25519 public key */
  walletPublicKey: string;
  /** Raw wallet address (0:hex format) */
  walletAddress: string;
  /** Wallet sequence number used in this transfer */
  seqno: number;
  /** Unix timestamp when this transfer expires */
  validUntil: number;

  // Backward compatibility aliases (deprecated)
  /** @deprecated Use signedBoc */
  boc: string;
  /** @deprecated Use walletPublicKey */
  publicKey: string;
  /** @deprecated V5R1 only — no v2 equivalent needed */
  walletVersion: string;
}

/** Single message for sdk.ton.send() / sdk.ton.sendMessages() */
export interface TonMessage {
  to: string;
  value: number;
  body?: Cell | string;
  bounce?: boolean;
  stateInit?: { code: Cell; data: Cell };
}

/** Options for send/sendMessages */
export interface TonSendOptions {
  sendMode?: number;
}

/** Result of low-level send/sendMessages */
export interface TonTransferResult {
  hash: string;
  seqno: number;
}

/** Core-managed Highload Wallet v3 state. */
export interface HighloadWalletInfo {
  address: string;
  rawAddress: string;
  balance: string;
  balanceNano: string;
  deployed: boolean;
  currentQueryId: number;
  hasNext: boolean;
  timeout?: number;
  lastCleaned?: number;
  subwalletId?: number;
}

/** Result of a Highload Wallet v3 batch submission. */
export interface HighloadBatchResult {
  address: string;
  /** Query ID submitted on-chain. */
  queryId: number;
  /** Persisted query ID reserved for the next batch. */
  nextQueryId: number;
  recipientCount: number;
}

/** Highload Wallet v3 operations with signing and query IDs owned by Teleton core. */
export interface HighloadSDK {
  getInfo(): Promise<HighloadWalletInfo>;
  fund(amount: number): Promise<TonTransferResult>;
  sendMessages(
    messages: TonMessage[],
    opts?: { valuePerBatch?: number }
  ): Promise<HighloadBatchResult>;
}

/** Result of runGetMethod */
export interface GetMethodResult {
  exitCode: number;
  stack: TupleItem[];
}

/** Sender adapter compatible with @ton/ton Sender interface */
export interface TonSender {
  address: Address;
  send(args: {
    to: Address;
    value: bigint;
    body?: Cell;
    bounce?: boolean;
    init?: { code?: Cell | null; data?: Cell | null } | null;
    sendMode?: number;
  }): Promise<void>;
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
  /** On-chain transaction hash (hex), verifiable on TON explorers */
  txRef?: string;
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

  // ─── Signed Transfers (no broadcast) ────────────────────────

  /**
   * Create a signed TON transfer without broadcasting it.
   *
   * Returns a signed BOC that can be transmitted off-chain (e.g. as an
   * x402 `X-PAYMENT` header). The server or recipient broadcasts the BOC.
   *
   * WARNING: The BOC becomes invalid if any other transaction is sent from
   * this wallet before the BOC is broadcast (seqno collision).
   *
   * @param to — Recipient TON address
   * @param amount — Amount in TON (e.g. 0.05)
   * @param comment — Optional transaction comment/memo
   * @throws {PluginSDKError} WALLET_NOT_INITIALIZED, INVALID_ADDRESS, OPERATION_FAILED
   */
  createTransfer(to: string, amount: number, comment?: string): Promise<SignedTransfer>;

  /**
   * Create a signed jetton transfer without broadcasting it.
   *
   * Returns a signed BOC encoding a TEP-74 jetton transfer message.
   *
   * WARNING: Same seqno caveat as createTransfer.
   *
   * @param jettonAddress — Jetton master contract address
   * @param to — Recipient TON address
   * @param amount — Amount in human-readable units (e.g. 100 for 100 USDT)
   * @param opts — Optional comment for the transfer
   * @throws {PluginSDKError} WALLET_NOT_INITIALIZED, INVALID_ADDRESS, OPERATION_FAILED
   */
  createJettonTransfer(
    jettonAddress: string,
    to: string,
    amount: number,
    opts?: { comment?: string }
  ): Promise<SignedTransfer>;

  /**
   * Get the wallet's public key.
   * @returns Hex-encoded ed25519 public key, or null if wallet not initialized.
   */
  getPublicKey(): string | null;

  /**
   * Get the wallet contract version.
   * @returns Wallet version string (e.g. "v5r1").
   */
  getWalletVersion(): string;

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

  // ─── Low-level Transfer ─────────────────────────────────────────

  /**
   * Send TON to a single address with full control over message parameters.
   *
   * WARNING: Irreversible blockchain transaction.
   *
   * @param to — Recipient TON address
   * @param value — Amount in TON (e.g. 1.5)
   * @param opts — Optional body, bounce, stateInit, sendMode
   * @throws {PluginSDKError} WALLET_NOT_INITIALIZED, INVALID_ADDRESS, OPERATION_FAILED
   */
  send(
    to: string,
    value: number,
    opts?: {
      body?: Cell | string;
      bounce?: boolean;
      stateInit?: { code: Cell; data: Cell };
      sendMode?: number;
    }
  ): Promise<TonTransferResult>;

  /**
   * Send multiple messages in a single wallet transfer.
   *
   * WARNING: Irreversible blockchain transaction. Max 255 messages per transfer.
   *
   * @param messages — Array of messages to send
   * @param opts — Optional sendMode override
   * @throws {PluginSDKError} WALLET_NOT_INITIALIZED, INVALID_ADDRESS, OPERATION_FAILED
   */
  sendMessages(messages: TonMessage[], opts?: TonSendOptions): Promise<TonTransferResult>;

  /**
   * Run a get method on a smart contract.
   *
   * @param address — Smart contract address
   * @param method — Method name (e.g. "get_wallet_data")
   * @param stack — Optional input stack (TupleItem[])
   * @returns Exit code and result stack
   * @throws {PluginSDKError} INVALID_ADDRESS, OPERATION_FAILED
   */
  runGetMethod(address: string, method: string, stack?: TupleItem[]): Promise<GetMethodResult>;

  /**
   * Create a Sender adapter compatible with @ton/ton contracts.
   *
   * Useful for interacting with smart contract wrappers that expect a Sender.
   *
   * @throws {PluginSDKError} WALLET_NOT_INITIALIZED, OPERATION_FAILED
   */
  createSender(): Promise<TonSender>;

  /**
   * Get the current wallet sequence number (seqno).
   *
   * @returns Current seqno
   * @throws {PluginSDKError} WALLET_NOT_INITIALIZED, OPERATION_FAILED
   */
  getSeqno(): Promise<number>;

  // ─── Sub-namespaces ───────────────────────────────────────────

  /** DEX quotes and swaps (STON.fi + DeDust) */
  readonly dex: DexSDK;

  /** DNS domain management (.ton domains) */
  readonly dns: DnsSDK;

  /** Highload Wallet v3 batch transfers */
  readonly highload: HighloadSDK;
}
