import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet, getKeyPair } from "../../../ton/wallet-service.js";
import { WalletContractV5R1, TonClient, toNano, internal } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getCachedHttpEndpoint } from "../../../ton/endpoint.js";
import { tonapiFetch } from "../../../constants/api-endpoints.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
interface DnsBidParams {
  domain: string;
  amount: number;
}
export const dnsBidTool: Tool = {
  name: "dns_bid",
  description:
    "Place a bid on a .ton domain auction. Bid must be >= 105% of current bid. Use dns_check first.",
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
    const dnsResponse = await tonapiFetch(`/dns/${fullDomain}`);

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
    const auctionsResponse = await tonapiFetch(`/dns/auctions?tld=ton`);

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

    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    const keyPair = await getKeyPair();
    if (!keyPair) {
      return { success: false, error: "Wallet key derivation failed." };
    }

    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    const endpoint = await getCachedHttpEndpoint();
    const client = new TonClient({ endpoint });
    const contract = client.open(wallet);

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
    log.error({ err: error }, "Error in dns_bid");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
