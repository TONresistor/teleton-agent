import type Database from "better-sqlite3";
import type {
  TonSDK,
  TonBalance,
  TonPrice,
  TonSendResult,
  TonTransaction,
  SDKVerifyPaymentParams,
  SDKPaymentVerification,
  JettonBalance,
  JettonInfo,
  JettonSendResult,
  NftItem,
  PluginLogger,
} from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import {
  getWalletAddress,
  getWalletBalance,
  getTonPrice,
  loadWallet,
  getKeyPair,
} from "../ton/wallet-service.js";
import { sendTon } from "../ton/transfer.js";
import { PAYMENT_TOLERANCE_RATIO } from "../constants/limits.js";
import { withBlockchainRetry } from "../utils/retry.js";
import { tonapiFetch } from "../constants/api-endpoints.js";
import { toNano as tonToNano, fromNano as tonFromNano } from "@ton/ton";
import { Address as TonAddress } from "@ton/core";
import { withTxLock } from "../ton/tx-lock.js";

const DEFAULT_MAX_AGE_MINUTES = 10;

const DEFAULT_TX_RETENTION_DAYS = 30;

const CLEANUP_PROBABILITY = 0.1;

function cleanupOldTransactions(
  db: Database.Database,
  retentionDays: number,
  log: PluginLogger
): void {
  if (Math.random() > CLEANUP_PROBABILITY) return;

  try {
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 24 * 60 * 60;
    const result = db.prepare("DELETE FROM used_transactions WHERE used_at < ?").run(cutoff);

    if (result.changes > 0) {
      log.debug(`Cleaned up ${result.changes} old transaction records (>${retentionDays}d)`);
    }
  } catch (err) {
    log.error("Transaction cleanup failed:", err);
  }
}

export function createTonSDK(log: PluginLogger, db: Database.Database | null): TonSDK {
  return {
    getAddress(): string | null {
      try {
        return getWalletAddress();
      } catch (err) {
        log.error("ton.getAddress() failed:", err);
        return null;
      }
    },

    async getBalance(address?: string): Promise<TonBalance | null> {
      try {
        const addr = address ?? getWalletAddress();
        if (!addr) return null;
        return await getWalletBalance(addr);
      } catch (err) {
        log.error("ton.getBalance() failed:", err);
        return null;
      }
    },

    async getPrice(): Promise<TonPrice | null> {
      try {
        return await getTonPrice();
      } catch (err) {
        log.error("ton.getPrice() failed:", err);
        return null;
      }
    },

    async sendTON(to: string, amount: number, comment?: string): Promise<TonSendResult> {
      const walletAddr = getWalletAddress();
      if (!walletAddr) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      // Validate amount
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new PluginSDKError("Amount must be a positive number", "OPERATION_FAILED");
      }

      try {
        const { Address } = await import("@ton/core");
        Address.parse(to);
      } catch {
        throw new PluginSDKError("Invalid TON address format", "INVALID_ADDRESS");
      }

      try {
        const txRef = await sendTon({
          toAddress: to,
          amount,
          comment,
          bounce: false,
        });

        if (!txRef) {
          throw new PluginSDKError(
            "Transaction failed — no reference returned",
            "OPERATION_FAILED"
          );
        }

        return { txRef, amount };
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send TON: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getTransactions(address: string, limit?: number): Promise<TonTransaction[]> {
      try {
        const { TonClient } = await import("@ton/ton");
        const { Address } = await import("@ton/core");
        const { getCachedHttpEndpoint } = await import("../ton/endpoint.js");
        const { formatTransactions } = await import("../ton/format-transactions.js");

        const addressObj = Address.parse(address);
        const endpoint = await getCachedHttpEndpoint();
        const client = new TonClient({ endpoint });

        const transactions = await withBlockchainRetry(
          () =>
            client.getTransactions(addressObj, {
              limit: Math.min(limit ?? 10, 50),
            }),
          "sdk.ton.getTransactions"
        );

        return formatTransactions(transactions);
      } catch (err) {
        log.error("ton.getTransactions() failed:", err);
        return [];
      }
    },

    async verifyPayment(params: SDKVerifyPaymentParams): Promise<SDKPaymentVerification> {
      if (!db) {
        throw new PluginSDKError(
          "No database available — verifyPayment requires migrate() with used_transactions table",
          "OPERATION_FAILED"
        );
      }

      const address = getWalletAddress();
      if (!address) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      const maxAgeMinutes = params.maxAgeMinutes ?? DEFAULT_MAX_AGE_MINUTES;

      // Opportunistic cleanup of old transactions
      cleanupOldTransactions(db, DEFAULT_TX_RETENTION_DAYS, log);

      try {
        const txs = await this.getTransactions(address, 20);

        for (const tx of txs) {
          if (tx.type !== "ton_received") continue;
          if (!tx.amount || !tx.from) continue;

          // Parse amount: "1.5 TON" → 1.5
          const tonAmount = parseFloat(tx.amount.replace(/ TON$/, ""));
          if (isNaN(tonAmount)) continue;

          // Amount match (1% tolerance)
          if (tonAmount < params.amount * PAYMENT_TOLERANCE_RATIO) continue;

          // Time window
          if (tx.secondsAgo > maxAgeMinutes * 60) continue;

          // Memo match (case-insensitive, strip @)
          const memo = (tx.comment ?? "").trim().toLowerCase().replace(/^@/, "");
          const expected = params.memo.toLowerCase().replace(/^@/, "");
          if (memo !== expected) continue;

          // Replay protection: use actual blockchain transaction hash
          const txHash = tx.hash;
          const result = db
            .prepare(
              `INSERT OR IGNORE INTO used_transactions (tx_hash, user_id, amount, game_type, used_at)
               VALUES (?, ?, ?, ?, unixepoch())`
            )
            .run(txHash, params.memo, tonAmount, params.gameType);

          if (result.changes === 0) continue; // Already used

          return {
            verified: true,
            txHash,
            amount: tonAmount,
            playerWallet: tx.from,
            date: tx.date,
            secondsAgo: tx.secondsAgo,
          };
        }

        return {
          verified: false,
          error: `Payment not found. Send ${params.amount} TON to ${address} with memo: ${params.memo}`,
        };
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("ton.verifyPayment() failed:", err);
        return {
          verified: false,
          error: `Verification failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    // ─── Jettons ─────────────────────────────────────────────────

    async getJettonBalances(ownerAddress?: string): Promise<JettonBalance[]> {
      try {
        const addr = ownerAddress ?? getWalletAddress();
        if (!addr) return [];

        const response = await tonapiFetch(`/accounts/${addr}/jettons`);
        if (!response.ok) {
          log.error(`ton.getJettonBalances() TonAPI error: ${response.status}`);
          return [];
        }

        const data = await response.json();
        const balances: JettonBalance[] = [];

        for (const item of data.balances || []) {
          const { balance, wallet_address, jetton } = item;
          if (jetton.verification === "blacklist") continue;

          const decimals = jetton.decimals ?? 9;
          const rawBalance = BigInt(balance);
          const divisor = BigInt(10 ** decimals);
          const wholePart = rawBalance / divisor;
          const fractionalPart = rawBalance % divisor;

          const balanceFormatted =
            fractionalPart === BigInt(0)
              ? wholePart.toString()
              : `${wholePart}.${fractionalPart.toString().padStart(decimals, "0").replace(/0+$/, "")}`;

          balances.push({
            jettonAddress: jetton.address,
            walletAddress: wallet_address.address,
            balance,
            balanceFormatted,
            symbol: jetton.symbol || "UNKNOWN",
            name: jetton.name || "Unknown Token",
            decimals,
            verified: jetton.verification === "whitelist",
            usdPrice: item.price?.prices?.USD ? Number(item.price.prices.USD) : undefined,
          });
        }

        return balances;
      } catch (err) {
        log.error("ton.getJettonBalances() failed:", err);
        return [];
      }
    },

    async getJettonInfo(jettonAddress: string): Promise<JettonInfo | null> {
      try {
        const response = await tonapiFetch(`/jettons/${jettonAddress}`);
        if (response.status === 404) return null;
        if (!response.ok) {
          log.error(`ton.getJettonInfo() TonAPI error: ${response.status}`);
          return null;
        }

        const data = await response.json();
        const metadata = data.metadata || {};
        const decimals = parseInt(metadata.decimals || "9");

        return {
          address: metadata.address || jettonAddress,
          name: metadata.name || "Unknown",
          symbol: metadata.symbol || "UNKNOWN",
          decimals,
          totalSupply: data.total_supply || "0",
          holdersCount: data.holders_count || 0,
          verified: data.verification === "whitelist",
          description: metadata.description || undefined,
          image: data.preview || metadata.image || undefined,
        };
      } catch (err) {
        log.error("ton.getJettonInfo() failed:", err);
        return null;
      }
    },

    async sendJetton(
      jettonAddress: string,
      to: string,
      amount: number,
      opts?: { comment?: string }
    ): Promise<JettonSendResult> {
      const { Address, beginCell, SendMode } = await import("@ton/core");
      const { WalletContractV5R1, TonClient, toNano, internal } = await import("@ton/ton");
      const { getCachedHttpEndpoint } = await import("../ton/endpoint.js");

      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new PluginSDKError("Amount must be a positive number", "OPERATION_FAILED");
      }

      try {
        Address.parse(to);
      } catch {
        throw new PluginSDKError("Invalid recipient address", "INVALID_ADDRESS");
      }

      try {
        // Get sender's jetton wallet from balances
        const jettonsResponse = await tonapiFetch(`/accounts/${walletData.address}/jettons`);
        if (!jettonsResponse.ok) {
          throw new PluginSDKError(
            `Failed to fetch jetton balances: ${jettonsResponse.status}`,
            "OPERATION_FAILED"
          );
        }

        const jettonsData = await jettonsResponse.json();
        const jettonBalance = jettonsData.balances?.find(
          (b: any) =>
            b.jetton.address.toLowerCase() === jettonAddress.toLowerCase() ||
            Address.parse(b.jetton.address).toString() === Address.parse(jettonAddress).toString()
        );

        if (!jettonBalance) {
          throw new PluginSDKError(
            `You don't own any of this jetton: ${jettonAddress}`,
            "OPERATION_FAILED"
          );
        }

        const senderJettonWallet = jettonBalance.wallet_address.address;
        const decimals = jettonBalance.jetton.decimals ?? 9;
        const currentBalance = BigInt(jettonBalance.balance);
        const amountStr = amount.toFixed(decimals);
        const [whole, frac = ""] = amountStr.split(".");
        const amountInUnits = BigInt(whole + (frac + "0".repeat(decimals)).slice(0, decimals));

        if (amountInUnits > currentBalance) {
          throw new PluginSDKError(
            `Insufficient balance. Have ${Number(currentBalance) / 10 ** decimals}, need ${amount}`,
            "OPERATION_FAILED"
          );
        }

        const comment = opts?.comment;

        // Build forward payload (comment)
        let forwardPayload = beginCell().endCell();
        if (comment) {
          forwardPayload = beginCell().storeUint(0, 32).storeStringTail(comment).endCell();
        }

        // TEP-74 transfer message body
        const JETTON_TRANSFER_OP = 0xf8a7ea5;
        const messageBody = beginCell()
          .storeUint(JETTON_TRANSFER_OP, 32)
          .storeUint(0, 64) // query_id
          .storeCoins(amountInUnits)
          .storeAddress(Address.parse(to))
          .storeAddress(Address.parse(walletData.address)) // response_destination
          .storeBit(false) // no custom_payload
          .storeCoins(comment ? toNano("0.01") : BigInt(1)) // forward_ton_amount
          .storeBit(comment ? true : false)
          .storeMaybeRef(comment ? forwardPayload : null)
          .endCell();

        const keyPair = await getKeyPair();
        if (!keyPair) {
          throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
        }

        const seqno = await withTxLock(async () => {
          const wallet = WalletContractV5R1.create({
            workchain: 0,
            publicKey: keyPair.publicKey,
          });

          const endpoint = await getCachedHttpEndpoint();
          const client = new TonClient({ endpoint });
          const walletContract = client.open(wallet);
          const seq = await walletContract.getSeqno();

          await walletContract.sendTransfer({
            seqno: seq,
            secretKey: keyPair.secretKey,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            messages: [
              internal({
                to: Address.parse(senderJettonWallet),
                value: toNano("0.05"),
                body: messageBody,
                bounce: true,
              }),
            ],
          });

          return seq;
        });

        return { success: true, seqno };
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send jetton: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getJettonWalletAddress(
      ownerAddress: string,
      jettonAddress: string
    ): Promise<string | null> {
      try {
        const response = await tonapiFetch(`/accounts/${ownerAddress}/jettons`);
        if (!response.ok) {
          log.error(`ton.getJettonWalletAddress() TonAPI error: ${response.status}`);
          return null;
        }

        const { Address } = await import("@ton/core");
        const data = await response.json();

        const match = (data.balances || []).find(
          (b: any) =>
            b.jetton.address.toLowerCase() === jettonAddress.toLowerCase() ||
            Address.parse(b.jetton.address).toString() === Address.parse(jettonAddress).toString()
        );

        return match ? match.wallet_address.address : null;
      } catch (err) {
        log.error("ton.getJettonWalletAddress() failed:", err);
        return null;
      }
    },

    // ─── NFT ─────────────────────────────────────────────────────

    async getNftItems(ownerAddress?: string): Promise<NftItem[]> {
      try {
        const addr = ownerAddress ?? getWalletAddress();
        if (!addr) return [];

        const response = await tonapiFetch(
          `/accounts/${encodeURIComponent(addr)}/nfts?limit=100&indirect_ownership=true`
        );
        if (!response.ok) {
          log.error(`ton.getNftItems() TonAPI error: ${response.status}`);
          return [];
        }

        const data = await response.json();
        if (!Array.isArray(data.nft_items)) return [];

        return data.nft_items
          .filter((item: any) => item.trust !== "blacklist")
          .map((item: any) => mapNftItem(item));
      } catch (err) {
        log.error("ton.getNftItems() failed:", err);
        return [];
      }
    },

    async getNftInfo(nftAddress: string): Promise<NftItem | null> {
      try {
        const response = await tonapiFetch(`/nfts/${nftAddress}`);
        if (response.status === 404) return null;
        if (!response.ok) {
          log.error(`ton.getNftInfo() TonAPI error: ${response.status}`);
          return null;
        }

        const item = await response.json();
        return mapNftItem(item);
      } catch (err) {
        log.error("ton.getNftInfo() failed:", err);
        return null;
      }
    },

    // ─── Utilities ───────────────────────────────────────────────

    toNano(amount: number | string): bigint {
      try {
        return tonToNano(String(amount));
      } catch (err) {
        throw new PluginSDKError(
          `toNano conversion failed: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    fromNano(nano: bigint | string): string {
      return tonFromNano(nano);
    },

    validateAddress(address: string): boolean {
      try {
        TonAddress.parse(address);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function mapNftItem(item: any): NftItem {
  const meta = item.metadata || {};
  const coll = item.collection || {};
  const previews: any[] = item.previews || [];
  const preview =
    (previews.length > 1 && previews[1].url) ||
    (previews.length > 0 && previews[0].url) ||
    undefined;

  return {
    address: item.address,
    index: item.index ?? 0,
    ownerAddress: item.owner?.address || undefined,
    collectionAddress: coll.address || undefined,
    collectionName: coll.name || undefined,
    name: meta.name || undefined,
    description: meta.description ? meta.description.slice(0, 200) : undefined,
    image: preview || meta.image || undefined,
    verified: item.trust === "whitelist",
  };
}
