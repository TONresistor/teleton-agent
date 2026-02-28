import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet, getKeyPair, getCachedTonClient } from "../../../ton/wallet-service.js";
import { WalletContractV5R1, toNano, internal, beginCell } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { tonapiFetch } from "../../../constants/api-endpoints.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { withTxLock } from "../../../ton/tx-lock.js";

const log = createLogger("Tools");

// Op code for change_dns_record
const DNS_CHANGE_RECORD_OP = 0x4eb1f0f9;

// dns_adnl_address prefix (#ad01)
const DNS_ADNL_ADDRESS_PREFIX = 0xad01;

// sha256("site") - record key for site/ADNL address
const SITE_RECORD_KEY = BigInt(
  "0xfbae041b02c41ed0fd8a4efb039bc780dd6af4a1f0c420f42561ae705dda43fe"
);

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
  context
): Promise<ToolResult> => {
  try {
    let { domain, adnl_address } = params;

    // Normalize domain
    domain = domain.toLowerCase().replace(/\.ton$/, "");
    const fullDomain = `${domain}.ton`;

    // Validate ADNL address: must be 64 hex characters (256 bits)
    adnl_address = adnl_address.toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{64}$/.test(adnl_address)) {
      return {
        success: false,
        error: "Invalid ADNL address: must be exactly 64 hex characters (256-bit).",
      };
    }

    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // Get domain info from TonAPI
    const dnsResponse = await tonapiFetch(`/dns/${fullDomain}`);

    if (dnsResponse.status === 404) {
      return {
        success: false,
        error: `Domain ${fullDomain} does not exist or is not minted yet.`,
      };
    }

    if (!dnsResponse.ok) {
      return {
        success: false,
        error: `TonAPI error: ${dnsResponse.status}`,
      };
    }

    const dnsInfo = await dnsResponse.json();

    // Get NFT address
    const nftAddress = dnsInfo.item?.address;
    if (!nftAddress) {
      return {
        success: false,
        error: `Could not determine NFT address for ${fullDomain}`,
      };
    }

    // Verify ownership
    const ownerAddress = dnsInfo.item?.owner?.address;
    if (!ownerAddress) {
      return {
        success: false,
        error: `Domain ${fullDomain} has no owner (still in auction?)`,
      };
    }

    const ownerNormalized = Address.parse(ownerAddress).toString();
    const agentNormalized = Address.parse(walletData.address).toString();

    if (ownerNormalized !== agentNormalized) {
      return {
        success: false,
        error: `You don't own ${fullDomain}. Owner: ${ownerAddress}`,
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

    const client = await getCachedTonClient();
    const contract = client.open(wallet);

    const adnlBuffer = Buffer.from(adnl_address, "hex");

    await withTxLock(async () => {
      const seqno = await contract.getSeqno();

      // Build ADNL record value cell: dns_adnl_address#ad01 + adnl_addr:bits256 + flags:uint8
      const valueCell = beginCell()
        .storeUint(DNS_ADNL_ADDRESS_PREFIX, 16) // #ad01
        .storeBuffer(adnlBuffer, 32) // 256-bit ADNL address
        .storeUint(0, 8) // flags = 0 (no proto list)
        .endCell();

      // Build change_dns_record message body
      const body = beginCell()
        .storeUint(DNS_CHANGE_RECORD_OP, 32) // op = change_dns_record
        .storeUint(0, 64) // query_id
        .storeUint(SITE_RECORD_KEY, 256) // key = sha256("site")
        .storeRef(valueCell) // value cell reference
        .endCell();

      await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
          internal({
            to: Address.parse(nftAddress),
            value: toNano("0.05"),
            body,
            bounce: true,
          }),
        ],
      });
    });

    return {
      success: true,
      data: {
        domain: fullDomain,
        adnlAddress: adnl_address,
        nftAddress,
        from: walletData.address,
        message: `Set TON Site record for ${fullDomain} → ADNL ${adnl_address}\n  NFT: ${nftAddress}\n  Transaction sent (changes apply in a few seconds)`,
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
