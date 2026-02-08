import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { TONAPI_BASE_URL, tonapiHeaders } from "../../../constants/api-endpoints.js";

/**
 * Parameters for dns_auctions tool
 */
interface DnsAuctionsParams {
  limit?: number;
}

/**
 * Tool definition for dns_auctions
 */
export const dnsAuctionsTool: Tool = {
  name: "dns_auctions",
  description:
    "List all active .ton domain auctions. Returns domains currently in auction with current bid prices, number of bids, and end times.",
  parameters: Type.Object({
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of auctions to return (default: 20, max: 100)",
        minimum: 1,
        maximum: 100,
      })
    ),
  }),
};

/**
 * Executor for dns_auctions tool
 */
export const dnsAuctionsExecutor: ToolExecutor<DnsAuctionsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { limit = 20 } = params;

    // Fetch all auctions from TonAPI
    const response = await fetchWithTimeout(`${TONAPI_BASE_URL}/dns/auctions?tld=ton`, {
      headers: tonapiHeaders(),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `TonAPI error: ${response.status}`,
      };
    }

    const auctions = await response.json();

    if (!auctions.data || auctions.data.length === 0) {
      return {
        success: true,
        data: {
          total: 0,
          auctions: [],
          message: "No active auctions found",
        },
      };
    }

    // Format and limit results
    const formattedAuctions = auctions.data.slice(0, limit).map((auction: any) => {
      const currentBid = (BigInt(auction.price) / BigInt(1_000_000_000)).toString();
      const endDate = new Date(auction.date * 1000).toISOString().replace("T", " ").split(".")[0];

      return {
        domain: auction.domain,
        currentBid: `${currentBid} TON`,
        bids: auction.bids,
        endsAt: auction.date,
        endDate: endDate + " UTC",
        owner: auction.owner,
      };
    });

    // Create summary message
    const summary = formattedAuctions
      .map(
        (a: any, i: number) =>
          `${i + 1}. ${a.domain} - ${a.currentBid} (${a.bids} bids) - Ends: ${a.endDate}`
      )
      .join("\n");

    return {
      success: true,
      data: {
        total: auctions.total,
        showing: formattedAuctions.length,
        auctions: formattedAuctions,
        message: `Active auctions (${formattedAuctions.length}/${auctions.total}):\n\n${summary}`,
      },
    };
  } catch (error) {
    console.error("Error in dns_auctions:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
