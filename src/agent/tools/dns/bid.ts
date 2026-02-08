import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1, TonClient, toNano, internal } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { TONAPI_BASE_URL, tonapiHeaders } from "../../../constants/api-endpoints.js";

/**
 * Parameters for dns_bid tool
 */
interface DnsBidParams {
  domain: string;
  amount: number;
}

/**
 * Tool definition for dns_bid
 */
export const dnsBidTool: Tool = {
  name: "dns_bid",
  description:
    "Place a bid on an existing .ton domain auction. Bid must be at least 5% higher than current bid. The domain must already be in auction (use dns_check first to verify status and get current bid).",
  parameters: Type.Object({
    domain: Type.String({
      description: "Domain name (with or without .ton extension)",
    }),
    amount: Type.Number({
      description: "Bid amount in TON (must be >= 105% of current bid)",
      minimum: 1,
    }),
  }),
};

/**
 * Executor for dns_bid tool
 */
export const dnsBidExecutor: ToolExecutor<DnsBidParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    let { domain, amount } = params;

    // Normalize domain
    domain = domain.toLowerCase().replace(/\.ton$/, "");
    const fullDomain = `${domain}.ton`;

    // Get domain info to find NFT address
    const dnsResponse = await fetchWithTimeout(`${TONAPI_BASE_URL}/dns/${fullDomain}`, {
      headers: tonapiHeaders(),
    });

    if (dnsResponse.status === 404) {
      return {
        success: false,
        error: `Domain ${fullDomain} is not minted yet. Use dns_start_auction to start an auction.`,
      };
    }

    if (!dnsResponse.ok) {
      return {
        success: false,
        error: `TonAPI error: ${dnsResponse.status}`,
      };
    }

    const dnsInfo = await dnsResponse.json();

    // Check if domain is in auction (no owner yet)
    if (dnsInfo.item?.owner?.address) {
      return {
        success: false,
        error: `Domain ${fullDomain} is already owned. Cannot bid on owned domains.`,
      };
    }

    const nftAddress = dnsInfo.item?.address;
    if (!nftAddress) {
      return {
        success: false,
        error: `Could not determine NFT address for ${fullDomain}`,
      };
    }

    // Get auction details to validate bid amount
    const auctionsResponse = await fetchWithTimeout(`${TONAPI_BASE_URL}/dns/auctions?tld=ton`, {
      headers: tonapiHeaders(),
    });

    if (auctionsResponse.ok) {
      const auctions = await auctionsResponse.json();
      const auction = auctions.data?.find((a: any) => a.domain === fullDomain);

      if (auction) {
        const currentBid = Number(BigInt(auction.price) / BigInt(1_000_000_000));
        const minBid = currentBid * 1.05;

        if (amount < minBid) {
          return {
            success: false,
            error: `Bid too low. Current bid: ${currentBid} TON. Minimum required: ${minBid.toFixed(2)} TON (+5%)`,
          };
        }
      }
    }

    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // Convert mnemonic to private key
    const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);

    // Create wallet contract
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    // Get decentralized endpoint
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const client = new TonClient({ endpoint });
    const contract = client.open(wallet);

    // Get current seqno
    const seqno = await contract.getSeqno();

    // Send bid (just TON, no body needed for bids - op=0 is implicit)
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: [
        internal({
          to: Address.parse(nftAddress),
          value: toNano(amount),
          body: "", // Empty body for bid
          bounce: true,
        }),
      ],
    });

    return {
      success: true,
      data: {
        domain: fullDomain,
        amount: `${amount} TON`,
        nftAddress,
        from: walletData.address,
        message: `Bid placed on ${fullDomain}: ${amount} TON\n  From: ${walletData.address}\n  NFT: ${nftAddress}\n  Transaction sent (check status in a few seconds)`,
      },
    };
  } catch (error) {
    console.error("Error in dns_bid:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
