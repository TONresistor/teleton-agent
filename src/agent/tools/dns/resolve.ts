import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { TONAPI_BASE_URL, tonapiHeaders } from "../../../constants/api-endpoints.js";

/**
 * Parameters for dns_resolve tool
 */
interface DnsResolveParams {
  domain: string;
}

/**
 * Tool definition for dns_resolve
 */
export const dnsResolveTool: Tool = {
  name: "dns_resolve",
  description:
    "Resolve a .ton domain to its associated wallet address. Only works for domains that are already owned (not available or in auction).",
  parameters: Type.Object({
    domain: Type.String({
      description: "Domain name to resolve (with or without .ton extension)",
    }),
  }),
};

/**
 * Executor for dns_resolve tool
 */
export const dnsResolveExecutor: ToolExecutor<DnsResolveParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    let { domain } = params;

    // Normalize domain
    domain = domain.toLowerCase().replace(/\.ton$/, "");
    const fullDomain = `${domain}.ton`;

    // Get domain info from TonAPI
    const response = await fetchWithTimeout(`${TONAPI_BASE_URL}/dns/${fullDomain}`, {
      headers: tonapiHeaders(),
    });

    if (response.status === 404) {
      return {
        success: false,
        error: `Domain ${fullDomain} is not minted yet (available for auction)`,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `TonAPI error: ${response.status}`,
      };
    }

    const dnsInfo = await response.json();

    // Check if domain has an owner
    if (!dnsInfo.item?.owner?.address) {
      return {
        success: false,
        error: `Domain ${fullDomain} is in auction (no owner yet)`,
      };
    }

    const walletAddress = dnsInfo.item.owner.address;
    const nftAddress = dnsInfo.item.address;
    const expiryDate = new Date(dnsInfo.expiring_at * 1000).toISOString().split("T")[0];

    return {
      success: true,
      data: {
        domain: fullDomain,
        walletAddress,
        nftAddress,
        expiresAt: dnsInfo.expiring_at,
        expiryDate,
        message: `${fullDomain} → ${walletAddress}\n  NFT: ${nftAddress}\n  Expires: ${expiryDate}`,
      },
    };
  } catch (error) {
    console.error("Error in dns_resolve:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
