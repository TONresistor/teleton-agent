/**
 * Payout sender - Sends TON winnings to casino players
 * Used by casino_spin and casino_dice (auto-payout on win)
 */

import { loadWallet } from "../ton/wallet-service.js";
import { mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV5R1, TonClient, toNano, internal } from "@ton/ton";
import { Address, SendMode } from "@ton/core";
import { getCachedHttpEndpoint } from "../ton/endpoint.js";
import { withBlockchainRetry } from "./retry.js";

export interface PayoutResult {
  success: boolean;
  txHash?: string;
  amount?: number;
  seqno?: number;
  walletAddress?: string;
  timestamp?: number;
  error?: string;
}

/**
 * Send TON payout to a winner
 */
export async function sendPayout(
  playerAddress: string,
  amount: number,
  message: string
): Promise<PayoutResult> {
  try {
    // Validate recipient address
    try {
      Address.parse(playerAddress);
    } catch (e) {
      return {
        success: false,
        error: `Invalid player address: ${playerAddress}`,
      };
    }

    // Load casino wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Casino wallet not initialized.",
      };
    }

    // Convert mnemonic to private key
    const keyPair = await mnemonicToPrivateKey(walletData.mnemonic);

    // Create wallet contract
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
    });

    // Get endpoint and client
    const endpoint = await getCachedHttpEndpoint();
    const client = new TonClient({ endpoint });
    const contract = client.open(wallet);

    // Get seqno + send transfer atomically (fresh seqno on each retry)
    const seqno = await withBlockchainRetry(async () => {
      const seq = await contract.getSeqno();
      await contract.sendTransfer({
        seqno: seq,
        secretKey: keyPair.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY,
        messages: [
          internal({
            to: Address.parse(playerAddress),
            value: toNano(amount),
            body: message,
            bounce: false,
          }),
        ],
      });
      return seq;
    }, "payout");

    // Generate traceable TX reference
    const walletAddr = wallet.address.toString({ bounceable: false });
    const walletShort = walletAddr.slice(-8);
    const timestamp = Date.now();
    const txRef = `payout_${timestamp}_${seqno}_${walletShort}`;

    return {
      success: true,
      txHash: txRef,
      amount,
      seqno,
      walletAddress: walletAddr,
      timestamp,
    };
  } catch (error) {
    console.error("Error sending payout:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get win type message based on multiplier
 */
export function getWinMessage(multiplier: number, amount: number): string {
  if (multiplier >= 5) {
    return `🎰 777! You won ${amount.toFixed(2)} TON (${multiplier}x)`;
  } else if (multiplier >= 2.5) {
    return `🎊 Big win! You won ${amount.toFixed(2)} TON (${multiplier}x)`;
  } else if (multiplier >= 1.8) {
    return `✨ Nice win! You won ${amount.toFixed(2)} TON (${multiplier}x)`;
  } else if (multiplier >= 1.2) {
    return `🎯 Small win! You won ${amount.toFixed(2)} TON (${multiplier}x)`;
  }
  return `You won ${amount.toFixed(2)} TON (${multiplier}x)`;
}
