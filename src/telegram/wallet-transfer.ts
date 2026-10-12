import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Address,
  Cell,
  SendMode,
  beginCell,
  external,
  internal,
  storeMessage,
  toNano,
} from "@ton/core";
import { keyPairFromSeed, mnemonicToPrivateKey, mnemonicValidate } from "@ton/crypto";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import { Api, type TelegramClient } from "telegram";
import { TELETON_ROOT } from "../workspace/paths.js";
import { getCachedTonClient } from "../ton/wallet-service.js";
import { withTxLock } from "../ton/tx-lock.js";
import { randomLong } from "../utils/gramjs-bigint.js";
import { getErrorMessage } from "../utils/errors.js";
import { NativeTelegramWallet } from "./wallet-protocol.js";
import { getTelegramWalletBootstrap } from "./wallet-bootstrap.js";

const KEY_FILE = join(TELETON_ROOT, "telegram-wallet.json");
const PENDING_FILE = join(TELETON_ROOT, "telegram-wallet-pending.json");
type PendingTransfer = { wallet: string; messageHash: string; recipient: string; amount: string };

export async function telegramWalletSigner(state: Api.WalletState) {
  if (!existsSync(KEY_FILE)) {
    throw new Error(
      "Telegram wallet signing key is not configured. A key held only inside Telegram cannot be used by Teleton. The owner must install the matching mnemonic in the private telegram-wallet.json file; never request or expose it in chat."
    );
  }
  if (!statSync(KEY_FILE).isFile() || (statSync(KEY_FILE).mode & 0o077) !== 0) {
    throw new Error("telegram-wallet.json must be a private file with mode 0600");
  }
  let config: {
    mnemonic?: string[];
    version?: string;
    walletId?: number;
    scheme?: string;
    anchorSeed?: string;
    signingSeed?: string;
  };
  try {
    config = JSON.parse(readFileSync(KEY_FILE, "utf8"));
  } catch {
    throw new Error("Invalid telegram-wallet.json");
  }
  if (config.scheme === "telegram-rotation") {
    if (
      typeof config.anchorSeed !== "string" ||
      typeof config.signingSeed !== "string" ||
      !/^[0-9a-f]{64}$/.test(config.anchorSeed) ||
      !/^[0-9a-f]{64}$/.test(config.signingSeed) ||
      ![0x7fff7f11, 0x7fff7ffd].includes(config.walletId ?? 0)
    )
      throw new Error("Invalid native Telegram wallet key cache");
    const anchorSeed = Buffer.from(config.anchorSeed, "hex");
    const signingSeed = Buffer.from(config.signingSeed, "hex");
    const anchor = keyPairFromSeed(anchorSeed);
    const keys = keyPairFromSeed(signingSeed);
    anchorSeed.fill(0);
    signingSeed.fill(0);
    try {
      const wallet = new NativeTelegramWallet(anchor.publicKey, config.walletId);
      if (
        !keys.publicKey.equals(Buffer.from(state.publicKey)) ||
        !wallet.address.equals(Address.parse(state.address))
      )
        throw new Error("Native Telegram wallet key cache does not match the account wallet");
      return { wallet, keys };
    } catch (error) {
      keys.secretKey.fill(0);
      throw error;
    } finally {
      anchor.secretKey.fill(0);
    }
  }
  if (
    !Array.isArray(config.mnemonic) ||
    config.mnemonic.length !== 24 ||
    !config.mnemonic.every((word) => typeof word === "string") ||
    !(await mnemonicValidate(config.mnemonic))
  ) {
    throw new Error("telegram-wallet.json requires a valid 24-word TON mnemonic");
  }
  const keys = await mnemonicToPrivateKey(config.mnemonic);
  if (!keys.publicKey.equals(Buffer.from(state.publicKey))) {
    throw new Error("The configured signing key does not match the Telegram wallet public key");
  }
  const address = Address.parse(state.address);
  if (
    config.walletId !== undefined &&
    (!Number.isInteger(config.walletId) || config.walletId < 0 || config.walletId > 0xffffffff)
  ) {
    throw new Error("Invalid Telegram wallet ID");
  }
  const wallet =
    config.version === "v4"
      ? WalletContractV4.create({
          workchain: address.workChain,
          publicKey: keys.publicKey,
          walletId: config.walletId,
        })
      : config.version === "v5r1" && config.walletId === undefined
        ? WalletContractV5R1.create({ workchain: address.workChain, publicKey: keys.publicKey })
        : null;
  if (!wallet || !wallet.address.equals(address)) {
    throw new Error(
      "Unsupported Telegram wallet version or wallet ID: the derived address must match Telegram exactly (supported: v4, standard v5r1)"
    );
  }
  return { wallet, keys };
}

export async function sendTelegramWalletTransfer(
  client: TelegramClient,
  params: { to: string; amount: string; comment?: string }
) {
  return withTxLock(async () => {
    if (!/^\d+(?:\.\d{1,9})?$/.test(params.amount) || toNano(params.amount) <= 0n)
      throw new Error("Amount must be a positive decimal string with at most 9 decimal places");
    if (Buffer.byteLength(params.comment ?? "", "utf8") > 1024)
      throw new Error("Comment must be at most 1024 UTF-8 bytes");
    const state = await client.invoke(new Api.wallet.GetState());
    if (!(state instanceof Api.WalletState)) throw new Error("The Telegram wallet is not ready");
    const bootstrap = getTelegramWalletBootstrap(client);
    if (!existsSync(KEY_FILE) && bootstrap) {
      bootstrap.retry();
      throw new Error(
        `Telegram wallet signer is not configured yet: backend status ${bootstrap.status}. Follow the deterministic admin DM if 2FA is required; never provide a password to the AI.`
      );
    }
    const { wallet, keys } = await telegramWalletSigner(state);
    let recipient: Address;
    let userId: Api.TypeInputUser = new Api.InputUserEmpty();
    const target = params.to.trim();
    try {
      recipient = Address.parse(target);
    } catch {
      if (!/^@\w+$/.test(target) && !/^\d+$/.test(target))
        throw new Error("Recipient must be a TON address, Telegram user ID or @username");
      const user = await client.getEntity(target);
      if (!(user instanceof Api.User) || user.bot || user.deleted)
        throw new Error("Recipient must be an accessible human Telegram user");
      const peer = await client.getInputEntity(user);
      if (peer instanceof Api.InputPeerUser)
        userId = new Api.InputUser({ userId: peer.userId, accessHash: peer.accessHash });
      else if (peer instanceof Api.InputPeerSelf) userId = new Api.InputUserSelf();
      else throw new Error("Could not resolve recipient");
      const result = await client.invoke(
        new Api.wallet.GetUserAddresses({ id: [userId], addresses: [] })
      );
      const entry = result.addresses.find((item) => item.userId?.toString() === user.id.toString());
      if (!entry?.address) throw new Error("Telegram returned no wallet address for the recipient");
      recipient = Address.parse(entry.address);
      if (peer instanceof Api.InputPeerSelf) userId = new Api.InputUserEmpty();
    }
    if (toNano(params.amount) > BigInt(state.balance.toString()))
      throw new Error("Insufficient Telegram wallet balance");
    if (existsSync(PENDING_FILE)) {
      const pending = JSON.parse(readFileSync(PENDING_FILE, "utf8")) as PendingTransfer;
      if (pending.wallet !== state.address)
        throw new Error("An unresolved transfer exists for a different Telegram wallet");
      const result = await client.invoke(
        new Api.wallet.GetTransactionsByMsgHash({ msgHash: [pending.messageHash] })
      );
      if (!result.transactions.some((tx) => !!tx.txHash)) {
        throw new Error(
          `Previous Telegram wallet transfer is still unresolved (${pending.messageHash}). Do not resend; inspect its transaction status first.`
        );
      }
      unlinkSync(PENDING_FILE);
    }
    const chain = await getCachedTonClient();
    const account = await chain.getContractState(wallet.address);
    if (account.state === "frozen") throw new Error("Telegram wallet contract is frozen");
    if (
      account.state === "active" &&
      (!account.code || !Cell.fromBoc(account.code)[0]?.hash().equals(wallet.init.code.hash()))
    ) {
      throw new Error("Telegram wallet on-chain code does not match the configured signer");
    }
    if (wallet instanceof NativeTelegramWallet && account.state === "active") {
      if (!account.data) throw new Error("Native Telegram wallet storage is missing");
      const data = Cell.fromBoc(account.data)[0].beginParse();
      data.skip(8 + 32 + 32);
      if (!data.loadBuffer(32).equals(keys.publicKey))
        throw new Error(
          "Native Telegram wallet signing key has changed; recover the current keys before sending"
        );
    }
    const seqno = await chain.open(wallet).getSeqno();
    const signingArgs = {
      seqno,
      secretKey: keys.secretKey,
      timeout: Math.floor(Date.now() / 1000) + 120,
      sendMode:
        wallet instanceof NativeTelegramWallet
          ? SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS
          : SendMode.PAY_GAS_SEPARATELY,
      messages: [
        internal({
          to: recipient,
          value: toNano(params.amount),
          bounce: false,
          body: params.comment ?? "",
        }),
      ],
    };
    const body =
      wallet instanceof NativeTelegramWallet
        ? wallet.createTransfer(signingArgs)
        : wallet instanceof WalletContractV4
          ? wallet.createTransfer(signingArgs)
          : wallet.createTransfer(signingArgs);
    const message = beginCell()
      .store(
        storeMessage(
          external({
            to: wallet.address,
            init: account.state === "active" ? undefined : wallet.init,
            body,
          })
        )
      )
      .endCell();
    const dataNormal = message.toBoc();
    if (dataNormal.length > 16 * 1024)
      throw new Error("Signed transfer exceeds Telegram's 16 KiB limit");
    const sender = await client.getSender(client.session.dcId);
    const pending: PendingTransfer = {
      wallet: state.address,
      messageHash: message.hash().toString("base64"),
      recipient: recipient.toString(),
      amount: params.amount,
    };
    writeFileSync(PENDING_FILE, JSON.stringify(pending), { mode: 0o600, flag: "wx" });
    try {
      const result = await sender.send(
        new Api.wallet.SendTransfer({ dataNormal, userId, randomId: randomLong() })
      );
      const updates =
        result instanceof Api.Updates || result instanceof Api.UpdatesCombined
          ? result.updates
          : result instanceof Api.UpdateShort
            ? [result.update]
            : [];
      const receipt = updates.find((update) => update instanceof Api.UpdateSentWalletTransaction);
      if (!(receipt instanceof Api.UpdateSentWalletTransaction) || !receipt.msgHash) {
        return {
          status: "unknown",
          ...pending,
          warning:
            "Telegram returned no usable transfer receipt. Do not resend; inspect transaction status.",
        };
      }
      pending.messageHash = receipt.msgHash;
      writeFileSync(PENDING_FILE, JSON.stringify(pending), { mode: 0o600 });
      return {
        status: "submitted",
        ...pending,
        transactionId: receipt.transaction?.id ?? null,
        txHash: receipt.transaction?.txHash ?? null,
        warning:
          "Submitted to Telegram; on-chain completion must be checked separately. Do not resend this payment.",
      };
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (typeof code === "number" && code >= 400 && code < 500) {
        unlinkSync(PENDING_FILE);
        throw error;
      }
      return {
        status: "unknown",
        ...pending,
        warning: `Submission outcome is unknown: ${getErrorMessage(error)}. Do not resend; inspect transaction status.`,
      };
    }
  });
}
