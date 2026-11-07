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
import { WalletContractV5R1, toNano, fromNano, internal, type TonClient } from "@ton/ton";
import { Address, beginCell } from "@ton/core";
import type { CommonMessageInfoInternal, Message, Transaction } from "@ton/core";
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
import { TON_CONFIRM_POLL_INTERVAL_MS, TON_CONFIRM_TIMEOUT_MS } from "../constants/timeouts.js";

interface TonApiDnsAuction {
  domain: string;
  nft?: { address?: string };
  owner?: string | { address?: string };
  price: string | number;
  date: number;
  bids: number;
}

/** .ton DNS root collection contract */
const DNS_ROOT_COLLECTION = "EQC3dNlesgVD8YbAazcauIrXBPfiVhMMr5YYk2in0Mtsz0Bz";
const DNS_OUTBID_NOTIFICATION = 0x557cea20;

type InternalMessage = Message & { info: CommonMessageInfoInternal };

function internalMessages(tx: Transaction): InternalMessage[] {
  return [...tx.outMessages.values()].filter(
    (message): message is InternalMessage =>
      message.info.type === "internal" && !message.info.bounced
  );
}

function dnsResultUnknown(hash: string): PluginSDKError {
  return new PluginSDKError(
    `Wallet transaction ${hash} confirmed, but DNS acceptance could not be confirmed. Do not automatically resend.`,
    "NOT_AVAILABLE"
  );
}

async function waitForDnsTransaction(
  read: () => Promise<Transaction | undefined>,
  deadline: number,
  hash: string
): Promise<Transaction> {
  while (Date.now() < deadline) {
    try {
      const tx = await read();
      if (tx) return tx;
    } catch {
      // Read-only RPC lookups can lag behind the confirmed wallet transaction.
    }
    await new Promise((resolve) => setTimeout(resolve, TON_CONFIRM_POLL_INTERVAL_MS));
  }
  throw dnsResultUnknown(hash);
}

async function dnsMessageReceipt(
  client: TonClient,
  message: InternalMessage,
  deadline: number,
  hash: string
): Promise<Transaction> {
  const tx = await waitForDnsTransaction(
    async () => {
      const result = await client.tryLocateResultTx(
        message.info.src,
        message.info.dest,
        message.info.createdLt.toString()
      );
      const incoming = result.inMessage;
      const info = incoming?.info;
      return info?.type === "internal" &&
        !info.bounced &&
        info.src.equals(message.info.src) &&
        info.dest.equals(message.info.dest) &&
        info.createdLt === message.info.createdLt &&
        info.value.coins === message.info.value.coins &&
        incoming?.body.equals(message.body)
        ? result
        : undefined;
    },
    deadline,
    hash
  );

  const description = tx.description;
  if (
    description.type !== "generic" ||
    description.aborted ||
    description.destroyed ||
    description.computePhase.type !== "vm" ||
    !description.computePhase.success ||
    description.actionPhase?.success === false
  ) {
    throw new PluginSDKError(
      `DNS contract rejected the operation (wallet transaction ${hash})`,
      "OPERATION_FAILED"
    );
  }
  return tx;
}

// ton-blockchain/dns-contract, func/dns-utils.fc: get_min_price.
function minimumAuctionBid(length: number): bigint {
  if (length < 4 || length > 126) {
    throw new PluginSDKError("Auction domains must contain 4 to 126 characters", "INVALID_INPUT");
  }
  const prices = [
    [1000n, 100n],
    [500n, 50n],
    [400n, 40n],
    [300n, 30n],
    [200n, 20n],
    [100n, 10n],
    [50n, 5n],
  ];
  const [initial, floor] = prices[length - 4] ?? [10n, 1n];
  const elapsed = Math.floor(Date.now() / 1000) - 1659171600;
  if (elapsed <= 0) throw new PluginSDKError("Domain auctions have not started", "NOT_AVAILABLE");
  const months = Math.floor(elapsed / 2592000);
  if (months > 21) return floor * 1_000_000_000n;
  let price = initial * 1_000_000_000n;
  for (let month = 0; month < months; month++) price = (price * 90n) / 100n;
  return price;
}

/** Send once, then follow the exact message through the DNS contracts. */
async function sendWalletMessage(
  to: Address,
  value: bigint,
  body?: ReturnType<typeof beginCell.prototype.endCell>,
  auctionEndTime?: number
): Promise<SentTx> {
  const keyPair = await getKeyPair();
  if (!keyPair) {
    throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
  }

  const tonClient = await getCachedTonClient();
  const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: keyPair.publicKey });
  const sent = await withTxLock(async () => {
    const walletContract = tonClient.open(wallet);
    return sendWalletTx(tonClient, walletContract, {
      secretKey: keyPair.secretKey,
      messages: [internal({ to, value, body, bounce: true })],
    });
  });

  if (!sent) {
    throw new PluginSDKError(
      "Transaction failed or could not be confirmed on-chain",
      "OPERATION_FAILED"
    );
  }

  const deadline = Date.now() + TON_CONFIRM_TIMEOUT_MS;
  const walletTx = await waitForDnsTransaction(
    async () => {
      const transactions = await tonClient.getTransactions(wallet.address, { limit: 10 });
      return transactions.find((tx) => tx.hash().toString("hex") === sent.hash);
    },
    deadline,
    sent.hash
  );
  const outgoing = internalMessages(walletTx).find(
    (message) =>
      message.info.src.equals(wallet.address) &&
      message.info.dest.equals(to) &&
      message.info.value.coins === value &&
      message.body.equals(body ?? beginCell().endCell())
  );
  if (!outgoing) throw dnsResultUnknown(sent.hash);

  const receipt = await dnsMessageReceipt(tonClient, outgoing, deadline, sent.hash);
  if (body && to.equals(Address.parse(DNS_ROOT_COLLECTION))) {
    const label = body.beginParse().skip(32).loadStringTail();
    const deploymentBody = beginCell()
      .storeAddress(wallet.address)
      .storeRef(beginCell().storeStringTail(label).endCell())
      .endCell();
    const deployment = internalMessages(receipt).find(
      (message) =>
        message.info.src.equals(to) && message.init && message.body.equals(deploymentBody)
    );
    if (!deployment) throw dnsResultUnknown(sent.hash);

    const nftReceipt = await dnsMessageReceipt(tonClient, deployment, deadline, sent.hash);
    // A collection message to an already initialized NFT succeeds but refunds the bidder.
    const refunded = internalMessages(nftReceipt).some(
      (message) =>
        message.info.dest.equals(wallet.address) &&
        message.body.bits.length >= 32 &&
        message.body.beginParse().loadUint(32) === 0
    );
    if (refunded) {
      throw new PluginSDKError(
        `Domain already initialized; DNS refunded the initial bid (wallet transaction ${sent.hash})`,
        "OPERATION_FAILED"
      );
    }
    if (nftReceipt.outMessages.size !== 0) throw dnsResultUnknown(sent.hash);
  } else {
    // An active op=0 bid either precedes the observed deadline or emits this refund
    // to the previous bidder. A late owner top-up is successful but is not a bid.
    const accepted =
      (auctionEndTime !== undefined && receipt.now <= auctionEndTime) ||
      internalMessages(receipt).some(
        (message) =>
          message.info.src.equals(to) &&
          message.body.bits.length >= 96 &&
          message.body.beginParse().loadUint(32) === DNS_OUTBID_NOTIFICATION
      );
    if (!accepted) throw dnsResultUnknown(sent.hash);
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
  async function walletRecord(domain: string): Promise<string | undefined> {
    try {
      const response = await tonapiFetch(`/dns/${encodeURIComponent(domain)}/resolve`);
      if (!response.ok) return undefined;
      return (await response.json()).wallet?.address;
    } catch (error) {
      log.debug("dns wallet resolution failed:", error);
      return undefined;
    }
  }

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
        const walletAddress = data.wallet?.address ?? (await walletRecord(normalized));

        return {
          domain: normalized,
          available: false,
          owner: data.owner?.address || data.item?.owner?.address || undefined,
          nftAddress: data.item?.address || data.nft_item?.address || undefined,
          walletAddress,
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
        const walletAddress = data.wallet?.address ?? (await walletRecord(normalized));

        return {
          domain: normalized,
          walletAddress: walletAddress ?? null,
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
        const auctions = await Promise.all(
          (data.data || [])
            .slice(0, bounded)
            .map(async (a: TonApiDnsAuction): Promise<DnsAuction | null> => {
              let nftAddress = a.nft?.address;
              if (!nftAddress) {
                try {
                  const info = await tonapiFetch(
                    `/dns/${encodeURIComponent(normalizeDomain(a.domain))}`
                  );
                  if (!info.ok) return null;
                  nftAddress = (await info.json()).item?.address;
                } catch {
                  return null;
                }
              }
              if (!nftAddress) return null;
              const [whole, fraction = ""] = fromNano(BigInt(a.price)).split(".");
              return {
                domain: a.domain,
                nftAddress,
                owner: typeof a.owner === "string" ? a.owner : a.owner?.address || "",
                lastBid: `${whole}.${fraction.padEnd(2, "0")}`,
                endTime: a.date || 0,
                bids: a.bids || 0,
              };
            })
        );
        return auctions.filter((auction): auction is DnsAuction => auction !== null);
      } catch (error) {
        log.debug("dns.getAuctions() failed:", error);
        return [];
      }
    },

    async startAuction(domain: string): Promise<DnsAuctionResult> {
      const normalized = normalizeDomain(domain);
      const domainWithoutTld = normalized.replace(/\.ton$/, "");
      if (
        domainWithoutTld.length < 4 ||
        domainWithoutTld.length > 126 ||
        /[^a-z0-9-]/.test(domainWithoutTld) ||
        domainWithoutTld.startsWith("-") ||
        domainWithoutTld.endsWith("-")
      ) {
        throw new PluginSDKError(
          "Auction domains must contain 4 to 126 ASCII letters or digits, with hyphens only inside",
          "INVALID_INPUT"
        );
      }
      const value = minimumAuctionBid(domainWithoutTld.length);
      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      try {
        if (!(await this.check(normalized)).available) {
          throw new PluginSDKError(
            "Domain is already registered; use bid for an active auction",
            "OPERATION_FAILED"
          );
        }
        const domainCell = beginCell().storeUint(0, 32).storeStringTail(domainWithoutTld).endCell();
        await sendWalletMessage(Address.parse(DNS_ROOT_COLLECTION), value, domainCell);
        return { domain: normalized, success: true, bidAmount: fromNano(value) };
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
        const nftAddress = Address.parse(checkResult.nftAddress);
        const client = await getCachedTonClient();
        const { stack } = await client.runMethod(nftAddress, "get_auction_info");
        const auctionEndTime = stack.skip(2).readNumber();
        if (auctionEndTime <= 0) {
          throw new PluginSDKError("No active auction found for this domain", "OPERATION_FAILED");
        }
        await sendWalletMessage(nftAddress, toNano(amount.toString()), undefined, auctionEndTime);
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
