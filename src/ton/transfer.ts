import { WalletContractV5R1, toNano, internal } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getKeyPair, getCachedTonClient, invalidateTonClientCache } from "./wallet-service.js";
import { createLogger } from "../utils/logger.js";
import { withTxLock } from "./tx-lock.js";

const log = createLogger("TON");

export interface SendTonParams {
  toAddress: string;
  amount: number;
  comment?: string;
  bounce?: boolean;
}

export async function sendTon(params: SendTonParams): Promise<string | null> {
  return withTxLock(async () => {
    try {
      const { toAddress, amount, comment = "", bounce = false } = params;

      if (!Number.isFinite(amount) || amount <= 0) {
        log.error({ amount }, "Invalid transfer amount");
        return null;
      }

      let recipientAddress: Address;
      try {
        recipientAddress = Address.parse(toAddress);
      } catch (e) {
        log.error({ err: e }, `Invalid recipient address: ${toAddress}`);
        return null;
      }

      const keyPair = await getKeyPair();
      if (!keyPair) {
        log.error("Wallet not initialized");
        return null;
      }

      const wallet = WalletContractV5R1.create({
        workchain: 0,
        publicKey: keyPair.publicKey,
      });

      const client = await getCachedTonClient();
      const contract = client.open(wallet);

      const seqno = await contract.getSeqno();

      await contract.sendTransfer({
        seqno,
        secretKey: keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
          internal({
            to: recipientAddress,
            value: toNano(amount),
            body: comment,
            bounce,
          }),
        ],
      });

      const pseudoHash = `${seqno}_${Date.now()}_${amount.toFixed(2)}`;

      log.info(`Sent ${amount} TON to ${toAddress.slice(0, 8)}... - seqno: ${seqno}`);

      return pseudoHash;
    } catch (error: any) {
      // Invalidate node cache on 5xx so next attempt picks a fresh node
      if (error?.status >= 500 || error?.response?.status >= 500) {
        invalidateTonClientCache();
      }
      log.error({ err: error }, "Error sending TON");
      throw error;
    }
  }); // withTxLock
}
