import { Type } from "@sinclair/typebox";
import { fromNano } from "@ton/ton";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { tonapiFetch } from "../../../constants/api-endpoints.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");

interface TonApiDnsAuction {
  domain: string;
  price: string;
  bids: number;
  date: number;
  owner?: string;
}

interface FormattedAuction {
  domain: string;
  currentBid: string;
  bids: number;
  endsAt: number;
  endDate: string;
  owner: string | undefined;
}

interface DnsAuctionsParams {
  limit?: number;
}
export const dnsAuctionsTool: Tool = {
  name: "dns_auctions",
  description:
    "List active .ton domain auctions with current bids and end times. Use dns_bid to bid on a result.",
  category: "data-bearing",
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
export const dnsAuctionsExecutor: ToolExecutor<DnsAuctionsParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { limit = 20 } = params;

    // Fetch all auctions from TonAPI
    const response = await tonapiFetch(`/dns/auctions?tld=ton`);

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
    const formattedAuctions: FormattedAuction[] = auctions.data
      .slice(0, limit)
      .map((auction: TonApiDnsAuction) => {
        const currentBid = fromNano(auction.price);
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
        (a: FormattedAuction, i: number) =>
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
    log.error({ err: error }, "Error in dns_auctions");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
