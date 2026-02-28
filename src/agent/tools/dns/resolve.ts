import { Type } from "@sinclair/typebox";
import { Address } from "@ton/core";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { tonapiFetch } from "../../../constants/api-endpoints.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
interface DnsResolveParams {
  domain: string;
}
export const dnsResolveTool: Tool = {
  name: "dns_resolve",
  description:
    "Resolve a .ton domain to its wallet address. Only works for owned domains. Use dns_link to associate a wallet.",
  category: "data-bearing",
  parameters: Type.Object({
    domain: Type.String({
      description: "Domain name to resolve (with or without .ton extension)",
    }),
  }),
};
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
    const response = await tonapiFetch(`/dns/${fullDomain}`);

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

    // TonAPI returns raw format (0:hex) — convert to friendly format
    // so the LLM doesn't hallucinate the CRC16 checksum
    const rawWallet = dnsInfo.item.owner.address;
    const rawNft = dnsInfo.item.address;
    const walletAddress = Address.parse(rawWallet).toString({ bounceable: false });
    const nftAddress = Address.parse(rawNft).toString({ bounceable: true });
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
    log.error({ err: error }, "Error in dns_resolve");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
