import { mnemonicNew, mnemonicToPrivateKey, mnemonicValidate } from "@ton/crypto";
import { WalletContractV5R1, TonClient, fromNano } from "@ton/ton";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getCachedHttpEndpoint, invalidateEndpointCache } from "./endpoint.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { tonapiFetch, COINGECKO_API_URL } from "../constants/api-endpoints.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("TON");

const WALLET_FILE = join(TELETON_ROOT, "wallet.json");

// ─── Singleton Caches ────────────────────────────────────────────────
/** Cached wallet data (invalidated on saveWallet) */
let _walletCache: WalletData | null | undefined; // undefined = not yet loaded

/** Cached key pair derived from mnemonic */
let _keyPairCache: { publicKey: Buffer; secretKey: Buffer } | null = null;

/** Cached TonClient — invalidated when endpoint rotates */
let _tonClientCache: { client: TonClient; endpoint: string } | null = null;

export interface WalletData {
  version: "w5r1";
  address: string;
  publicKey: string;
  mnemonic: string[];
  createdAt: string;
}

/**
 * Generate a new TON wallet (W5R1)
 */
export async function generateWallet(): Promise<WalletData> {
  // Generate new mnemonic (24 words)
  const mnemonic = await mnemonicNew(24);

  // Derive keys from mnemonic
  const keyPair = await mnemonicToPrivateKey(mnemonic);

  // Create W5R1 wallet contract
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  const address = wallet.address.toString({ bounceable: true, testOnly: false });

  return {
    version: "w5r1",
    address,
    publicKey: keyPair.publicKey.toString("hex"),
    mnemonic,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Save wallet to ~/.teleton/wallet.json
 */
export function saveWallet(wallet: WalletData): void {
  const dir = dirname(WALLET_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2), { encoding: "utf-8", mode: 0o600 });

  // Invalidate caches so next loadWallet()/getKeyPair() re-reads
  _walletCache = undefined;
  _keyPairCache = null;
}

/**
 * Load wallet from ~/.teleton/wallet.json (cached after first read)
 */
export function loadWallet(): WalletData | null {
  if (_walletCache !== undefined) return _walletCache;

  if (!existsSync(WALLET_FILE)) {
    _walletCache = null;
    return null;
  }

  try {
    const content = readFileSync(WALLET_FILE, "utf-8");
    const parsed = JSON.parse(content);
    if (!parsed.mnemonic || !Array.isArray(parsed.mnemonic) || parsed.mnemonic.length !== 24) {
      throw new Error("Invalid wallet.json: mnemonic must be a 24-word array");
    }
    _walletCache = parsed as WalletData;
    return _walletCache;
  } catch (error) {
    log.error({ err: error }, "Failed to load wallet");
    _walletCache = null;
    return null;
  }
}

/**
 * Check if wallet exists
 */
export function walletExists(): boolean {
  return existsSync(WALLET_FILE);
}

/**
 * Import a wallet from an existing 24-word mnemonic
 */
export async function importWallet(mnemonic: string[]): Promise<WalletData> {
  const valid = await mnemonicValidate(mnemonic);
  if (!valid) {
    throw new Error("Invalid mnemonic: words do not form a valid TON seed phrase");
  }

  const keyPair = await mnemonicToPrivateKey(mnemonic);

  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  const address = wallet.address.toString({ bounceable: true, testOnly: false });

  return {
    version: "w5r1",
    address,
    publicKey: keyPair.publicKey.toString("hex"),
    mnemonic,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Get wallet address
 */
export function getWalletAddress(): string | null {
  const wallet = loadWallet();
  return wallet?.address || null;
}

/**
 * Get (or create) a cached TonClient.
 * Re-creates only when the endpoint URL rotates (60s TTL on endpoint).
 */
export async function getCachedTonClient(): Promise<TonClient> {
  const endpoint = await getCachedHttpEndpoint();
  if (_tonClientCache && _tonClientCache.endpoint === endpoint) {
    return _tonClientCache.client;
  }
  const client = new TonClient({ endpoint });
  _tonClientCache = { client, endpoint };
  return client;
}

/**
 * Invalidate the TonClient cache and the endpoint cache.
 * Call this when a node returns a 5xx error so the next call picks a fresh node.
 */
export function invalidateTonClientCache(): void {
  _tonClientCache = null;
  invalidateEndpointCache();
}

/**
 * Get cached KeyPair (derives from mnemonic once, then reuses).
 * Returns null if no wallet is configured.
 */
export async function getKeyPair(): Promise<{ publicKey: Buffer; secretKey: Buffer } | null> {
  if (_keyPairCache) return _keyPairCache;

  const wallet = loadWallet();
  if (!wallet) return null;

  _keyPairCache = await mnemonicToPrivateKey(wallet.mnemonic);
  return _keyPairCache;
}

/**
 * Get wallet balance from TON Center API
 */
export async function getWalletBalance(address: string): Promise<{
  balance: string;
  balanceNano: string;
} | null> {
  try {
    const client = await getCachedTonClient();

    // Import Address from @ton/core
    const { Address } = await import("@ton/core");
    const addressObj = Address.parse(address);

    // Get balance
    const balance = await client.getBalance(addressObj);
    const balanceFormatted = fromNano(balance);

    return {
      balance: balanceFormatted,
      balanceNano: balance.toString(),
    };
  } catch (error) {
    log.error({ err: error }, "Failed to get balance");
    return null;
  }
}

/** Cached TON price (30s TTL) */
const TON_PRICE_CACHE_TTL_MS = 30_000;
let _tonPriceCache: { usd: number; source: string; timestamp: number } | null = null;

/**
 * Get TON/USD price from TonAPI (primary) with CoinGecko fallback
 * Results cached for 30s to reduce API calls
 */
export async function getTonPrice(): Promise<{
  usd: number;
  source: string;
  timestamp: number;
} | null> {
  // Return cached value if fresh
  if (_tonPriceCache && Date.now() - _tonPriceCache.timestamp < TON_PRICE_CACHE_TTL_MS) {
    return { ..._tonPriceCache };
  }

  // Primary: TonAPI /v2/rates (uses configured API key if available)
  try {
    const response = await tonapiFetch(`/rates?tokens=ton&currencies=usd`);

    if (response.ok) {
      const data = await response.json();
      const price = data?.rates?.TON?.prices?.USD;
      if (typeof price === "number" && price > 0) {
        _tonPriceCache = { usd: price, source: "TonAPI", timestamp: Date.now() };
        return _tonPriceCache;
      }
    }
  } catch {
    // Fall through to CoinGecko
  }

  // Fallback: CoinGecko
  try {
    const response = await fetchWithTimeout(
      `${COINGECKO_API_URL}/simple/price?ids=the-open-network&vs_currencies=usd`
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    const price = data["the-open-network"]?.usd;
    if (typeof price === "number" && price > 0) {
      _tonPriceCache = { usd: price, source: "CoinGecko", timestamp: Date.now() };
      return _tonPriceCache;
    }
  } catch (error) {
    log.error({ err: error }, "Failed to get TON price");
  }

  return null;
}
