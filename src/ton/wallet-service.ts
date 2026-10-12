import { mnemonicNew, mnemonicToPrivateKey, mnemonicValidate, keyPairFromSeed } from "@ton/crypto";
import { WalletContractV5R1, TonClient, fromNano } from "@ton/ton";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, constants } from "fs";
import { join, dirname } from "path";
import { getCachedHttpEndpoint, invalidateEndpointCache, getToncenterApiKey } from "./endpoint.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { tonapiFetch, COINGECKO_API_URL } from "../constants/api-endpoints.js";
import { createLogger } from "../utils/logger.js";

import { Address } from "@ton/core";
import {
  NativeTelegramWallet,
  deriveTelegramWalletKeys,
  generateTelegramWalletMnemonic,
} from "../telegram/wallet-protocol.js";

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
  version: "w5r1" | "tg";
  anchorPublicKey?: string;
  walletId?: number;
  keySource?: "telegram-wallet";
  telegramAssociation?: "pending" | "linked";
  anchorSeed?: string;
  signingSeed?: string;
  address: string;
  publicKey: string;
  mnemonic: string[];
  createdAt: string;
}

async function deriveWalletData(mnemonic: string[]): Promise<WalletData> {
  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  return {
    version: "w5r1",
    address: wallet.address.toString({ bounceable: true, testOnly: false }),
    publicKey: keyPair.publicKey.toString("hex"),
    mnemonic,
    createdAt: new Date().toISOString(),
  };
}

export async function generateWallet(version: WalletData["version"] = "tg"): Promise<WalletData> {
  if (version === "w5r1") return deriveWalletData(await mnemonicNew(24));
  return {
    ...deriveNativeWalletData(generateTelegramWalletMnemonic()),
    telegramAssociation: "pending",
  };
}
function deriveNativeWalletData(mnemonic: string[]): WalletData {
  const phrase = Buffer.from(mnemonic.join(" "));
  const seeds = deriveTelegramWalletKeys(phrase);
  const anchor = keyPairFromSeed(seeds.anchorSeed);
  const signing = keyPairFromSeed(seeds.signingSeed);
  try {
    const wallet = new NativeTelegramWallet(anchor.publicKey);
    return {
      version: "tg",
      address: wallet.address.toString({ bounceable: false }),
      publicKey: signing.publicKey.toString("hex"),
      anchorPublicKey: anchor.publicKey.toString("hex"),
      walletId: wallet.walletId,
      mnemonic,
      createdAt: new Date().toISOString(),
    };
  } finally {
    phrase.fill(0);
    seeds.anchorSeed.fill(0);
    seeds.signingSeed.fill(0);
    anchor.secretKey.fill(0);
    signing.secretKey.fill(0);
  }
}

/**
 * Save wallet to ~/.teleton/wallet.json
 */
export function saveWallet(wallet: WalletData): void {
  const dir = dirname(WALLET_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(WALLET_FILE)) {
    const previous = JSON.parse(readFileSync(WALLET_FILE, "utf8"));
    const preserved = join(TELETON_ROOT, "wallet-highload-legacy.json");
    if (
      previous.version === "w5r1" &&
      previous.publicKey !== wallet.publicKey &&
      !existsSync(preserved)
    )
      copyFileSync(WALLET_FILE, preserved, constants.COPYFILE_EXCL);
  }
  writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2), { encoding: "utf-8", mode: 0o600 });

  clearTelegramWalletVerification();

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
    if (
      parsed.version !== "tg" &&
      (!Array.isArray(parsed.mnemonic) || parsed.mnemonic.length !== 24)
    ) {
      throw new Error("Invalid wallet.json: mnemonic must be a 24-word array");
    }
    if (parsed.version !== "tg" && parsed.version !== "w5r1")
      throw new Error("Unsupported wallet version");
    if (
      parsed.version === "tg" &&
      !parsed.keySource &&
      !parsed.signingSeed &&
      ![12, 24].includes(parsed.mnemonic?.length)
    )
      throw new Error("Invalid native wallet key source");
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
export async function importWallet(
  mnemonic: string[],
  version: WalletData["version"] = "w5r1"
): Promise<WalletData> {
  if (version === "tg") {
    const wallet = deriveNativeWalletData(mnemonic);
    return walletExists() ? wallet : { ...wallet, telegramAssociation: "pending" };
  }
  const valid = await mnemonicValidate(mnemonic);
  if (!valid) {
    throw new Error("Invalid mnemonic: words do not form a valid TON seed phrase");
  }

  return deriveWalletData(mnemonic);
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
  const apiKey = getToncenterApiKey();
  const client = new TonClient({ endpoint, ...(apiKey && { apiKey }) });
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
  const wallet = loadWallet();
  if (_keyPairCache && wallet?.version !== "tg") return _keyPairCache;
  if (!wallet) return null;

  if (wallet.version === "tg") {
    const native = getNativeWalletKeys(wallet);
    try {
      _keyPairCache = keyPairFromSeed(native.signingSeed);
    } finally {
      native.anchorSeed.fill(0);
      native.signingSeed.fill(0);
    }
  } else _keyPairCache = await mnemonicToPrivateKey(wallet.mnemonic);
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

function getNativeWalletKeys(wallet: WalletData) {
  if (wallet.keySource === "telegram-wallet") {
    const path = join(TELETON_ROOT, "telegram-wallet.json");
    const cached = JSON.parse(readFileSync(path, "utf8"));
    if (cached.scheme !== "telegram-rotation") throw new Error("Invalid native signer cache");
    return validateNativeSeeds(wallet, cached.anchorSeed, cached.signingSeed);
  }
  if (wallet.anchorSeed && wallet.signingSeed)
    return validateNativeSeeds(wallet, wallet.anchorSeed, wallet.signingSeed);
  const phrase = Buffer.from(wallet.mnemonic.join(" "));
  try {
    return deriveTelegramWalletKeys(phrase);
  } finally {
    phrase.fill(0);
  }
}
function validateNativeSeeds(wallet: WalletData, anchorHex: string, signingHex: string) {
  if (
    ![anchorHex, signingHex].every(
      (seed) => typeof seed === "string" && /^[0-9a-f]{64}$/.test(seed)
    )
  )
    throw new Error("Invalid native wallet seeds");
  const anchorSeed = Buffer.from(anchorHex, "hex");
  const signingSeed = Buffer.from(signingHex, "hex");
  const anchor = keyPairFromSeed(anchorSeed);
  try {
    if (
      !new NativeTelegramWallet(anchor.publicKey, wallet.walletId).address.equals(
        Address.parse(wallet.address)
      )
    )
      throw new Error("Native wallet key source address mismatch");
    return { anchorSeed, signingSeed };
  } catch (error) {
    anchorSeed.fill(0);
    signingSeed.fill(0);
    throw error;
  } finally {
    anchor.secretKey.fill(0);
  }
}

export function createWalletContract(keyPair: {
  publicKey: Buffer;
  secretKey: Buffer;
}): WalletContractV5R1 | NativeTelegramWallet {
  const data = loadWallet();
  if (data?.version !== "tg")
    return WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey });
  const seeds = getNativeWalletKeys(data);
  const anchor = keyPairFromSeed(seeds.anchorSeed);
  try {
    return new NativeTelegramWallet(anchor.publicKey, data.walletId);
  } finally {
    seeds.anchorSeed.fill(0);
    seeds.signingSeed.fill(0);
    anchor.secretKey.fill(0);
  }
}

export async function getHighloadKeyPair() {
  const legacyFile = join(TELETON_ROOT, "wallet-highload-legacy.json");
  if (!existsSync(legacyFile)) return getKeyPair();
  const legacy = JSON.parse(readFileSync(legacyFile, "utf8"));
  if (
    legacy.version !== "w5r1" ||
    !Array.isArray(legacy.mnemonic) ||
    !(await mnemonicValidate(legacy.mnemonic))
  )
    throw new Error("Invalid legacy Highload wallet key");
  return mnemonicToPrivateKey(legacy.mnemonic);
}

let telegramWalletVerification: { address: string; publicKey: string } | undefined;
export function clearTelegramWalletVerification(): void {
  telegramWalletVerification = undefined;
}
function matchesPrimaryTelegramWallet(address: string, publicKey: string): boolean {
  const wallet = loadWallet();
  if (
    wallet?.version !== "tg" ||
    wallet.telegramAssociation === "pending" ||
    typeof wallet.publicKey !== "string" ||
    wallet.publicKey.toLowerCase() !== publicKey.toLowerCase()
  )
    return false;
  try {
    return Address.parse(wallet.address).equals(Address.parse(address));
  } catch {
    return false;
  }
}

export function setTelegramWalletVerification(address: string, publicKey: string): boolean {
  clearTelegramWalletVerification();
  if (!matchesPrimaryTelegramWallet(address, publicKey)) return false;
  telegramWalletVerification = { address, publicKey };
  return true;
}

export function isTelegramWalletEnabled(): boolean {
  return (
    !!telegramWalletVerification &&
    matchesPrimaryTelegramWallet(
      telegramWalletVerification.address,
      telegramWalletVerification.publicKey
    )
  );
}

export function shouldInitializeTelegramWallet(): boolean {
  return loadWallet()?.version === "tg";
}
