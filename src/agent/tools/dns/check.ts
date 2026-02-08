import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { TONAPI_BASE_URL, tonapiHeaders } from "../../../constants/api-endpoints.js";

/**
 * Parameters for dns_check tool
 */
interface DnsCheckParams {
  domain: string;
}

/**
 * Tool definition for dns_check
 */
export const dnsCheckTool: Tool = {
  name: "dns_check",
  description:
    "Check if a .ton domain is available, in auction, or already owned. Returns status with relevant details (price estimates, current bids, owner info).",
  parameters: Type.Object({
    domain: Type.String({
      description: "Domain name to check (with or without .ton extension)",
    }),
  }),
};

/**
 * Estimate minimum price based on domain length
 */
function estimateMinPrice(length: number): string {
  if (length === 4) return "~100 TON";
  if (length === 5) return "~50 TON";
  if (length >= 6 && length <= 10) return "~5-10 TON";
  return "~1 TON";
}

/**
 * Executor for dns_check tool
 */
export const dnsCheckExecutor: ToolExecutor<DnsCheckParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    let { domain } = params;

    // Normalize domain (remove .ton if present, lowercase)
    domain = domain.toLowerCase().replace(/\.ton$/, "");

    // Validate domain format
    if (domain.length < 4 || domain.length > 126) {
      return {
        success: false,
        error: "Domain must be 4-126 characters long",
      };
    }

    if (!/^[a-z0-9-]+$/.test(domain)) {
      return {
        success: false,
        error: "Domain can only contain lowercase letters, numbers, and hyphens",
      };
    }

    const fullDomain = `${domain}.ton`;

    // Check if domain exists via TonAPI
    const dnsInfoResponse = await fetchWithTimeout(`${TONAPI_BASE_URL}/dns/${fullDomain}`, {
      headers: tonapiHeaders(),
    });

    // Case 1: Domain doesn't exist (404) - AVAILABLE
    if (dnsInfoResponse.status === 404) {
      const minPrice = estimateMinPrice(domain.length);
      return {
        success: true,
        data: {
          domain: fullDomain,
          status: "AVAILABLE",
          length: domain.length,
          minPrice,
          message: `${fullDomain} → AVAILABLE\n  Min price: ${minPrice} (${domain.length} chars)`,
        },
      };
    }

    if (!dnsInfoResponse.ok) {
      return {
        success: false,
        error: `TonAPI error: ${dnsInfoResponse.status}`,
      };
    }

    const dnsInfo = await dnsInfoResponse.json();

    // Case 2: Domain exists with owner - OWNED
    if (dnsInfo.item?.owner?.address) {
      const expiryDate = new Date(dnsInfo.expiring_at * 1000).toISOString().split("T")[0];
      const nftAddress = dnsInfo.item.address;

      return {
        success: true,
        data: {
          domain: fullDomain,
          status: "OWNED",
          owner: dnsInfo.item.owner.address,
          expiresAt: dnsInfo.expiring_at,
          expiryDate,
          nftAddress,
          message: `${fullDomain} → OWNED\n  Owner: ${dnsInfo.item.owner.address}\n  Expires: ${expiryDate}\n  NFT: ${nftAddress}`,
        },
      };
    }

    // Case 3: Domain exists but no owner - IN AUCTION
    // Check auctions list to get bid details
    const auctionsResponse = await fetchWithTimeout(`${TONAPI_BASE_URL}/dns/auctions?tld=ton`, {
      headers: tonapiHeaders(),
    });

    if (auctionsResponse.ok) {
      const auctions = await auctionsResponse.json();
      const auction = auctions.data?.find((a: any) => a.domain === fullDomain);

      if (auction) {
        const currentBid = (BigInt(auction.price) / BigInt(1_000_000_000)).toString();
        const endDate = new Date(auction.date * 1000).toISOString().replace("T", " ").split(".")[0];
        const nftAddress = dnsInfo.item?.address || "Unknown";

        return {
          success: true,
          data: {
            domain: fullDomain,
            status: "IN_AUCTION",
            currentBid: `${currentBid} TON`,
            bids: auction.bids,
            endsAt: auction.date,
            endDate,
            nftAddress,
            message: `${fullDomain} → IN AUCTION\n  Current bid: ${currentBid} TON (${auction.bids} bids)\n  Ends: ${endDate} UTC\n  NFT: ${nftAddress}`,
          },
        };
      }
    }

    // Fallback: domain exists but couldn't determine exact status
    return {
      success: true,
      data: {
        domain: fullDomain,
        status: "UNKNOWN",
        nftAddress: dnsInfo.item?.address,
        message: `${fullDomain} → Status unclear (check manually)`,
      },
    };
  } catch (error) {
    console.error("Error in dns_check:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
