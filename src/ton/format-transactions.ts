/**
 * Transaction formatting utilities shared between the ton_get_transactions
 * tool and the Plugin SDK's sdk.ton.getTransactions().
 */

import { fromNano } from "@ton/ton";
import type { Transaction } from "@ton/ton";

/** TON transaction type */
export type TransactionType =
  | "ton_received"
  | "ton_sent"
  | "jetton_received"
  | "jetton_sent"
  | "nft_received"
  | "nft_sent"
  | "gas_refund"
  | "bounce"
  | "contract_call"
  | "multi_send";

// Known op codes for message body parsing
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
 * Parse a TON message body to extract op code and data.
 */
export function parseMessageBody(
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
      const _queryId = slice.loadUint(64);
      const amount = slice.loadCoins();
      const _sender = slice.loadAddress();
      return { op, jettonAmount: amount.toString() };
    }

    // Jetton transfer (sending jettons)
    if (op === OP_CODES.JETTON_TRANSFER) {
      const _queryId = slice.loadUint(64);
      const amount = slice.loadCoins();
      const _destination = slice.loadAddress();
      return { op, jettonAmount: amount.toString() };
    }

    // NFT ownership assigned (received NFT)
    if (op === OP_CODES.NFT_OWNERSHIP_ASSIGNED) {
      const _queryId = slice.loadUint(64);
      const _prevOwner = slice.loadAddress();
      return { op };
    }

    // NFT transfer (sending NFT)
    if (op === OP_CODES.NFT_TRANSFER) {
      const _queryId = slice.loadUint(64);
      const newOwner = slice.loadAddress();
      return { op, nftAddress: newOwner?.toString() };
    }

    return { op };
  } catch {
    return null;
  }
}

/** Formatted transaction object */
export interface FormattedTransaction {
  type: TransactionType;
  /** Blockchain transaction hash (hex) */
  hash: string;
  amount?: string;
  from?: string;
  to?: string;
  comment?: string | null;
  date: string;
  secondsAgo: number;
  explorer: string;
  jettonAmount?: string;
  jettonWallet?: string;
  nftAddress?: string;
  transfers?: FormattedTransaction[];
}

/**
 * Format raw TON transactions into structured objects.
 */
export function formatTransactions(transactions: Transaction[]): FormattedTransaction[] {
  return transactions.map((tx) => {
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
          hash,
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
          hash,
          jettonAmount: parsed.jettonAmount,
          jettonWallet: from,
          date,
          secondsAgo,
          explorer,
        };
      }

      // NFT received
      if (parsed?.op === OP_CODES.NFT_OWNERSHIP_ASSIGNED) {
        return { type: "nft_received", hash, nftAddress: from, date, secondsAgo, explorer };
      }

      // Bounced message
      if (inMsg.info.bounced || parsed?.op === OP_CODES.BOUNCE) {
        return {
          type: "bounce",
          hash,
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
        hash,
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
      const results: FormattedTransaction[] = [];

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
            hash,
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
          results.push({ type: "nft_sent", hash, nftAddress: to, date, secondsAgo, explorer });
          continue;
        }

        // Regular TON sent
        results.push({
          type: "ton_sent",
          hash,
          amount: `${tonAmount} TON`,
          to,
          comment: parsed?.comment || null,
          date,
          secondsAgo,
          explorer,
        });
      }

      if (results.length === 1) return results[0];
      if (results.length > 1) {
        return { type: "multi_send", hash, transfers: results, date, secondsAgo, explorer };
      }
    }

    // Unknown/other
    return { type: "contract_call", hash, date, secondsAgo, explorer };
  });
}
