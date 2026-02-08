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

// dns_smc_address prefix
const DNS_SMC_ADDRESS_PREFIX = 0x9fd3;

// sha256("wallet") - record key for wallet address
const WALLET_RECORD_KEY = BigInt(
  "0xe8d44050873dba865aa7c170ab4cce64d90839a34dcfd6cf71d14e0205443b1b"
);

/**
 * Parameters for dns_link tool
 */
interface DnsLinkParams {
  domain: string;
  wallet_address?: string;
}

/**
 * Tool definition for dns_link
 */
export const dnsLinkTool: Tool = {
  name: "dns_link",
  description:
    "Link a wallet address to a .ton domain you own. This sets the wallet record so the domain resolves to the specified address. If no wallet_address is provided, links to your own wallet.",
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

/**
 * Executor for dns_link tool
 */
export const dnsLinkExecutor: ToolExecutor<DnsLinkParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    let { domain, wallet_address } = params;

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
        linkedWallet: targetAddress,
        nftAddress,
        from: walletData.address,
        message: `Linked ${fullDomain} → ${targetAddress}\n  NFT: ${nftAddress}\n  Transaction sent (changes apply in a few seconds)`,
      },
    };
  } catch (error) {
    console.error("Error in dns_link:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
