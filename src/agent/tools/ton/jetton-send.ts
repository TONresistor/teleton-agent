import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet, getKeyPair, getCachedTonClient } from "../../../ton/wallet-service.js";
import { WalletContractV5R1, toNano, internal } from "@ton/ton";
import { Address, SendMode, beginCell } from "@ton/core";
import { tonapiFetch } from "../../../constants/api-endpoints.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";
import { withTxLock } from "../../../ton/tx-lock.js";

const log = createLogger("Tools");

// Jetton transfer op code (TEP-74)
const JETTON_TRANSFER_OP = 0xf8a7ea5;
interface JettonSendParams {
  jetton_address: string;
  to: string;
  amount: number;
  comment?: string;
}
export const jettonSendTool: Tool = {
  name: "jetton_send",
  description:
    "Send jettons to another address. Amount in human-readable units. Use jetton_balances first to find addresses.",
  parameters: Type.Object({
    jetton_address: Type.String({
      description: "Jetton master contract address (EQ... or 0:... format)",
    }),
    to: Type.String({
      description: "Recipient TON address (EQ... or UQ... format)",
    }),
    amount: Type.Number({
      description: "Amount to send in human-readable units (e.g., 10 for 10 tokens)",
      exclusiveMinimum: 0,
    }),
    comment: Type.Optional(
      Type.String({
        description: "Optional comment/memo to include with the transfer",
      })
    ),
  }),
};
export const jettonSendExecutor: ToolExecutor<JettonSendParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { jetton_address, to, amount, comment } = params;

    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    try {
      Address.parse(to);
    } catch {
      return {
        success: false,
        error: `Invalid recipient address: ${to}`,
      };
    }

    // Get sender's jetton wallet address from TonAPI
    const jettonsResponse = await tonapiFetch(
      `/accounts/${encodeURIComponent(walletData.address)}/jettons`
    );

    if (!jettonsResponse.ok) {
      return {
        success: false,
        error: `Failed to fetch jetton balances: ${jettonsResponse.status}`,
      };
    }

    const jettonsData = await jettonsResponse.json();

    // Find the jetton in our balances (safe: skip entries with malformed addresses)
    const jettonBalance = jettonsData.balances?.find((b: any) => {
      if (b.jetton.address.toLowerCase() === jetton_address.toLowerCase()) return true;
      try {
        return (
          Address.parse(b.jetton.address).toString() === Address.parse(jetton_address).toString()
        );
      } catch {
        return false;
      }
    });

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

    // Convert amount to blockchain units (string-based to avoid float precision loss)
    const amountStr = amount.toFixed(decimals);
    const [whole, frac = ""] = amountStr.split(".");
    const amountInUnits = BigInt(whole + (frac + "0".repeat(decimals)).slice(0, decimals));

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
      .storeBit(comment ? 1 : 0) // forward_payload: Either tag (0=inline, 1=ref)
      .storeRef(comment ? forwardPayload : beginCell().endCell()) // forward_payload
      .endCell();

    const keyPair = await getKeyPair();
    if (!keyPair) {
      return { success: false, error: "Wallet key derivation failed." };
    }
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    const client = await getCachedTonClient();
    const walletContract = client.open(wallet);

    return withTxLock(async () => {
      const seqno = await walletContract.getSeqno();

      // Send transfer to our jetton wallet (NOT to recipient!)
      await walletContract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
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
    });
  } catch (error) {
    log.error({ err: error }, "Error in jetton_send");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
