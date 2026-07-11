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
  SignedTransfer,
  NftItem,
  PluginLogger,
  TonMessage,
  TonSendOptions,
  TonTransferResult,
  GetMethodResult,
  TonSender,
} from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { getErrorMessage } from "../utils/errors.js";
import {
  getWalletAddress,
  getWalletBalance,
  getTonPrice,
  loadWallet,
  getKeyPair,
  getCachedTonClient,
  invalidateTonClientCache,
} from "../ton/wallet-service.js";
import { sendTon } from "../ton/transfer.js";
import { sendWalletTx } from "../ton/confirm.js";
import { PAYMENT_TOLERANCE_RATIO } from "../constants/limits.js";
import { withBlockchainRetry } from "../utils/retry.js";
import { tonapiFetch } from "../constants/api-endpoints.js";
import { createDexSDK } from "./ton-dex.js";
import { createDnsSDK } from "./ton-dns.js";
import {
  toNano as tonToNano,
  fromNano as tonFromNano,
  WalletContractV5R1,
  internal,
} from "@ton/ton";
import type { OpenedContract } from "@ton/ton";
import { Address as TonAddress, beginCell, SendMode, storeMessage } from "@ton/core";
import type { TupleItem, Cell as TonCell } from "@ton/core";
import { withTxLock } from "../ton/tx-lock.js";
import { formatTransactions } from "../ton/format-transactions.js";
import { isHttpError } from "../utils/errors.js";
import { fetchJettonMeta, findJettonBalance, formatTokenBalance } from "./ton/jetton-api.js";
import { mapNftItem, type TonApiNftItem } from "./ton/nft-api.js";
import { createJettonAnalyticsSDK } from "./ton/jetton-analytics.js";
import { createHighloadSDK } from "./ton-highload.js";

/**
 * Drop the cached TON node when an error is a 429 or 5xx, so the next attempt
 * picks a fresh node. No-op for non-HTTP errors. Shared by every send/get path.
 */
function invalidateOnTransientHttpError(error: unknown): void {
  const httpErr = isHttpError(error) ? error : undefined;
  const status = httpErr?.status || httpErr?.response?.status;
  if (status === 429 || (status !== undefined && status >= 500)) {
    invalidateTonClientCache();
  }
}

const DEFAULT_MAX_AGE_MINUTES = 10;

const DEFAULT_TX_RETENTION_DAYS = 30;

const CLEANUP_PROBABILITY = 0.1;

/** Seconds a signed transfer remains valid (`validUntil` window). */
const TX_VALID_UNTIL_SECONDS = 120;

type WalletKeyPair = NonNullable<Awaited<ReturnType<typeof getKeyPair>>>;
type WalletV5R1 = ReturnType<typeof WalletContractV5R1.create>;

/**
 * Build the V5R1 wallet, opened contract and current seqno for `keyPair`.
 * Single source for the create → getCachedTonClient → open → getSeqno sequence.
 */
async function buildWalletContext(keyPair: WalletKeyPair): Promise<{
  wallet: WalletV5R1;
  contract: OpenedContract<WalletV5R1>;
  seqno: number;
}> {
  const wallet = WalletContractV5R1.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const client = await getCachedTonClient();
  const contract = client.open(wallet);
  const seqno = await contract.getSeqno();
  return { wallet, contract, seqno };
}

/** Wrap a signed transfer cell into a broadcastable external-in BOC (base64). */
function wrapExternalMessage(wallet: WalletV5R1, transferCell: TonCell, seqno: number): string {
  const extMsg = beginCell()
    .store(
      storeMessage({
        info: {
          type: "external-in" as const,
          dest: wallet.address,
          importFee: 0n,
        },
        init: seqno === 0 ? wallet.init : undefined,
        body: transferCell,
      })
    )
    .endCell();

  return extMsg.toBoc().toString("base64");
}

/**
 * Internal core shared by `send` (1 message) and `sendMessages` (N messages):
 * derive key, build wallet context under the tx lock, broadcast and map errors.
 */
async function signAndSend(
  messages: TonMessage[],
  opts: { sendMode?: number; errorPrefix: string }
): Promise<TonTransferResult> {
  const keyPair = await getKeyPair();
  if (!keyPair) {
    throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
  }

  try {
    const client = await getCachedTonClient();
    const sent = await withTxLock(async () => {
      const { contract } = await buildWalletContext(keyPair);
      return sendWalletTx(client, contract, {
        secretKey: keyPair.secretKey,
        sendMode: opts.sendMode ?? SendMode.PAY_GAS_SEPARATELY,
        messages: messages.map((m) =>
          internal({
            to: TonAddress.parse(m.to),
            value: tonToNano(m.value.toString()),
            body: m.body,
            bounce: m.bounce ?? true,
            init: m.stateInit,
          })
        ),
      });
    });

    if (!sent) {
      throw new PluginSDKError(`${opts.errorPrefix}: not confirmed on-chain`, "OPERATION_FAILED");
    }
    return { hash: sent.hash, seqno: sent.seqno };
  } catch (error) {
    invalidateOnTransientHttpError(error);
    if (error instanceof PluginSDKError) throw error;
    throw new PluginSDKError(`${opts.errorPrefix}: ${getErrorMessage(error)}`, "OPERATION_FAILED");
  }
}

/**
 * Shared TEP-74 jetton-transfer preparation: validate inputs, resolve the
 * sender's jetton wallet, check the balance, and build the transfer message
 * body and signing key. The broadcast path (sendJetton) and the offline-sign
 * path (createJettonTransfer) share everything up to here and diverge only on
 * delivery.
 */
async function prepareJettonTransfer(
  jettonAddress: string,
  to: string,
  amount: number,
  opts?: { comment?: string }
): Promise<{
  walletData: NonNullable<ReturnType<typeof loadWallet>>;
  senderJettonWallet: string;
  messageBody: TonCell;
  keyPair: WalletKeyPair;
}> {
  const walletData = loadWallet();
  if (!walletData) {
    throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PluginSDKError("Amount must be a positive number", "OPERATION_FAILED");
  }

  try {
    TonAddress.parse(to);
  } catch {
    throw new PluginSDKError("Invalid recipient address", "INVALID_ADDRESS");
  }

  // Get sender's jetton wallet from balances
  const jettonsResponse = await tonapiFetch(
    `/accounts/${encodeURIComponent(walletData.address)}/jettons`
  );
  if (!jettonsResponse.ok) {
    throw new PluginSDKError(
      `Failed to fetch jetton balances: ${jettonsResponse.status}`,
      "OPERATION_FAILED"
    );
  }

  const jettonsData = await jettonsResponse.json();
  const jettonBalance = findJettonBalance(jettonsData.balances ?? [], jettonAddress);

  if (!jettonBalance) {
    throw new PluginSDKError(
      `You don't own any of this jetton: ${jettonAddress}`,
      "OPERATION_FAILED"
    );
  }

  const senderJettonWallet = (jettonBalance.wallet_address ?? { address: "" }).address;
  const decimals = jettonBalance.jetton.decimals ?? 9;
  const currentBalance = BigInt(jettonBalance.balance);
  const amountStr = amount.toFixed(decimals);
  const [whole, frac = ""] = amountStr.split(".");
  const amountInUnits = BigInt(whole + (frac + "0".repeat(decimals)).slice(0, decimals));

  if (amountInUnits > currentBalance) {
    const balStr = formatTokenBalance(currentBalance, decimals);
    throw new PluginSDKError(
      `Insufficient balance. Have ${balStr}, need ${amount}`,
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
    .storeAddress(TonAddress.parse(to))
    .storeAddress(TonAddress.parse(walletData.address)) // response_destination
    .storeBit(false) // no custom_payload
    .storeCoins(comment ? tonToNano("0.01") : BigInt(1)) // forward_ton_amount
    .storeBit(comment ? 1 : 0)
    .storeRef(comment ? forwardPayload : beginCell().endCell())
    .endCell();

  const keyPair = await getKeyPair();
  if (!keyPair) {
    throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
  }

  return { walletData, senderJettonWallet, messageBody, keyPair };
}

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
  } catch (error) {
    log.error("Transaction cleanup failed:", error);
  }
}

export function createTonSDK(
  log: PluginLogger,
  db: Database.Database | null,
  pluginName = "plugin"
): TonSDK {
  const highload = createHighloadSDK(
    log,
    db,
    (address, amount, bounce) =>
      signAndSend([{ to: address, value: amount, bounce }], {
        sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
        errorPrefix: "Failed to fund Highload wallet",
      }),
    pluginName
  );

  return {
    getAddress(): string | null {
      try {
        return getWalletAddress();
      } catch (error) {
        log.error("ton.getAddress() failed:", error);
        return null;
      }
    },

    async getBalance(address?: string): Promise<TonBalance | null> {
      try {
        const addr = address ?? getWalletAddress();
        if (!addr) return null;
        return await getWalletBalance(addr);
      } catch (error) {
        log.error("ton.getBalance() failed:", error);
        return null;
      }
    },

    async getPrice(): Promise<TonPrice | null> {
      try {
        return await getTonPrice();
      } catch (error) {
        log.error("ton.getPrice() failed:", error);
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
        TonAddress.parse(to);
      } catch {
        throw new PluginSDKError("Invalid TON address format", "INVALID_ADDRESS");
      }

      try {
        const result = await sendTon({
          toAddress: to,
          amount,
          comment,
          bounce: false,
        });

        if (!result) {
          throw new PluginSDKError(
            "Transaction failed or could not be confirmed on-chain",
            "OPERATION_FAILED"
          );
        }

        return { txRef: result.hash, amount };
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send TON: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getTransactions(address: string, limit?: number): Promise<TonTransaction[]> {
      try {
        const addressObj = TonAddress.parse(address);
        const client = await getCachedTonClient();

        const transactions = await withBlockchainRetry(
          () =>
            client.getTransactions(addressObj, {
              limit: Math.min(limit ?? 10, 50),
            }),
          "sdk.ton.getTransactions"
        );

        return formatTransactions(transactions);
      } catch (error) {
        log.error("ton.getTransactions() failed:", error);
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

      // Check that used_transactions table exists (created by plugin's migrate())
      const tableExists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='used_transactions'")
        .get();
      if (!tableExists) {
        throw new PluginSDKError(
          "used_transactions table not found — export a migrate() that creates it",
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
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        log.error("ton.verifyPayment() failed:", error);
        return {
          verified: false,
          error: `Verification failed: ${getErrorMessage(error)}`,
        };
      }
    },

    // ─── Jettons ─────────────────────────────────────────────────

    async getJettonBalances(ownerAddress?: string): Promise<JettonBalance[]> {
      try {
        const addr = ownerAddress ?? getWalletAddress();
        if (!addr) return [];

        const response = await tonapiFetch(`/accounts/${encodeURIComponent(addr)}/jettons`);
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
          const balanceFormatted = formatTokenBalance(BigInt(balance), decimals);

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
      } catch (error) {
        log.error("ton.getJettonBalances() failed:", error);
        return [];
      }
    },

    async getJettonInfo(jettonAddress: string): Promise<JettonInfo | null> {
      try {
        const { ok, status, meta } = await fetchJettonMeta(jettonAddress);
        if (status === 404) return null;
        if (!ok || !meta) {
          log.error(`ton.getJettonInfo() TonAPI error: ${status}`);
          return null;
        }

        return {
          address: meta.address,
          name: meta.name,
          symbol: meta.symbol,
          decimals: meta.decimals,
          totalSupply: meta.totalSupply,
          holdersCount: meta.holdersCount,
          verified: meta.verified,
          description: meta.description,
          image: meta.image,
        };
      } catch (error) {
        log.error("ton.getJettonInfo() failed:", error);
        return null;
      }
    },

    async sendJetton(
      jettonAddress: string,
      to: string,
      amount: number,
      opts?: { comment?: string }
    ): Promise<JettonSendResult> {
      try {
        const { senderJettonWallet, messageBody, keyPair } = await prepareJettonTransfer(
          jettonAddress,
          to,
          amount,
          opts
        );

        const client = await getCachedTonClient();
        const sent = await withTxLock(async () => {
          const { contract: walletContract } = await buildWalletContext(keyPair);
          return sendWalletTx(client, walletContract, {
            secretKey: keyPair.secretKey,
            messages: [
              internal({
                to: TonAddress.parse(senderJettonWallet),
                value: tonToNano("0.05"),
                body: messageBody,
                bounce: true,
              }),
            ],
          });
        });

        if (!sent) {
          throw new PluginSDKError(
            "Jetton transfer failed or could not be confirmed on-chain",
            "OPERATION_FAILED"
          );
        }

        return { success: true, seqno: sent.seqno, txRef: sent.hash };
      } catch (error) {
        invalidateOnTransientHttpError(error);
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send jetton: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getJettonWalletAddress(
      ownerAddress: string,
      jettonAddress: string
    ): Promise<string | null> {
      try {
        const response = await tonapiFetch(`/accounts/${encodeURIComponent(ownerAddress)}/jettons`);
        if (!response.ok) {
          log.error(`ton.getJettonWalletAddress() TonAPI error: ${response.status}`);
          return null;
        }

        const data = await response.json();

        const match = findJettonBalance(data.balances ?? [], jettonAddress);
        return match?.wallet_address?.address ?? null;
      } catch (error) {
        log.error("ton.getJettonWalletAddress() failed:", error);
        return null;
      }
    },

    // ─── Signed Transfers (no broadcast) ──────────────────────────

    async createTransfer(to: string, amount: number, comment?: string): Promise<SignedTransfer> {
      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new PluginSDKError("Amount must be a positive number", "OPERATION_FAILED");
      }

      try {
        TonAddress.parse(to);
      } catch {
        throw new PluginSDKError("Invalid TON address format", "INVALID_ADDRESS");
      }

      try {
        const keyPair = await getKeyPair();
        if (!keyPair) {
          throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
        }

        const txResult = await withTxLock(async () => {
          const { wallet, seqno } = await buildWalletContext(keyPair);

          const validUntil = Math.floor(Date.now() / 1000) + TX_VALID_UNTIL_SECONDS;

          const transferCell = wallet.createTransfer({
            seqno,
            timeout: validUntil,
            secretKey: keyPair.secretKey,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            messages: [
              internal({
                to: TonAddress.parse(to),
                value: tonToNano(amount),
                body: comment || "",
                bounce: false,
              }),
            ],
          });

          const boc = wrapExternalMessage(wallet, transferCell, seqno);
          return { boc, seqno, validUntil, walletAddress: wallet.address.toRawString() };
        });

        return {
          // v2 fields
          signedBoc: txResult.boc,
          walletPublicKey: walletData.publicKey,
          walletAddress: txResult.walletAddress,
          seqno: txResult.seqno,
          validUntil: txResult.validUntil,
          // backward compat (deprecated)
          boc: txResult.boc,
          publicKey: walletData.publicKey,
          walletVersion: "v5r1",
        };
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to create transfer: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async createJettonTransfer(
      jettonAddress: string,
      to: string,
      amount: number,
      opts?: { comment?: string }
    ): Promise<SignedTransfer> {
      try {
        const { walletData, senderJettonWallet, messageBody, keyPair } =
          await prepareJettonTransfer(jettonAddress, to, amount, opts);

        const txResult = await withTxLock(async () => {
          const { wallet, seqno } = await buildWalletContext(keyPair);

          const validUntil = Math.floor(Date.now() / 1000) + TX_VALID_UNTIL_SECONDS;

          const transferCell = wallet.createTransfer({
            seqno,
            timeout: validUntil,
            secretKey: keyPair.secretKey,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            messages: [
              internal({
                to: TonAddress.parse(senderJettonWallet),
                value: tonToNano("0.05"),
                body: messageBody,
                bounce: true,
              }),
            ],
          });

          const boc = wrapExternalMessage(wallet, transferCell, seqno);
          return { boc, seqno, validUntil, walletAddress: wallet.address.toRawString() };
        });

        return {
          // v2 fields
          signedBoc: txResult.boc,
          walletPublicKey: walletData.publicKey,
          walletAddress: txResult.walletAddress,
          seqno: txResult.seqno,
          validUntil: txResult.validUntil,
          // backward compat (deprecated)
          boc: txResult.boc,
          publicKey: walletData.publicKey,
          walletVersion: "v5r1",
        };
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to create jetton transfer: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    getPublicKey(): string | null {
      try {
        const wallet = loadWallet();
        return wallet?.publicKey ?? null;
      } catch (error) {
        log.error("ton.getPublicKey() failed:", error);
        return null;
      }
    },

    getWalletVersion(): string {
      return "v5r1";
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
          .filter((item: TonApiNftItem) => item.trust !== "blacklist")
          .map((item: TonApiNftItem) => mapNftItem(item));
      } catch (error) {
        log.error("ton.getNftItems() failed:", error);
        return [];
      }
    },

    async getNftInfo(nftAddress: string): Promise<NftItem | null> {
      try {
        const response = await tonapiFetch(`/nfts/${encodeURIComponent(nftAddress)}`);
        if (response.status === 404) return null;
        if (!response.ok) {
          log.error(`ton.getNftInfo() TonAPI error: ${response.status}`);
          return null;
        }

        const item = await response.json();
        return mapNftItem(item);
      } catch (error) {
        log.error("ton.getNftInfo() failed:", error);
        return null;
      }
    },

    // ─── Utilities ───────────────────────────────────────────────

    toNano(amount: number | string): bigint {
      try {
        return tonToNano(String(amount));
      } catch (error) {
        throw new PluginSDKError(
          `toNano conversion failed: ${getErrorMessage(error)}`,
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

    // ─── Jetton Analytics ─────────────────────────────────────────

    ...createJettonAnalyticsSDK(log),

    // ─── Low-level Transfer ─────────────────────────────────────────

    async getSeqno(): Promise<number> {
      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      try {
        const keyPair = await getKeyPair();
        if (!keyPair) {
          throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
        }

        const { seqno } = await buildWalletContext(keyPair);
        return seqno;
      } catch (error) {
        invalidateOnTransientHttpError(error);
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to get seqno: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async runGetMethod(
      address: string,
      method: string,
      stack?: TupleItem[]
    ): Promise<GetMethodResult> {
      try {
        TonAddress.parse(address);
      } catch {
        throw new PluginSDKError("Invalid TON address format", "INVALID_ADDRESS");
      }

      try {
        const client = await getCachedTonClient();
        const result = await client.runMethodWithError(
          TonAddress.parse(address),
          method,
          stack ?? []
        );

        // Extract TupleItem[] from TupleReader (items are private)
        const items: TupleItem[] = [];
        while (result.stack.remaining > 0) {
          items.push(result.stack.pop());
        }

        return { exitCode: result.exit_code, stack: items };
      } catch (error) {
        invalidateOnTransientHttpError(error);
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to run get method: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async send(
      to: string,
      value: number,
      opts?: {
        body?: TonCell | string;
        bounce?: boolean;
        stateInit?: { code: TonCell; data: TonCell };
        sendMode?: number;
      }
    ): Promise<TonTransferResult> {
      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      try {
        TonAddress.parse(to);
      } catch {
        throw new PluginSDKError("Invalid TON address format", "INVALID_ADDRESS");
      }

      if (!Number.isFinite(value) || value < 0) {
        throw new PluginSDKError("Amount must be a non-negative number", "OPERATION_FAILED");
      }

      if (opts?.sendMode !== undefined && (opts.sendMode < 0 || opts.sendMode > 3)) {
        throw new PluginSDKError("Unsafe sendMode", "OPERATION_FAILED");
      }

      return signAndSend(
        [{ to, value, body: opts?.body, bounce: opts?.bounce, stateInit: opts?.stateInit }],
        { sendMode: opts?.sendMode, errorPrefix: "Failed to send" }
      );
    },

    async sendMessages(messages: TonMessage[], opts?: TonSendOptions): Promise<TonTransferResult> {
      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      if (messages.length < 1) {
        throw new PluginSDKError("At least one message required", "OPERATION_FAILED");
      }

      if (messages.length > 255) {
        throw new PluginSDKError("Maximum 255 messages per transfer", "OPERATION_FAILED");
      }

      if (opts?.sendMode !== undefined && (opts.sendMode < 0 || opts.sendMode > 3)) {
        throw new PluginSDKError("Unsafe sendMode", "OPERATION_FAILED");
      }

      for (const m of messages) {
        try {
          TonAddress.parse(m.to);
        } catch {
          throw new PluginSDKError(`Invalid TON address format: ${m.to}`, "INVALID_ADDRESS");
        }

        if (!Number.isFinite(m.value) || m.value < 0) {
          throw new PluginSDKError("Amount must be a non-negative number", "OPERATION_FAILED");
        }
      }

      return signAndSend(messages, {
        sendMode: opts?.sendMode,
        errorPrefix: "Failed to send messages",
      });
    },

    async createSender(): Promise<TonSender> {
      const walletData = loadWallet();
      if (!walletData) {
        throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
      }

      const keyPair = await getKeyPair();
      if (!keyPair) {
        throw new PluginSDKError("Wallet key derivation failed", "OPERATION_FAILED");
      }

      const wallet = WalletContractV5R1.create({
        workchain: 0,
        publicKey: keyPair.publicKey,
      });

      return {
        address: wallet.address,
        send: async (args) => {
          if (args.sendMode !== undefined && (args.sendMode < 0 || args.sendMode > 3)) {
            throw new PluginSDKError("Unsafe sendMode", "OPERATION_FAILED");
          }
          const client = await getCachedTonClient();
          const sent = await withTxLock(async () => {
            const contract = client.open(wallet);
            return sendWalletTx(client, contract, {
              secretKey: keyPair.secretKey,
              sendMode: args.sendMode,
              messages: [
                internal({
                  to: args.to,
                  value: args.value,
                  body: args.body,
                  bounce: args.bounce ?? true,
                  init: args.init ?? undefined,
                }),
              ],
            });
          });
          if (!sent) {
            throw new PluginSDKError(
              "Transaction failed or could not be confirmed on-chain",
              "OPERATION_FAILED"
            );
          }
        },
      };
    },

    // ─── Sub-namespaces ───────────────────────────────────────────

    dex: Object.freeze(createDexSDK(log)),
    dns: Object.freeze(createDnsSDK(log)),
    highload: Object.freeze(highload),
  };
}
