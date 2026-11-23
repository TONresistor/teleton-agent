import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Address,
  Cell,
  fromNano,
  type MessageRelaxed,
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
import { getCachedTonClient, getTelegramWalletSigningKeys } from "../ton/wallet-service.js";
import { withTxLock } from "../ton/tx-lock.js";
import { randomLong } from "../utils/gramjs-bigint.js";
import { getErrorMessage } from "../utils/errors.js";
import { NativeTelegramWallet } from "./wallet-protocol.js";
import { getTelegramWalletBootstrap } from "./wallet-bootstrap.js";

const KEY_FILE = join(TELETON_ROOT, "telegram-wallet.json");
const PENDING_FILE = join(TELETON_ROOT, "telegram-wallet-pending.json");
type PendingTransfer = { wallet: string; messageHash: string; recipient: string; amount: string };

export async function telegramWalletSigner(state: Api.WalletState, useMemory = false) {
  if (useMemory) {
    const seeds = getTelegramWalletSigningKeys();
    if (!seeds) throw new Error("Telegram wallet signing is locked");
    const anchor = keyPairFromSeed(seeds.anchorSeed);
    const keys = keyPairFromSeed(seeds.signingSeed);
    try {
      const address = Address.parse(state.address);
      const wallet = [0x7fff7f11, 0x7fff7ffd]
        .map((id) => new NativeTelegramWallet(anchor.publicKey, id))
        .find((candidate) => candidate.address.equals(address));
      if (!wallet || !keys.publicKey.equals(Buffer.from(state.publicKey)))
        throw new Error("Native Telegram wallet signing key does not match the account wallet");
      return { wallet, keys };
    } catch (error) {
      keys.secretKey.fill(0);
      throw error;
    } finally {
      seeds.anchorSeed.fill(0);
      seeds.signingSeed.fill(0);
      anchor.secretKey.fill(0);
    }
  }
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
  };
  try {
    config = JSON.parse(readFileSync(KEY_FILE, "utf8"));
  } catch {
    throw new Error("Invalid telegram-wallet.json");
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

export type TelegramWalletMessages = {
  messages: MessageRelaxed[];
  sendModes: SendMode[];
  expiresAt?: number;
};

type ContractTransfer = {
  maxTotalTon: string;
  prepare: (state: Api.WalletState) => Promise<TelegramWalletMessages>;
};

export function sendTelegramWalletMessages(client: TelegramClient, params: ContractTransfer) {
  return sendWalletTransaction(client, params);
}

export function sendTelegramWalletTransfer(
  client: TelegramClient,
  params: { to: string; amount: string; comment?: string }
) {
  return sendWalletTransaction(client, params);
}

async function sendWalletTransaction(
  client: TelegramClient,
  params: { to: string; amount: string; comment?: string } | ContractTransfer
) {
  let secretKey: Buffer | undefined;
  return withTxLock(async () => {
    const amount = "prepare" in params ? params.maxTotalTon : params.amount;
    if (!/^\d+(?:\.\d{1,9})?$/.test(amount) || toNano(amount) <= 0n)
      throw new Error("Amount must be a positive decimal string with at most 9 decimal places");
    if (!("prepare" in params) && Buffer.byteLength(params.comment ?? "", "utf8") > 1024)
      throw new Error("Comment must be at most 1024 UTF-8 bytes");
    const state = await client.invoke(new Api.wallet.GetState());
    if (!(state instanceof Api.WalletState)) throw new Error("The Telegram wallet is not ready");
    const bootstrap = getTelegramWalletBootstrap(client);
    if (bootstrap) await bootstrap.unlockSigner(state);
    const { wallet, keys } = await telegramWalletSigner(state, !!bootstrap);
    secretKey = keys.secretKey;
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
    let userId: Api.TypeInputUser = new Api.InputUserEmpty();
    let prepared: TelegramWalletMessages;
    if ("prepare" in params) {
      if (!(wallet instanceof NativeTelegramWallet))
        throw new Error("On-chain gifts require a native Telegram wallet");
      prepared = await params.prepare(state);
    } else {
      let recipient: Address;
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
        const entry = result.addresses.find(
          (item) => item.userId?.toString() === user.id.toString()
        );
        if (!entry?.address)
          throw new Error("Telegram returned no wallet address for the recipient");
        recipient = Address.parse(entry.address);
        if (peer instanceof Api.InputPeerSelf) userId = new Api.InputUserEmpty();
      }

      prepared = {
        messages: [
          internal({
            to: recipient,
            value: toNano(params.amount),
            bounce: false,
            body: params.comment ?? "",
          }),
        ],
        sendModes: [
          wallet instanceof NativeTelegramWallet
            ? SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS
            : SendMode.PAY_GAS_SEPARATELY,
        ],
      };
    }
    if (
      !prepared.messages.length ||
      prepared.messages.length > 255 ||
      prepared.sendModes.length !== prepared.messages.length
    )
      throw new Error("Invalid Telegram wallet transaction messages");
    const totalValue = prepared.messages.reduce((sum, message) => {
      if (message.info.type !== "internal" || message.info.value.coins < 0n)
        throw new Error("Expected an internal message with a nonnegative amount");
      return sum + message.info.value.coins;
    }, 0n);
    if (totalValue > BigInt(state.balance.toString()))
      throw new Error("Insufficient Telegram wallet balance");
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
      timeout: Math.min(Math.floor(Date.now() / 1000) + 120, prepared.expiresAt ?? Infinity),
      sendMode: prepared.sendModes[0],
      sendModes: prepared.sendModes,
      messages: prepared.messages,
    };
    if (signingArgs.timeout <= Math.floor(Date.now() / 1000))
      throw new Error("Telegram gift transaction has expired");
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
    let estimatedFee: string | undefined;
    if ("prepare" in params) {
      const estimate = await chain.estimateExternalMessageFee(wallet.address, {
        body,
        initCode: account.state === "active" ? null : wallet.init.code,
        initData: account.state === "active" ? null : wallet.init.data,
        ignoreSignature: false,
      });
      const feeValues = [
        estimate.source_fees.in_fwd_fee,
        estimate.source_fees.storage_fee,
        estimate.source_fees.gas_fee,
        estimate.source_fees.fwd_fee,
      ];
      if (!feeValues.every((fee) => Number.isSafeInteger(fee) && fee >= 0))
        throw new Error("Invalid network fee estimate");
      const fee = feeValues.reduce((sum, fee) => sum + BigInt(fee), 0n);
      estimatedFee = fromNano(fee);
      if (totalValue + fee > toNano(params.maxTotalTon))
        throw new Error(
          "Gift transaction and estimated network fees exceed the approved total budget"
        );
      if (totalValue + fee > BigInt(state.balance.toString()))
        throw new Error("Insufficient Telegram wallet balance including network fees");
    }
    if (bootstrap) {
      const current = await client.invoke(new Api.wallet.GetState());
      if (
        !(current instanceof Api.WalletState) ||
        !wallet.address.equals(Address.parse(current.address)) ||
        !keys.publicKey.equals(Buffer.from(current.publicKey))
      )
        throw new Error(
          "The Telegram wallet changed before submission. No transfer was submitted."
        );
    }
    if (signingArgs.timeout <= Math.floor(Date.now() / 1000))
      throw new Error("Telegram gift transaction has expired");
    const sender = await client.getSender(client.session.dcId);
    const pending: PendingTransfer = {
      wallet: state.address,
      messageHash: message.hash().toString("base64"),
      recipient: prepared.messages
        .map((message) => (message.info.type === "internal" ? message.info.dest.toString() : ""))
        .join(","),
      amount: fromNano(totalValue),
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
        estimatedNetworkFeeTon: estimatedFee,
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
  }).finally(() => {
    secretKey?.fill(0);
  });
}
