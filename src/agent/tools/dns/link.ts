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

// dns_smc_address prefix
const DNS_SMC_ADDRESS_PREFIX = 0x9fd3;

// sha256("wallet") - record key for wallet address
const WALLET_RECORD_KEY = BigInt(
  "0xe8d44050873dba865aa7c170ab4cce64d90839a34dcfd6cf71d14e0205443b1b"
);
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
  context
): Promise<ToolResult> => {
  try {
    let { domain, wallet_address } = params;

    // Normalize domain
    domain = domain.toLowerCase().replace(/\.ton$/, "");
    const fullDomain = `${domain}.ton`;

    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // Use agent's wallet if no address specified
    const targetAddress = wallet_address || walletData.address;

    // Validate target address
    try {
      Address.parse(targetAddress);
    } catch {
      return {
        success: false,
        error: `Invalid wallet address: ${targetAddress}`,
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

    // Verify ownership - only owner can change DNS records
    const ownerAddress = dnsInfo.item?.owner?.address;
    if (!ownerAddress) {
      return {
        success: false,
        error: `Domain ${fullDomain} has no owner (still in auction?)`,
      };
    }

    // Normalize addresses for comparison
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

    await withTxLock(async () => {
      const seqno = await contract.getSeqno();

      // Build wallet record value cell: dns_smc_address#9fd3 + address + flags
      const valueCell = beginCell()
        .storeUint(DNS_SMC_ADDRESS_PREFIX, 16) // #9fd3
        .storeAddress(Address.parse(targetAddress)) // MsgAddressInt
        .storeUint(0, 8) // flags = 0 (simple wallet)
        .endCell();

      // Build change_dns_record message body
      const body = beginCell()
        .storeUint(DNS_CHANGE_RECORD_OP, 32) // op = change_dns_record
        .storeUint(0, 64) // query_id
        .storeUint(WALLET_RECORD_KEY, 256) // key = sha256("wallet")
        .storeRef(valueCell) // value cell reference
        .endCell();

      // Send transaction to NFT address
      await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
          internal({
            to: Address.parse(nftAddress),
            value: toNano("0.05"), // Gas for DNS record update
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
        linkedWallet: targetAddress,
        nftAddress,
        from: walletData.address,
        message: `Linked ${fullDomain} → ${targetAddress}\n  NFT: ${nftAddress}\n  Transaction sent (changes apply in a few seconds)`,
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
