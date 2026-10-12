import type { createWalletContract } from "./wallet-service.js";
import type { TonClient, OpenedContract } from "@ton/ton";
import { SendMode, type Address, type MessageRelaxed } from "@ton/core";
import { invalidateTonClientCache } from "./wallet-service.js";
import { createLogger } from "../utils/logger.js";
import { withBlockchainRetry } from "../utils/retry.js";
import { TON_CONFIRM_TIMEOUT_MS, TON_CONFIRM_POLL_INTERVAL_MS } from "../constants/timeouts.js";

const log = createLogger("TON");

type WalletV5R1 = ReturnType<typeof createWalletContract>;

export interface ConfirmedTx {
  /** Real on-chain account-transaction hash (hex) — verifiable on TON explorers. */
  hash: string;
  /** Unix-ms timestamp of the confirmed transaction. */
  at: number;
}

export interface SentTx extends ConfirmedTx {
  /** Wallet seqno consumed by this transfer. */
  seqno: number;
}

/** Explorer link for a confirmed transaction (endpoints are mainnet — see endpoint.ts). */
export function tonExplorerTxUrl(hash: string): string {
  return `https://tonviewer.com/transaction/${hash}`;
}

function isServerError(error: unknown): boolean {
  const err = error as { status?: number; response?: { status?: number } };
  const status = err?.status ?? err?.response?.status;
  return status === 429 || (status !== undefined && status >= 500);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Latest transaction lt for the wallet — snapshot this before sending to identify our own tx. */
export async function walletTxLt(client: TonClient, walletAddress: Address): Promise<bigint> {
  const recent = await withBlockchainRetry(
    () => client.getTransactions(walletAddress, { limit: 1 }),
    "getTransactions"
  );
  return recent[0]?.lt ?? 0n;
}

/**
 * Locate the wallet's own outgoing transaction and confirm it committed. Our send is the
 * newest `external-in` tx past the pre-send `lt` snapshot — incoming payments are `internal`
 * and the tx-lock serialises our sends, so the match is unambiguous. A seqno bump alone is
 * not enough: the action phase must also succeed, else the funds never left the wallet.
 */
export async function confirmWalletTx(
  client: TonClient,
  walletAddress: Address,
  sinceLt: bigint
): Promise<ConfirmedTx | null> {
  const deadline = Date.now() + TON_CONFIRM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const txs = await client.getTransactions(walletAddress, { limit: 10 });
      const ours = txs.find((tx) => tx.inMessage?.info.type === "external-in" && tx.lt > sinceLt);

      if (ours) {
        const d = ours.description;
        if (d.type !== "generic") {
          log.error({ type: d.type }, "Unexpected transfer transaction type");
          return null;
        }
        const computeOk = d.computePhase.type === "vm" && d.computePhase.success;
        const actionOk = d.actionPhase?.success === true;
        if (!computeOk || !actionOk) {
          log.error(
            {
              exitCode: d.computePhase.type === "vm" ? d.computePhase.exitCode : undefined,
              actionResult: d.actionPhase?.resultCode,
              noFunds: d.actionPhase?.noFunds,
            },
            "Transfer failed on-chain — funds did not leave the wallet"
          );
          return null;
        }
        return { hash: ours.hash().toString("hex"), at: ours.now * 1000 };
      }
    } catch (error) {
      log.debug({ err: error }, "Confirm poll failed; retrying");
    }
    await sleep(TON_CONFIRM_POLL_INTERVAL_MS);
  }

  return null;
}

/**
 * Broadcast a transfer once, then confirm it on-chain and return the real hash. We confirm
 * regardless of the broadcast call's outcome — the message can land even if the RPC response
 * errors, and re-broadcasting a consumed seqno is a no-op. Returns null if unconfirmed within
 * the finality window (never an optimistic success). Callers MUST hold the wallet tx-lock.
 */
export async function sendWalletTx(
  client: TonClient,
  contract: OpenedContract<WalletV5R1>,
  args: { secretKey: Buffer; messages: MessageRelaxed[]; sendMode?: SendMode }
): Promise<SentTx | null> {
  const seqno = await withBlockchainRetry(() => contract.getSeqno(), "getSeqno");
  const sinceLt = await walletTxLt(client, contract.address);

  let broadcastError: unknown;
  try {
    await contract.sendTransfer({
      seqno,
      secretKey: args.secretKey,
      sendMode: args.sendMode ?? SendMode.PAY_GAS_SEPARATELY,
      messages: args.messages,
    });
  } catch (error) {
    broadcastError = error;
    if (isServerError(error)) invalidateTonClientCache();
    log.warn({ err: error }, "Broadcast errored — verifying on-chain whether it landed");
  }

  const confirmed = await confirmWalletTx(client, contract.address, sinceLt);
  if (!confirmed) {
    if (broadcastError) throw broadcastError;
    return null;
  }
  return { hash: confirmed.hash, seqno, at: confirmed.at };
}
