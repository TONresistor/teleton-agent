import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1, TonClient, toNano, internal, beginCell } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";

const DNS_COLLECTION = "EQC3dNlesgVD8YbAazcauIrXBPfiVhMMr5YYk2in0Mtsz0Bz";

/**
 * Parameters for dns_start_auction tool
 */
interface DnsStartAuctionParams {
  domain: string;
  amount: number;
}

/**
 * Tool definition for dns_start_auction
 */
export const dnsStartAuctionTool: Tool = {
  name: "dns_start_auction",
  description:
    "Start an auction for an unminted .ton domain. Sends TON to the DNS collection contract to mint a new domain NFT. Domain must be 4-126 characters, available (not minted), and amount must meet minimum price.",
  parameters: Type.Object({
    domain: Type.String({
      description: "Domain name to mint (without .ton extension, 4-126 chars)",
    }),
    amount: Type.Number({
      description:
        "Bid amount in TON (must meet minimum: ~100 TON for 4 chars, ~1 TON for 11+ chars)",
      minimum: 1,
    }),
  }),
};

/**
 * Executor for dns_start_auction tool
 */
export const dnsStartAuctionExecutor: ToolExecutor<DnsStartAuctionParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    let { domain, amount } = params;

    // Normalize and validate domain
    domain = domain.toLowerCase().replace(/\.ton$/, "");

    if (domain.length < 4 || domain.length > 126) {
      return {
        success: false,
        error: "Domain must be 4-126 characters long",
      };
    }

    if (!/^[a-z0-9-]+$/.test(domain)) {
      return {
        success: false,
        error: "Domain can only contain lowercase letters, numbers, and hyphens",
      };
    }

    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
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

    // Build message body: op=0, domain as UTF-8 string
    const body = beginCell()
      .storeUint(0, 32) // op = 0
      .storeStringTail(domain) // domain without .ton
      .endCell();

    // Send transaction to DNS collection
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: [
        internal({
          to: Address.parse(DNS_COLLECTION),
          value: toNano(amount),
          body,
          bounce: true,
        }),
      ],
    });

    return {
      success: true,
      data: {
        domain: `${domain}.ton`,
        amount: `${amount} TON`,
        collection: DNS_COLLECTION,
        from: walletData.address,
        message: `Auction started for ${domain}.ton with ${amount} TON\n  From: ${walletData.address}\n  Collection: ${DNS_COLLECTION}\n  Transaction sent (check status in a few seconds)`,
      },
    };
  } catch (error) {
    console.error("Error in dns_start_auction:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
