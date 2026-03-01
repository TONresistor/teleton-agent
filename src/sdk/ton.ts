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
  JettonPrice,
  JettonHolder,
  JettonHistory,
  PluginLogger,
} from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
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
import { PAYMENT_TOLERANCE_RATIO } from "../constants/limits.js";
import { withBlockchainRetry } from "../utils/retry.js";
import { tonapiFetch, GECKOTERMINAL_API_URL } from "../constants/api-endpoints.js";
import { fetchWithTimeout } from "../utils/fetch.js";
import { createDexSDK } from "./ton-dex.js";
import { createDnsSDK } from "./ton-dns.js";
import {
  toNano as tonToNano,
  fromNano as tonFromNano,
  WalletContractV5R1,
  internal,
} from "@ton/ton";
import { Address as TonAddress, beginCell, SendMode } from "@ton/core";
import { withTxLock } from "../ton/tx-lock.js";
import { formatTransactions } from "../ton/format-transactions.js";

/** Format a raw BigInt token balance to a human-readable string. */
function formatTokenBalance(rawBalance: bigint, decimals: number): string {
  const divisor = BigInt(10) ** BigInt(decimals);
  const wholePart = rawBalance / divisor;
  const fractionalPart = rawBalance % divisor;
  return fractionalPart === 0n
    ? wholePart.toString()
    : `${wholePart}.${fractionalPart.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

const DEFAULT_MAX_AGE_MINUTES = 10;

const DEFAULT_TX_RETENTION_DAYS = 30;

const CLEANUP_PROBABILITY = 0.1;

/** Match a jetton in a balances array by raw address or parsed canonical form. */
function findJettonBalance(balances: any[], jettonAddress: string): any | undefined {
  return balances.find((b: any) => {
    if (b.jetton.address.toLowerCase() === jettonAddress.toLowerCase()) return true;
    try {
      return (
        TonAddress.parse(b.jetton.address).toString() === TonAddress.parse(jettonAddress).toString()
      );
    } catch {
      return false;
    }
  });
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
        TonAddress.parse(to);
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
      } catch (err) {
        log.error("ton.getJettonBalances() failed:", err);
        return [];
      }
    },

    async getJettonInfo(jettonAddress: string): Promise<JettonInfo | null> {
      try {
        const response = await tonapiFetch(`/jettons/${encodeURIComponent(jettonAddress)}`);
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

      try {
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

        const senderJettonWallet = jettonBalance.wallet_address.address;
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

        const seqno = await withTxLock(async () => {
          const MAX_SEND_ATTEMPTS = 3;
          let lastErr: unknown;

          for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
            try {
              const wallet = WalletContractV5R1.create({
                workchain: 0,
                publicKey: keyPair.publicKey,
              });

              const client = await getCachedTonClient();
              const walletContract = client.open(wallet);
              const seq = await walletContract.getSeqno();

              await walletContract.sendTransfer({
                seqno: seq,
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

              return seq;
            } catch (err) {
              lastErr = err;
              const status = (err as any)?.status || (err as any)?.response?.status;
              const respData = (err as any)?.response?.data;
              if (status === 429 || (status && status >= 500)) {
                invalidateTonClientCache();
                if (attempt < MAX_SEND_ATTEMPTS) {
                  log.warn(
                    `sendJetton attempt ${attempt} failed (${status}): ${JSON.stringify(respData ?? (err as Error).message)}, retrying...`
                  );
                  await new Promise((r) => setTimeout(r, 1000 * attempt));
                  continue;
                }
              }
              throw err;
            }
          }
          throw lastErr;
        });

        return { success: true, seqno };
      } catch (err) {
        // Invalidate node cache on 429/5xx so next attempt picks a fresh node
        const status = (err as any)?.status || (err as any)?.response?.status;
        if (status === 429 || (status && status >= 500)) {
          invalidateTonClientCache();
        }
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
        const response = await tonapiFetch(`/accounts/${encodeURIComponent(ownerAddress)}/jettons`);
        if (!response.ok) {
          log.error(`ton.getJettonWalletAddress() TonAPI error: ${response.status}`);
          return null;
        }

        const data = await response.json();

        const match = findJettonBalance(data.balances ?? [], jettonAddress);
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
        const response = await tonapiFetch(`/nfts/${encodeURIComponent(nftAddress)}`);
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

    // ─── Jetton Analytics ─────────────────────────────────────────

    async getJettonPrice(jettonAddress: string): Promise<JettonPrice | null> {
      try {
        const response = await tonapiFetch(
          `/rates?tokens=${encodeURIComponent(jettonAddress)}&currencies=usd,ton`
        );
        if (!response.ok) {
          log.debug(`ton.getJettonPrice() TonAPI error: ${response.status}`);
          return null;
        }

        const data = await response.json();
        const rateData = data.rates?.[jettonAddress];
        if (!rateData) return null;

        return {
          priceUSD: rateData.prices?.USD ?? null,
          priceTON: rateData.prices?.TON ?? null,
          change24h: rateData.diff_24h?.USD ?? null,
          change7d: rateData.diff_7d?.USD ?? null,
          change30d: rateData.diff_30d?.USD ?? null,
        };
      } catch (err) {
        log.debug("ton.getJettonPrice() failed:", err);
        return null;
      }
    },

    async getJettonHolders(jettonAddress: string, limit?: number): Promise<JettonHolder[]> {
      try {
        const effectiveLimit = Math.min(limit ?? 10, 100);

        // Parallel fetch: holders + decimals info
        const [holdersResponse, infoResponse] = await Promise.all([
          tonapiFetch(
            `/jettons/${encodeURIComponent(jettonAddress)}/holders?limit=${effectiveLimit}`
          ),
          tonapiFetch(`/jettons/${encodeURIComponent(jettonAddress)}`),
        ]);

        if (!holdersResponse.ok) {
          log.debug(`ton.getJettonHolders() TonAPI error: ${holdersResponse.status}`);
          return [];
        }

        const data = await holdersResponse.json();
        const addresses = data.addresses || [];

        let decimals = 9;
        if (infoResponse.ok) {
          const infoData = await infoResponse.json();
          decimals = parseInt(infoData.metadata?.decimals || "9");
        }

        return addresses.map((h: any, index: number) => {
          return {
            rank: index + 1,
            address: h.owner?.address || h.address,
            name: h.owner?.name || null,
            balance: formatTokenBalance(BigInt(h.balance || "0"), decimals),
            balanceRaw: h.balance || "0",
          };
        });
      } catch (err) {
        log.debug("ton.getJettonHolders() failed:", err);
        return [];
      }
    },

    async getJettonHistory(jettonAddress: string): Promise<JettonHistory | null> {
      try {
        const [ratesResponse, geckoResponse, infoResponse] = await Promise.all([
          tonapiFetch(`/rates?tokens=${encodeURIComponent(jettonAddress)}&currencies=usd,ton`),
          fetchWithTimeout(`${GECKOTERMINAL_API_URL}/networks/ton/tokens/${jettonAddress}`, {
            headers: { Accept: "application/json" },
          }),
          tonapiFetch(`/jettons/${encodeURIComponent(jettonAddress)}`),
        ]);

        let symbol = "TOKEN";
        let name = "Unknown Token";
        let holdersCount = 0;

        if (infoResponse.ok) {
          const infoData = await infoResponse.json();
          symbol = infoData.metadata?.symbol || symbol;
          name = infoData.metadata?.name || name;
          holdersCount = infoData.holders_count || 0;
        }

        let priceUSD: number | null = null;
        let priceTON: number | null = null;
        let change24h: string | null = null;
        let change7d: string | null = null;
        let change30d: string | null = null;

        if (ratesResponse.ok) {
          const ratesData = await ratesResponse.json();
          const rateInfo = ratesData.rates?.[jettonAddress];
          if (rateInfo) {
            priceUSD = rateInfo.prices?.USD || null;
            priceTON = rateInfo.prices?.TON || null;
            change24h = rateInfo.diff_24h?.USD || null;
            change7d = rateInfo.diff_7d?.USD || null;
            change30d = rateInfo.diff_30d?.USD || null;
          }
        }

        let volume24h: string = "N/A";
        let fdv: string = "N/A";
        let marketCap: string = "N/A";

        if (geckoResponse.ok) {
          const geckoData = await geckoResponse.json();
          const attrs = geckoData.data?.attributes;
          if (attrs) {
            if (attrs.volume_usd?.h24) {
              volume24h = `$${parseFloat(attrs.volume_usd.h24).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
            }
            if (attrs.fdv_usd) {
              fdv = `$${parseFloat(attrs.fdv_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
            }
            if (attrs.market_cap_usd) {
              marketCap = `$${parseFloat(attrs.market_cap_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
            }
          }
        }

        return {
          symbol,
          name,
          currentPrice: priceUSD ? `$${priceUSD.toFixed(6)}` : "N/A",
          currentPriceTON: priceTON ? `${priceTON.toFixed(6)} TON` : "N/A",
          changes: {
            "24h": change24h || "N/A",
            "7d": change7d || "N/A",
            "30d": change30d || "N/A",
          },
          volume24h,
          fdv,
          marketCap,
          holders: holdersCount,
        };
      } catch (err) {
        log.debug("ton.getJettonHistory() failed:", err);
        return null;
      }
    },

    // ─── Sub-namespaces ───────────────────────────────────────────

    dex: Object.freeze(createDexSDK(log)),
    dns: Object.freeze(createDnsSDK(log)),
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
