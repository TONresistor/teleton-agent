import { mnemonicNew, mnemonicToPrivateKey, mnemonicValidate } from "@ton/crypto";
import { WalletContractV5R1, TonClient, fromNano } from "@ton/ton";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { fetchWithTimeout } from "../utils/fetch.js";
import { TELETON_ROOT } from "../workspace/paths.js";
import { TONAPI_BASE_URL, tonapiHeaders, COINGECKO_API_URL } from "../constants/api-endpoints.js";

const WALLET_FILE = join(TELETON_ROOT, "wallet.json");

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

  writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2), "utf-8");

  // Set file permissions to 600 (owner read/write only)
  chmodSync(WALLET_FILE, 0o600);
}

/**
 * Load wallet from ~/.teleton/wallet.json
 */
export function loadWallet(): WalletData | null {
  if (!existsSync(WALLET_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(WALLET_FILE, "utf-8");
    return JSON.parse(content) as WalletData;
  } catch (error) {
    console.error("Failed to load wallet:", error);
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
 * Get wallet balance from TON Center API
 */
export async function getWalletBalance(address: string): Promise<{
  balance: string;
  balanceNano: string;
} | null> {
  try {
    // Get decentralized endpoint from orbs network (no rate limits)
    const endpoint = await getHttpEndpoint({ network: "mainnet" });

    const client = new TonClient({ endpoint });

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
    console.error("Failed to get balance:", error);
    return null;
  }
}

/**
 * Get TON/USD price from TonAPI (primary) with CoinGecko fallback
 */
export async function getTonPrice(): Promise<{
  usd: number;
  source: string;
  timestamp: number;
} | null> {
  // Primary: TonAPI /v2/rates (uses configured API key if available)
  try {
    const response = await fetchWithTimeout(`${TONAPI_BASE_URL}/rates?tokens=ton&currencies=usd`, {
      headers: tonapiHeaders(),
    });

    if (response.ok) {
      const data = await response.json();
      const price = data?.rates?.TON?.prices?.USD;
      if (typeof price === "number" && price > 0) {
        return { usd: price, source: "TonAPI", timestamp: Date.now() };
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
      return { usd: price, source: "CoinGecko", timestamp: Date.now() };
    }
  } catch (error) {
    console.error("Failed to get TON price:", error);
  }

  return null;
}
