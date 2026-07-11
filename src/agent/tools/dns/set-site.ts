import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { tonExplorerTxUrl } from "../../../ton/confirm.js";
import { normalizeAdnlAddress, setDnsSite } from "../../../ton/dns-service.js";

const log = createLogger("Tools");

interface DnsSetSiteParams {
  domain: string;
  adnl_address: string;
}

export const dnsSetSiteTool: Tool = {
  name: "dns_set_site",
  description:
    "Set or update the TON Site (ADNL) record for a .ton domain you own. Links the domain to a TON Site via its ADNL address.",
  parameters: Type.Object({
    domain: Type.String({
      description: "Domain name (with or without .ton extension)",
    }),
    adnl_address: Type.String({
      description: "ADNL address in hex format (64 characters)",
    }),
  }),
};

export const dnsSetSiteExecutor: ToolExecutor<DnsSetSiteParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const adnlAddress = normalizeAdnlAddress(params.adnl_address);
    const updated = await setDnsSite(params.domain, adnlAddress);

    return {
      success: true,
      data: {
        domain: updated.domain,
        adnlAddress,
        nftAddress: updated.nftAddress,
        from: updated.from,
        txHash: updated.tx.hash,
        message: `Set TON Site record for ${updated.domain} → ADNL ${adnlAddress} — confirmed on-chain\n  NFT: ${updated.nftAddress}\n  tx ${updated.tx.hash}\n  ${tonExplorerTxUrl(updated.tx.hash)}`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in dns_set_site");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
