import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { tonExplorerTxUrl } from "../../../ton/confirm.js";
import { linkDnsWallet } from "../../../ton/dns-service.js";

const log = createLogger("Tools");

interface DnsLinkParams {
  domain: string;
  wallet_address?: string;
}
export const dnsLinkTool: Tool = {
  name: "dns_link",
  description: "Link a wallet address to a .ton domain you own. Defaults to your own wallet.",
  parameters: Type.Object({
    domain: Type.String({
      description: "Domain name (with or without .ton extension)",
    }),
    wallet_address: Type.Optional(
      Type.String({
        description: "Wallet address to link (defaults to your wallet if not specified)",
      })
    ),
  }),
};
export const dnsLinkExecutor: ToolExecutor<DnsLinkParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const updated = await linkDnsWallet(params.domain, params.wallet_address);
    const targetAddress = params.wallet_address || updated.from;

    return {
      success: true,
      data: {
        domain: updated.domain,
        linkedWallet: targetAddress,
        nftAddress: updated.nftAddress,
        from: updated.from,
        txHash: updated.tx.hash,
        message: `Linked ${updated.domain} → ${targetAddress} — confirmed on-chain\n  NFT: ${updated.nftAddress}\n  tx ${updated.tx.hash}\n  ${tonExplorerTxUrl(updated.tx.hash)}`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in dns_link");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
