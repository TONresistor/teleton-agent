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
import { Address, beginCell, SendMode } from "@ton/core";
import { withTxLock } from "../ton/tx-lock.js";
import { createHash } from "crypto";

/** .ton DNS root collection contract */
const DNS_ROOT_COLLECTION = "EQC3dNlesgVD8YbAazcauIrXBPfiVhMMr5YYk2in0Mtsz0Bz";

/** SHA256 of "wallet" — the DNS record key for wallet address */
const DNS_WALLET_KEY = BigInt("0x" + createHash("sha256").update("wallet").digest("hex"));

/** Opcode for change_dns_record on TON DNS NFT */
const CHANGE_DNS_RECORD_OP = 0x4eb1f0f9;

/** Send a single internal message via the agent's wallet (within tx lock). */
async function sendWalletMessage(
  to: Address,
  value: bigint,
  body?: ReturnType<typeof beginCell.prototype.endCell>,
  bounce = true
): Promise<void> {
  await withTxLock(async () => {
    const keyPair = await getKeyPair();
    if (!keyPair) {
      throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
    }

    const tonClient = await getCachedTonClient();
    const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey });
    const walletContract = tonClient.open(wallet);
    const seqno = await walletContract.getSeqno();

    await walletContract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      messages: [internal({ to, value, body, bounce })],
    });
  });
}

function normalizeDomain(domain: string): string {
  let d = domain.toLowerCase().trim();
  if (!d.endsWith(".ton")) d += ".ton";
  return d;
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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.debug("dns.check() failed:", err);
        // On error, return unknown state
        throw new PluginSDKError(
          `Failed to check domain: ${err instanceof Error ? err.message : String(err)}`,
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
      } catch (err) {
        log.debug("dns.resolve() failed:", err);
        return null;
      }
    },

    async getAuctions(limit?: number): Promise<DnsAuction[]> {
      try {
        const response = await tonapiFetch(
          `/dns/auctions?tld=ton&limit=${Math.min(limit ?? 20, 100)}`
        );
        if (!response.ok) {
          log.debug(`dns.getAuctions() TonAPI error: ${response.status}`);
          return [];
        }

        const data = await response.json();
        return (data.data || []).map((a: any) => ({
          domain: a.domain || "",
          nftAddress: a.nft?.address || "",
          owner: a.owner?.address || "",
          lastBid: a.price ? (Number(a.price) / 1e9).toFixed(2) : "0",
          endTime: a.date || 0,
          bids: a.bids || 0,
        }));
      } catch (err) {
        log.debug("dns.getAuctions() failed:", err);
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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to start auction: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async bid(domain: string, amount: number): Promise<DnsBidResult> {
      const normalized = normalizeDomain(domain);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new PluginSDKError("Bid amount must be positive", "OPERATION_FAILED");
      }

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
        await sendWalletMessage(Address.parse(checkResult.nftAddress!), toNano(amount.toString()));
        return { domain: normalized, bidAmount: amount.toString(), success: true };
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to bid: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async link(domain: string, address: string): Promise<void> {
      const normalized = normalizeDomain(domain);

      try {
        Address.parse(address);
      } catch {
        throw new PluginSDKError("Invalid TON address", "INVALID_ADDRESS");
      }

      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      // Resolve domain to get NFT address
      const resolveResult = await this.resolve(normalized);
      if (!resolveResult?.nftAddress) {
        throw new PluginSDKError(`Domain ${normalized} not found or not owned`, "OPERATION_FAILED");
      }

      // Build change_dns_record message with wallet record
      const walletCell = beginCell()
        .storeUint(0x9fd3, 16) // dns_smc_address#9fd3
        .storeAddress(Address.parse(address))
        .storeUint(0, 8) // flags
        .endCell();

      const body = beginCell()
        .storeUint(CHANGE_DNS_RECORD_OP, 32) // op
        .storeUint(0, 64) // query_id
        .storeUint(DNS_WALLET_KEY, 256) // key = SHA256("wallet")
        .storeRef(walletCell)
        .endCell();

      try {
        await sendWalletMessage(Address.parse(resolveResult.nftAddress), toNano("0.05"), body);
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to link domain: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async unlink(domain: string): Promise<void> {
      const normalized = normalizeDomain(domain);

      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      const resolveResult = await this.resolve(normalized);
      if (!resolveResult?.nftAddress) {
        throw new PluginSDKError(`Domain ${normalized} not found or not owned`, "OPERATION_FAILED");
      }

      // Build change_dns_record with no value (= delete record)
      const body = beginCell()
        .storeUint(CHANGE_DNS_RECORD_OP, 32) // op
        .storeUint(0, 64) // query_id
        .storeUint(DNS_WALLET_KEY, 256) // key = SHA256("wallet")
        .endCell();

      try {
        await sendWalletMessage(Address.parse(resolveResult.nftAddress), toNano("0.05"), body);
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to unlink domain: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },
  };
}
