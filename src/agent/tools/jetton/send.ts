import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1, TonClient, toNano, internal } from "@ton/ton";
import { Address, SendMode, beginCell } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { TONAPI_BASE_URL, tonapiHeaders } from "../../../constants/api-endpoints.js";

// Jetton transfer op code (TEP-74)
const JETTON_TRANSFER_OP = 0xf8a7ea5;

/**
 * Parameters for jetton_send tool
 */
interface JettonSendParams {
  jetton_address: string;
  to: string;
  amount: number;
  comment?: string;
}

/**
 * Tool definition for jetton_send
 */
export const jettonSendTool: Tool = {
  name: "jetton_send",
  description:
    "Send Jettons (tokens) to another address. Requires the jetton master address, recipient address, and amount. Amount is in human-readable units (e.g., 10 for 10 USDT). Use jetton_balances first to see what tokens you own and their addresses.",
  parameters: Type.Object({
    jetton_address: Type.String({
      description: "Jetton master contract address (EQ... or 0:... format)",
    }),
    to: Type.String({
      description: "Recipient TON address (EQ... or UQ... format)",
    }),
    amount: Type.Number({
      description: "Amount to send in human-readable units (e.g., 10 for 10 tokens)",
      minimum: 0,
    }),
    comment: Type.Optional(
      Type.String({
        description: "Optional comment/memo to include with the transfer",
      })
    ),
  }),
};

/**
 * Executor for jetton_send tool
 */
export const jettonSendExecutor: ToolExecutor<JettonSendParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { jetton_address, to, amount, comment } = params;

    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // Validate recipient address
    try {
      Address.parse(to);
    } catch {
      return {
        success: false,
        error: `Invalid recipient address: ${to}`,
      };
    }

    // Get sender's jetton wallet address from TonAPI
    const jettonsResponse = await fetchWithTimeout(
      `${TONAPI_BASE_URL}/accounts/${walletData.address}/jettons`,
      {
        headers: tonapiHeaders(),
      }
    );

    if (!jettonsResponse.ok) {
      return {
        success: false,
        error: `Failed to fetch jetton balances: ${jettonsResponse.status}`,
      };
    }

    const jettonsData = await jettonsResponse.json();

    // Find the jetton in our balances
    const jettonBalance = jettonsData.balances?.find(
      (b: any) =>
        b.jetton.address.toLowerCase() === jetton_address.toLowerCase() ||
        Address.parse(b.jetton.address).toString() === Address.parse(jetton_address).toString()
    );

    if (!jettonBalance) {
      return {
        success: false,
        error: `You don't own any of this jetton: ${jetton_address}. Use jetton_balances to see your tokens.`,
      };
    }

    const senderJettonWallet = jettonBalance.wallet_address.address;
    const decimals = jettonBalance.jetton.decimals || 9;
    const symbol = jettonBalance.jetton.symbol || "JETTON";
    const currentBalance = BigInt(jettonBalance.balance);

    // Convert amount to blockchain units
    const amountInUnits = BigInt(Math.floor(amount * 10 ** decimals));

    // Check sufficient balance
    if (amountInUnits > currentBalance) {
      const balanceHuman = Number(currentBalance) / 10 ** decimals;
      return {
        success: false,
        error: `Insufficient ${symbol} balance. You have ${balanceHuman.toFixed(4)} but trying to send ${amount}`,
      };
    }

    // Build forward payload (comment)
    let forwardPayload = beginCell().endCell();
    if (comment) {
      forwardPayload = beginCell()
        .storeUint(0, 32) // text comment op code
        .storeStringTail(comment)
        .endCell();
    }

    // Build jetton transfer message body (TEP-74)
    const messageBody = beginCell()
      .storeUint(JETTON_TRANSFER_OP, 32) // op: transfer
      .storeUint(0, 64) // query_id
      .storeCoins(amountInUnits) // jetton amount
      .storeAddress(Address.parse(to)) // destination
      .storeAddress(Address.parse(walletData.address)) // response_destination (excess returns here)
      .storeBit(false) // no custom_payload
      .storeCoins(comment ? toNano("0.01") : BigInt(1)) // forward_ton_amount (for notification)
      .storeBit(comment ? true : false) // forward_payload flag
      .storeMaybeRef(comment ? forwardPayload : null) // forward_payload
      .endCell();

    // Prepare wallet
    const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const client = new TonClient({ endpoint });
    const walletContract = client.open(wallet);

    const seqno = await walletContract.getSeqno();

    // Send transfer to our jetton wallet (NOT to recipient!)
    await walletContract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: [
        internal({
          to: Address.parse(senderJettonWallet),
          value: toNano("0.05"), // Gas for jetton transfer
          body: messageBody,
          bounce: true,
        }),
      ],
    });

    return {
      success: true,
      data: {
        jetton: symbol,
        jettonAddress: jetton_address,
        amount: amount.toString(),
        to,
        from: walletData.address,
        comment: comment || null,
        message: `Sent ${amount} ${symbol} to ${to}${comment ? ` (${comment})` : ""}\n  Transaction sent (check balance in ~30 seconds)`,
      },
    };
  } catch (error) {
    console.error("Error in jetton_send:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
