import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1, TonClient, toNano, internal, beginCell } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { TONAPI_BASE_URL, tonapiHeaders } from "../../../constants/api-endpoints.js";

// Op code for change_dns_record
const DNS_CHANGE_RECORD_OP = 0x4eb1f0f9;

// sha256("wallet") - record key for wallet address
const WALLET_RECORD_KEY = BigInt(
  "0xe8d44050873dba865aa7c170ab4cce64d90839a34dcfd6cf71d14e0205443b1b"
);

/**
 * Parameters for dns_unlink tool
 */
interface DnsUnlinkParams {
  domain: string;
}

/**
 * Tool definition for dns_unlink
 */
export const dnsUnlinkTool: Tool = {
  name: "dns_unlink",
  description:
    "Remove the wallet link from a .ton domain you own. This deletes the wallet record so the domain no longer resolves to any address.",
  parameters: Type.Object({
    domain: Type.String({
      description: "Domain name (with or without .ton extension)",
    }),
  }),
};

/**
 * Executor for dns_unlink tool
 */
export const dnsUnlinkExecutor: ToolExecutor<DnsUnlinkParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    let { domain } = params;

    // Normalize domain
    domain = domain.toLowerCase().replace(/\.ton$/, "");
    const fullDomain = `${domain}.ton`;

    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // Get domain info from TonAPI
    const dnsResponse = await fetchWithTimeout(`${TONAPI_BASE_URL}/dns/${fullDomain}`, {
      headers: tonapiHeaders(),
    });

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

    // Convert mnemonic to private key
    const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);

    // Create wallet contract
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    // Get decentralized endpoint
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const client = new TonClient({ endpoint });
    const contract = client.open(wallet);

    // Get current seqno
    const seqno = await contract.getSeqno();

    // Build change_dns_record message body WITHOUT value cell (triggers deletion)
    // Contract checks: if (slice_refs() > 0) set record, else delete record
    const body = beginCell()
      .storeUint(DNS_CHANGE_RECORD_OP, 32) // op = change_dns_record
      .storeUint(0, 64) // query_id
      .storeUint(WALLET_RECORD_KEY, 256) // key = sha256("wallet")
      // NO storeRef() - absence of value cell triggers deletion
      .endCell();

    // Send transaction to NFT address
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: [
        internal({
          to: Address.parse(nftAddress),
          value: toNano("0.05"), // Gas for DNS record update
          body,
          bounce: true,
        }),
      ],
    });

    return {
      success: true,
      data: {
        domain: fullDomain,
        nftAddress,
        from: walletData.address,
        message: `Unlinked wallet from ${fullDomain}\n  NFT: ${nftAddress}\n  Transaction sent (changes apply in a few seconds)`,
      },
    };
  } catch (error) {
    console.error("Error in dns_unlink:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
