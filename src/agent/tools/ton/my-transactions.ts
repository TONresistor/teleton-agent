import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { TonClient, fromNano } from "@ton/ton";
import { Address } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";

// Known op codes
const OP_CODES = {
  COMMENT: 0x0,
  JETTON_TRANSFER: 0xf8a7ea5,
  JETTON_TRANSFER_NOTIFICATION: 0x7362d09c,
  JETTON_INTERNAL_TRANSFER: 0x178d4519,
  JETTON_BURN: 0x595f07bc,
  NFT_TRANSFER: 0x5fcc3d14,
  NFT_OWNERSHIP_ASSIGNED: 0x05138d91,
  EXCESSES: 0xd53276db,
  BOUNCE: 0xffffffff,
};

/**
 * Parameters for ton_my_transactions tool
 */
interface MyTransactionsParams {
  limit?: number;
}

/**
 * Tool definition for ton_my_transactions
 */
export const tonMyTransactionsTool: Tool = {
  name: "ton_my_transactions",
  description:
    "Get your own wallet's transaction history. Returns transactions with type (ton_received, ton_sent, jetton_received, jetton_sent, nft_received, nft_sent, gas_refund), amount, counterparty, and explorer link.",
  parameters: Type.Object({
    limit: Type.Optional(
      Type.Number({
        description: "Maximum number of transactions to return (default: 10, max: 50)",
        minimum: 1,
        maximum: 50,
      })
    ),
  }),
};

/**
 * Parse message body to extract op code and data
 */
function parseMessageBody(
  body: any
): { op: number; comment?: string; jettonAmount?: string; nftAddress?: string } | null {
  if (!body) return null;
  try {
    const slice = body.beginParse();
    if (slice.remainingBits < 32) return null;

    const op = slice.loadUint(32);

    // Simple comment (op = 0)
    if (op === OP_CODES.COMMENT && slice.remainingBits > 0) {
      return { op, comment: slice.loadStringTail() };
    }

    // Jetton transfer notification (received jettons)
    if (op === OP_CODES.JETTON_TRANSFER_NOTIFICATION) {
      const queryId = slice.loadUint(64);
      const amount = slice.loadCoins();
      const sender = slice.loadAddress();
      return { op, jettonAmount: amount.toString() };
    }

    // Jetton transfer (sending jettons)
    if (op === OP_CODES.JETTON_TRANSFER) {
      const queryId = slice.loadUint(64);
      const amount = slice.loadCoins();
      const destination = slice.loadAddress();
      return { op, jettonAmount: amount.toString() };
    }

    // NFT ownership assigned (received NFT)
    if (op === OP_CODES.NFT_OWNERSHIP_ASSIGNED) {
      const queryId = slice.loadUint(64);
      const prevOwner = slice.loadAddress();
      return { op };
    }

    // NFT transfer (sending NFT)
    if (op === OP_CODES.NFT_TRANSFER) {
      const queryId = slice.loadUint(64);
      const newOwner = slice.loadAddress();
      return { op, nftAddress: newOwner?.toString() };
    }

    return { op };
  } catch {
    return null;
  }
}

/**
 * Executor for ton_my_transactions tool
 */
export const tonMyTransactionsExecutor: ToolExecutor<MyTransactionsParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { limit = 10 } = params;

    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    const addressObj = Address.parse(walletData.address);

    // Get decentralized endpoint
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const client = new TonClient({ endpoint });

    // Get transactions
    const transactions = await client.getTransactions(addressObj, {
      limit: Math.min(limit, 50),
    });

    // Format transactions
    const formatted = transactions.map((tx) => {
      const inMsg = tx.inMessage;
      const outMsgArray = [...tx.outMessages.values()];
      const hash = tx.hash().toString("hex");
      const explorer = `https://tonviewer.com/transaction/${hash}`;
      const txTimeMs = tx.now * 1000;
      const date = new Date(txTimeMs).toISOString();
      const secondsAgo = Math.max(0, Math.floor((Date.now() - txTimeMs) / 1000));

      // Parse incoming message
      if (inMsg?.info.type === "internal") {
        const tonAmount = fromNano(inMsg.info.value.coins);
        const from = inMsg.info.src?.toString() || "unknown";
        const parsed = parseMessageBody(inMsg.body);

        // Gas refund (excesses)
        if (parsed?.op === OP_CODES.EXCESSES) {
          return {
            type: "gas_refund",
            amount: `${tonAmount} TON`,
            from,
            date,
            secondsAgo,
            explorer,
          };
        }

        // Jetton received
        if (parsed?.op === OP_CODES.JETTON_TRANSFER_NOTIFICATION) {
          return {
            type: "jetton_received",
            jettonAmount: parsed.jettonAmount,
            jettonWallet: from,
            date,
            secondsAgo,
            explorer,
          };
        }

        // NFT received
        if (parsed?.op === OP_CODES.NFT_OWNERSHIP_ASSIGNED) {
          return {
            type: "nft_received",
            nftAddress: from,
            date,
            secondsAgo,
            explorer,
          };
        }

        // Bounced message
        if (inMsg.info.bounced || parsed?.op === OP_CODES.BOUNCE) {
          return {
            type: "bounce",
            amount: `${tonAmount} TON`,
            from,
            date,
            secondsAgo,
            explorer,
          };
        }

        // Regular TON received
        return {
          type: "ton_received",
          amount: `${tonAmount} TON`,
          from,
          comment: parsed?.comment || null,
          date,
          secondsAgo,
          explorer,
        };
      }

      // Outgoing messages (sent transactions)
      if (outMsgArray.length > 0) {
        const results: any[] = [];

        for (const outMsg of outMsgArray) {
          if (outMsg.info.type !== "internal") continue;

          const info = outMsg.info as any;
          const to = info.dest?.toString() || "unknown";
          const tonAmount = fromNano(info.value.coins);
          const parsed = parseMessageBody(outMsg.body);

          // Jetton transfer
          if (parsed?.op === OP_CODES.JETTON_TRANSFER) {
            results.push({
              type: "jetton_sent",
              jettonAmount: parsed.jettonAmount,
              jettonWallet: to,
              date,
              secondsAgo,
              explorer,
            });
            continue;
          }

          // NFT transfer
          if (parsed?.op === OP_CODES.NFT_TRANSFER) {
            results.push({
              type: "nft_sent",
              nftAddress: to,
              date,
              secondsAgo,
              explorer,
            });
            continue;
          }

          // Regular TON sent
          results.push({
            type: "ton_sent",
            amount: `${tonAmount} TON`,
            to,
            comment: parsed?.comment || null,
            date,
            secondsAgo,
            explorer,
          });
        }

        // Return single or multiple
        if (results.length === 1) {
          return results[0];
        } else if (results.length > 1) {
          return {
            type: "multi_send",
            transfers: results,
            date,
            secondsAgo,
            explorer,
          };
        }
      }

      // Unknown/other
      return {
        type: "contract_call",
        date,
        secondsAgo,
        explorer,
      };
    });

    return {
      success: true,
      data: {
        address: walletData.address,
        transactions: formatted,
      },
    };
  } catch (error) {
    console.error("Error in ton_my_transactions:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
