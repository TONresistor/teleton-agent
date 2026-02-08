/**
 * TON transfer utilities for sending TON to addresses
 */

import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1, TonClient, toNano, internal } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getHttpEndpoint } from "@orbs-network/ton-access";
import { loadWallet } from "./wallet-service.js";

export interface SendTonParams {
  toAddress: string;
  amount: number; // In TON (not nano)
  comment?: string;
  bounce?: boolean;
}

/**
 * Send TON to an address
 * Returns transaction hash (hex string)
 */
export async function sendTon(params: SendTonParams): Promise<string | null> {
  try {
    const { toAddress, amount, comment = "", bounce = false } = params;

    // Validate recipient address
    let recipientAddress: Address;
    try {
      recipientAddress = Address.parse(toAddress);
    } catch (e) {
      console.error(`Invalid recipient address: ${toAddress}`, e);
      return null;
    }

    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      console.error("Wallet not initialized");
      return null;
    }

    // Convert mnemonic to private key
    const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);

    // Create wallet contract
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    // Get endpoint and client
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const client = new TonClient({ endpoint });
    const contract = client.open(wallet);

    // Get current seqno
    const seqno = await contract.getSeqno();

    // Send transfer
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages: [
        internal({
          to: recipientAddress,
          value: toNano(amount),
          body: comment,
          bounce,
        }),
      ],
    });

    // Generate pseudo-hash (actual hash would require polling for confirmation)
    // Format: seqno_timestamp_amount
    const pseudoHash = `${seqno}_${Date.now()}_${amount.toFixed(2)}`;

    console.log(`💸 [TON] Sent ${amount} TON to ${toAddress.slice(0, 8)}... - seqno: ${seqno}`);

    return pseudoHash;
  } catch (error) {
    console.error("Error sending TON:", error);
    return null;
  }
}

/**
 * Send TON to multiple addresses in a single transaction
 */
export async function sendTonBatch(transfers: SendTonParams[]): Promise<string | null> {
  try {
    if (transfers.length === 0) {
      console.error("No transfers provided");
      return null;
    }

    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      console.error("Wallet not initialized");
      return null;
    }

    // Convert mnemonic to private key
    const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);

    // Create wallet contract
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    // Get endpoint and client
    const endpoint = await getHttpEndpoint({ network: "mainnet" });
    const client = new TonClient({ endpoint });
    const contract = client.open(wallet);

    // Get current seqno
    const seqno = await contract.getSeqno();

    // Build messages
    const messages = transfers.map((t) => {
      const { toAddress, amount, comment = "", bounce = false } = t;

      let recipientAddress: Address;
      try {
        recipientAddress = Address.parse(toAddress);
      } catch (e) {
        throw new Error(`Invalid recipient address: ${toAddress}`);
      }

      return internal({
        to: recipientAddress,
        value: toNano(amount),
        body: comment,
        bounce,
      });
    });

    // Send batch transfer
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
      messages,
    });

    // Generate pseudo-hash
    const totalAmount = transfers.reduce((sum, t) => sum + t.amount, 0);
    const pseudoHash = `${seqno}_${Date.now()}_batch_${totalAmount.toFixed(2)}`;

    console.log(
      `💸 [TON] Sent batch of ${transfers.length} transfers (${totalAmount.toFixed(2)} TON total) - seqno: ${seqno}`
    );

    return pseudoHash;
  } catch (error) {
    console.error("Error sending TON batch:", error);
    return null;
  }
}
