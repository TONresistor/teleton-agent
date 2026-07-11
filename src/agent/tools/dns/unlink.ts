import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { tonExplorerTxUrl } from "../../../ton/confirm.js";
import { unlinkDnsWallet } from "../../../ton/dns-service.js";

const log = createLogger("Tools");

interface DnsUnlinkParams {
  domain: string;
}
export const dnsUnlinkTool: Tool = {
  name: "dns_unlink",
  description: "Remove the wallet link from a .ton domain you own.",
  parameters: Type.Object({
    domain: Type.String({
      description: "Domain name (with or without .ton extension)",
    }),
  }),
};
export const dnsUnlinkExecutor: ToolExecutor<DnsUnlinkParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const updated = await unlinkDnsWallet(params.domain);

    return {
      success: true,
      data: {
        domain: updated.domain,
        nftAddress: updated.nftAddress,
        from: updated.from,
        txHash: updated.tx.hash,
        message: `Unlinked wallet from ${updated.domain} — confirmed on-chain\n  NFT: ${updated.nftAddress}\n  tx ${updated.tx.hash}\n  ${tonExplorerTxUrl(updated.tx.hash)}`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in dns_unlink");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
