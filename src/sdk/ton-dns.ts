import type {
  DnsSDK,
  DnsCheckResult,
  DnsAuction,
  DnsAuctionResult,
  DnsBidResult,
  DnsResolveResult,
  PluginLogger,
} from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { tonapiFetch } from "../constants/api-endpoints.js";
import { loadWallet, getKeyPair, getCachedTonClient } from "../ton/wallet-service.js";
import { WalletContractV5R1, toNano, internal } from "@ton/ton";
import { Address, beginCell } from "@ton/core";
import { withTxLock } from "../ton/tx-lock.js";
import { sendWalletTx, type SentTx } from "../ton/confirm.js";
import { getErrorMessage } from "../utils/errors.js";
import {
  DnsUpdateError,
  linkDnsWallet,
  normalizeTonDomain,
  setDnsSite,
  unlinkDnsWallet,
} from "../ton/dns-service.js";
import { boundedLimit, requirePositiveNumber } from "./validation.js";

interface TonApiDnsAuction {
  domain: string;
  nft?: { address?: string };
  owner?: { address?: string };
  price: string;
  date: number;
  bids: number;
}

/** .ton DNS root collection contract */
const DNS_ROOT_COLLECTION = "EQC3dNlesgVD8YbAazcauIrXBPfiVhMMr5YYk2in0Mtsz0Bz";

/** Send a single internal message via the agent's wallet (within tx lock). */
async function sendWalletMessage(
  to: Address,
  value: bigint,
  body?: ReturnType<typeof beginCell.prototype.endCell>,
  bounce = true
): Promise<SentTx> {
  const keyPair = await getKeyPair();
  if (!keyPair) {
    throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
  }

  const tonClient = await getCachedTonClient();
  const sent = await withTxLock(async () => {
    const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey });
    const walletContract = tonClient.open(wallet);
    return sendWalletTx(tonClient, walletContract, {
      secretKey: keyPair.secretKey,
      messages: [internal({ to, value, body, bounce })],
    });
  });

  if (!sent) {
    throw new PluginSDKError(
      "Transaction failed or could not be confirmed on-chain",
      "OPERATION_FAILED"
    );
  }
  return sent;
}

function dnsSdkError(error: unknown, operation: string): PluginSDKError {
  if (error instanceof PluginSDKError) return error;
  if (error instanceof DnsUpdateError) {
    const code =
      error.code === "WALLET_NOT_INITIALIZED"
        ? "WALLET_NOT_INITIALIZED"
        : error.code === "INVALID_ADDRESS"
          ? "INVALID_ADDRESS"
          : error.code === "INVALID_DOMAIN" || error.code === "INVALID_ADNL_ADDRESS"
            ? "INVALID_INPUT"
            : "OPERATION_FAILED";
    return new PluginSDKError(error.message, code);
  }
  return new PluginSDKError(`${operation}: ${getErrorMessage(error)}`, "OPERATION_FAILED");
}

function normalizeDomain(domain: string): string {
  try {
    return normalizeTonDomain(domain);
  } catch (error) {
    throw dnsSdkError(error, "Invalid domain");
  }
}

export function createDnsSDK(log: PluginLogger): DnsSDK {
  return {
    async check(domain: string): Promise<DnsCheckResult> {
      const normalized = normalizeDomain(domain);
      try {
        const response = await tonapiFetch(`/dns/${encodeURIComponent(normalized)}`);

        if (response.status === 404) {
          return { domain: normalized, available: true };
        }

        if (!response.ok) {
          throw new PluginSDKError(`TonAPI error: ${response.status}`, "OPERATION_FAILED");
        }

        const data = await response.json();
        const walletRecord = data.wallet;

        return {
          domain: normalized,
          available: false,
          owner: data.owner?.address || data.item?.owner?.address || undefined,
          nftAddress: data.item?.address || data.nft_item?.address || undefined,
          walletAddress: walletRecord?.address || undefined,
        };
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        log.debug("dns.check() failed:", error);
        // On error, return unknown state
        throw new PluginSDKError(
          `Failed to check domain: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async resolve(domain: string): Promise<DnsResolveResult | null> {
      const normalized = normalizeDomain(domain);
      try {
        const response = await tonapiFetch(`/dns/${encodeURIComponent(normalized)}`);

        if (response.status === 404) return null;
        if (!response.ok) {
          log.debug(`dns.resolve() TonAPI error: ${response.status}`);
          return null;
        }

        const data = await response.json();

        return {
          domain: normalized,
          walletAddress: data.wallet?.address || null,
          nftAddress: data.item?.address || data.nft_item?.address || "",
          owner: data.owner?.address || data.item?.owner?.address || null,
          expirationDate: data.expiring_at || undefined,
        };
      } catch (error) {
        log.debug("dns.resolve() failed:", error);
        return null;
      }
    },

    async getAuctions(limit?: number): Promise<DnsAuction[]> {
      const bounded = boundedLimit(limit, 20, 100);
      try {
        const response = await tonapiFetch(`/dns/auctions?tld=ton&limit=${bounded}`);
        if (!response.ok) {
          log.debug(`dns.getAuctions() TonAPI error: ${response.status}`);
          return [];
        }

        const data = await response.json();
        return (data.data || []).map((a: TonApiDnsAuction) => ({
          domain: a.domain || "",
          nftAddress: a.nft?.address || "",
          owner: a.owner?.address || "",
          lastBid: a.price ? (Number(a.price) / 1e9).toFixed(2) : "0",
          endTime: a.date || 0,
          bids: a.bids || 0,
        }));
      } catch (error) {
        log.debug("dns.getAuctions() failed:", error);
        return [];
      }
    },

    async startAuction(domain: string): Promise<DnsAuctionResult> {
      const normalized = normalizeDomain(domain);
      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      // Encode domain name for the smart contract
      const domainWithoutTld = normalized.replace(/\.ton$/, "");
      const domainBytes = Buffer.from(domainWithoutTld, "utf8");
      const domainCell = beginCell().storeBuffer(domainBytes).endCell();

      // Initial bid amount (minimum for .ton domains)
      const bidAmount = "0.06"; // ~0.06 TON minimum for short domains

      try {
        await sendWalletMessage(Address.parse(DNS_ROOT_COLLECTION), toNano(bidAmount), domainCell);
        return { domain: normalized, success: true, bidAmount };
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to start auction: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async bid(domain: string, amount: number): Promise<DnsBidResult> {
      const normalized = normalizeDomain(domain);
      requirePositiveNumber(amount, "Bid amount");

      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      // First resolve the auction NFT address
      const checkResult = await this.check(normalized);
      if (!checkResult.nftAddress) {
        throw new PluginSDKError(`No active auction found for ${normalized}`, "OPERATION_FAILED");
      }

      try {
        await sendWalletMessage(
          Address.parse(checkResult.nftAddress as string),
          toNano(amount.toString())
        );
        return { domain: normalized, bidAmount: amount.toString(), success: true };
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(`Failed to bid: ${getErrorMessage(error)}`, "OPERATION_FAILED");
      }
    },

    async link(domain: string, address: string): Promise<void> {
      try {
        await linkDnsWallet(domain, address);
      } catch (error) {
        throw dnsSdkError(error, "Failed to link domain");
      }
    },

    async unlink(domain: string): Promise<void> {
      try {
        await unlinkDnsWallet(domain);
      } catch (error) {
        throw dnsSdkError(error, "Failed to unlink domain");
      }
    },

    async setSiteRecord(domain: string, adnlAddress: string): Promise<void> {
      try {
        await setDnsSite(domain, adnlAddress);
      } catch (error) {
        throw dnsSdkError(error, "Failed to set site record");
      }
    },
  };
}
