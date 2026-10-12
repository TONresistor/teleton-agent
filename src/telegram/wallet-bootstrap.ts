import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Api, type TelegramClient } from "telegram";
import { computeCheck } from "telegram/Password.js";
import { keyPairFromSeed } from "@ton/crypto";
import { Address } from "@ton/core";
import { randomUUID } from "node:crypto";
import { TELETON_ROOT } from "../workspace/paths.js";
import {
  combineWalletShares,
  decryptWalletShare,
  deriveTelegramWalletKeys,
  generateWalletEphemeralKey,
  NativeTelegramWallet,
  signWalletOwnershipProof,
} from "./wallet-protocol.js";

import {
  loadWallet,
  saveWallet,
  setTelegramWalletVerification,
  clearTelegramWalletVerification,
  type WalletData,
} from "../ton/wallet-service.js";

const ASSOCIATION_FILE = join(TELETON_ROOT, "telegram-wallet-association.json");
const KEY_FILE = join(TELETON_ROOT, "telegram-wallet.json");
const REQUESTS_FILE = join(TELETON_ROOT, "telegram-wallet-auth-requests.json");
const STATUS_FILE = join(TELETON_ROOT, "telegram-wallet-auth-status.json");
const TTL = 5 * 60_000;
type RequestRecord = { admin: string; id: number; expires: number };
type Pending = RequestRecord & {
  resolve: (password: Buffer) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const bootstraps = new WeakMap<TelegramClient, TelegramWalletBootstrap>();
export function getTelegramWalletBootstrap(client: TelegramClient) {
  return bootstraps.get(client);
}
function code(error: unknown): string {
  const value =
    (error as { errorMessage?: string; message?: string })?.errorMessage ??
    (error as Error)?.message;
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,80}$/.test(value)
    ? value
    : "WALLET_SETUP_FAILED";
}
function privateJSON(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

export class TelegramWalletBootstrap {
  status = "starting";
  private records: RequestRecord[] = [];
  private pending?: Pending;
  private job?: Promise<void>;
  private stopped = false;
  private lastAttempt = 0;
  get isStopped() {
    return this.stopped;
  }
  constructor(
    private client: TelegramClient,
    private adminId: number
  ) {
    bootstraps.set(client, this);
    if (existsSync(REQUESTS_FILE)) {
      try {
        const rows = JSON.parse(readFileSync(REQUESTS_FILE, "utf8"));
        if (Array.isArray(rows))
          this.records = rows.filter(
            (r) =>
              typeof r.admin === "string" &&
              Number.isSafeInteger(r.id) &&
              Number.isFinite(r.expires)
          );
      } catch {
        this.setStatus("blocked", "AUTH_REQUEST_STORAGE_INVALID");
      }
    }
  }
  private setStatus(status: string, error?: string) {
    this.status = status;
    privateJSON(STATUS_FILE, { status, code: error ?? null, updatedAt: new Date().toISOString() });
  }
  private checkStopped() {
    if (this.stopped) throw new Error("WALLET_SETUP_STOPPED");
  }
  private async rpc<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("WALLET_SETUP_TIMEOUT")), 60_000);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  start(): Promise<void> {
    if (this.job || this.stopped || this.status === "blocked") return this.job ?? Promise.resolve();
    clearTelegramWalletVerification();
    this.lastAttempt = Date.now();
    this.job = this.run().catch(async (error) => {
      if (this.stopped) return;
      clearTelegramWalletVerification();
      this.setStatus("blocked", code(error));
      const message =
        code(error) === "TELEGRAM_WALLET_ALREADY_EXISTS"
          ? "Your Telegram account already has a different wallet. It was kept unchanged. Automatic association only handles a new/empty Telegram wallet; switching belongs to the future migration flow. No funds were moved."
          : `Telegram wallet setup is blocked: ${code(error)}. No transaction was sent.`;
      await this.notify(message);
    });
    return this.job;
  }
  retry(): void {
    if (this.status !== "blocked" || this.stopped || Date.now() - this.lastAttempt < 60_000) return;
    this.job = undefined;
    this.setStatus("starting");
    void this.start();
  }
  stop(): void {
    clearTelegramWalletVerification();
    this.stopped = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error("WALLET_SETUP_STOPPED"));
      this.pending = undefined;
    }
  }
  private async notify(message: string) {
    if (!this.stopped && this.adminId > 0) {
      try {
        await this.client.sendMessage(String(this.adminId), { message, parseMode: undefined });
      } catch {}
    }
  }
  async consume(message: Api.Message): Promise<boolean> {
    if (message.out || !(message.peerId instanceof Api.PeerUser)) return false;
    const chat = message.peerId.userId.toString();
    const replyId = message.replyToMsgId;
    let record = this.records.find((r) => r.admin === chat && r.id === replyId);
    if (!record && typeof replyId === "number" && Number.isSafeInteger(replyId) && replyId > 0) {
      try {
        const referenced = await this.rpc(this.client.getMessages(chat, { ids: [replyId] }));
        if (referenced[0]?.out && referenced[0].message.startsWith("[Teleton wallet — 2FA]\n"))
          record = { admin: chat, id: replyId, expires: 0 };
      } catch {
        message.message = "";
        message.entities = [];
        const original = (message as unknown as { originalArgs?: { message?: string } })
          .originalArgs;
        if (original) original.message = "";
        return true;
      }
    }
    if (!record) return false;
    const text = message.message;
    message.message = "";
    message.entities = [];
    const original = (
      message as unknown as { originalArgs?: { message?: string; entities?: unknown[] } }
    ).originalArgs;
    if (original) {
      original.message = "";
      original.entities = [];
    }
    const pending = this.pending;
    const sender = message.senderId?.toString() ?? chat;
    if (
      !pending ||
      pending.id !== replyId ||
      pending.admin !== sender ||
      pending.admin !== String(this.adminId) ||
      pending.expires <= Date.now() ||
      this.stopped
    ) {
      await this.notify(
        "That wallet 2FA request is no longer active. The reply was discarded and was not sent to the AI."
      );
    } else if (!text || Buffer.byteLength(text, "utf8") > 4096) {
      await this.notify("Invalid 2FA reply. Reply to the same request with your password only.");
    } else {
      const password = Buffer.from(text, "utf8");
      clearTimeout(pending.timer);
      this.pending = undefined;
      pending.resolve(password);
    }
    try {
      await this.client.invoke(new Api.messages.DeleteMessages({ id: [message.id], revoke: true }));
    } catch {}
    return true;
  }
  private async password(purpose: "recover" | "associate" = "recover"): Promise<Buffer> {
    this.checkStopped();
    if (this.records.length >= 1000) throw new Error("AUTH_REQUEST_LIMIT");
    const sent = await this.client.sendMessage(String(this.adminId), {
      message: `[Teleton wallet — 2FA]\nTelegram requires your 2FA password to ${purpose === "associate" ? "associate the TgWallet created during onboarding" : "unlock this account's wallet signing key"}. Reply to THIS message with the password only, within 5 minutes. Your reply bypasses AI, memory and logs and will be deleted from this chat. Do not send a recovery phrase. This does not authorize a payment.`,
      parseMode: undefined,
    });
    this.checkStopped();
    const record = { admin: String(this.adminId), id: sent.id, expires: Date.now() + TTL };
    this.records.push(record);
    privateJSON(REQUESTS_FILE, this.records);
    this.setStatus("waiting_2fa");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error("PASSWORD_REQUEST_EXPIRED"));
      }, TTL);
      timer.unref?.();
      this.pending = { ...record, timer, resolve, reject };
    });
  }
  private async associate(primary: WalletData) {
    if (primary.keySource || ![12, 24].includes(primary.mnemonic.length))
      throw new Error("ASSOCIATION_KEY_SOURCE_INVALID");
    const phrase = Buffer.from(primary.mnemonic.join(" "));
    let seeds: ReturnType<typeof deriveTelegramWalletKeys>;
    try {
      seeds = deriveTelegramWalletKeys(phrase);
    } finally {
      phrase.fill(0);
    }
    const anchor = keyPairFromSeed(seeds.anchorSeed);
    const signing = keyPairFromSeed(seeds.signingSeed);
    let passwordProof: Api.TypeInputCheckPasswordSRP | undefined;
    try {
      const wallet = new NativeTelegramWallet(anchor.publicKey, primary.walletId);
      if (
        !wallet.address.equals(Address.parse(primary.address)) ||
        signing.publicKey.toString("hex") !== primary.publicKey
      )
        throw new Error("ASSOCIATION_KEY_MISMATCH");
      const matches = (state: Api.TypeWalletState) =>
        state instanceof Api.WalletState &&
        wallet.address.equals(Address.parse(state.address)) &&
        signing.publicKey.equals(Buffer.from(state.publicKey));
      const finish = () => {
        this.checkStopped();

        const current = loadWallet();
        if (
          current?.version !== "tg" ||
          current.address !== primary.address ||
          current.publicKey !== primary.publicKey ||
          current.telegramAssociation !== "pending"
        )
          throw new Error("PRIMARY_WALLET_CHANGED");
        privateJSON(KEY_FILE, {
          scheme: "telegram-rotation",
          version: "telegram",
          walletId: wallet.walletId,
          anchorSeed: seeds.anchorSeed.toString("hex"),
          signingSeed: seeds.signingSeed.toString("hex"),
        });
        saveWallet({
          ...primary,
          keySource: "telegram-wallet",
          mnemonic: [],
          telegramAssociation: "linked",
        });
        privateJSON(ASSOCIATION_FILE, {
          address: primary.address,
          status: "linked",
          updatedAt: new Date().toISOString(),
        });
        if (
          !setTelegramWalletVerification(
            wallet.address.toString(),
            signing.publicKey.toString("hex")
          )
        )
          throw new Error("PRIMARY_WALLET_MISMATCH");
        this.setStatus("ready");
      };
      for (let attempt = 0; attempt < 4; attempt++) {
        this.checkStopped();
        const state = await this.rpc(this.client.invoke(new Api.wallet.GetState()));
        this.checkStopped();
        if (matches(state)) {
          finish();
          return;
        }
        if (existsSync(ASSOCIATION_FILE)) {
          const previous = JSON.parse(readFileSync(ASSOCIATION_FILE, "utf8"));
          if (previous.status === "submitted") throw new Error("ASSOCIATION_UNCONFIRMED");
        }
        if (!(state instanceof Api.WalletStateEmpty))
          throw new Error("TELEGRAM_WALLET_ALREADY_EXISTS");
        if (state.creating) throw new Error("TELEGRAM_WALLET_CREATING");
        const challenge = await this.rpc(this.client.invoke(new Api.wallet.GetProofChallenge()));
        this.checkStopped();
        const timestamp = Math.floor(Date.now() / 1000);
        if (!challenge.domain || !challenge.payload || challenge.expires <= timestamp)
          throw new Error("ASSOCIATION_CHALLENGE_INVALID");
        const signature = signWalletOwnershipProof(
          wallet.address,
          challenge.domain,
          timestamp,
          challenge.payload,
          signing.secretKey
        );
        const sender = await this.rpc(this.client.getSender(this.client.session.dcId));
        this.checkStopped();
        const beforeSend = await this.rpc(this.client.invoke(new Api.wallet.GetState()));
        this.checkStopped();
        if (matches(beforeSend)) {
          finish();
          return;
        }
        if (!(beforeSend instanceof Api.WalletStateEmpty))
          throw new Error("TELEGRAM_WALLET_ALREADY_EXISTS");
        if (beforeSend.creating) throw new Error("TELEGRAM_WALLET_CREATING");

        privateJSON(ASSOCIATION_FILE, {
          address: primary.address,
          status: "submitted",
          updatedAt: new Date().toISOString(),
        });
        this.setStatus("associating");
        let error: unknown;
        try {
          await this.rpc(
            Promise.resolve(
              sender.send(
                new Api.wallet.ReplaceWallet({
                  wallet: new Api.InputWalletImported({
                    publicKey: signing.publicKey,
                    anchorPublicKey: anchor.publicKey.equals(signing.publicKey)
                      ? undefined
                      : anchor.publicKey,
                    proof: new Api.WalletOwnershipProof({ timestamp, signature }),
                  }),
                  password: passwordProof,
                })
              )
            )
          );
        } catch (caught) {
          error = caught;
        }
        this.checkStopped();

        let served = await this.rpc(this.client.invoke(new Api.wallet.GetState()));
        for (
          let poll = 0;
          !error && served instanceof Api.WalletStateEmpty && served.creating && poll < 10;
          poll++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          this.checkStopped();
          served = await this.rpc(this.client.invoke(new Api.wallet.GetState()));
        }
        if (matches(served)) {
          finish();
          return;
        }
        if (
          error &&
          ["PASSWORD_MISSING", "PASSWORD_HASH_INVALID", "SRP_ID_INVALID"].includes(code(error))
        ) {
          privateJSON(ASSOCIATION_FILE, {
            address: primary.address,
            status: "auth_required",
            updatedAt: new Date().toISOString(),
          });
          if (attempt === 3) throw error;
          const password = await this.password("associate");
          try {
            const parameters = await this.rpc(this.client.invoke(new Api.account.GetPassword()));
            passwordProof = await computeCheck(parameters, password.toString("utf8"));
          } finally {
            password.fill(0);
          }
          continue;
        }

        throw new Error("ASSOCIATION_UNCONFIRMED");
      }
    } finally {
      seeds.anchorSeed.fill(0);
      seeds.signingSeed.fill(0);
      anchor.secretKey.fill(0);
      signing.secretKey.fill(0);
      passwordProof = undefined;
    }
  }
  private async run() {
    if (!Number.isSafeInteger(this.adminId) || this.adminId <= 0)
      throw new Error("ADMIN_NOT_CONFIGURED");
    const primary = loadWallet();
    if (primary?.version !== "tg") {
      this.setStatus("disabled");
      return;
    }
    if (primary?.version === "tg" && primary.telegramAssociation === "pending") {
      await this.associate(primary);
      return;
    }
    const state = await this.rpc(this.client.invoke(new Api.wallet.GetState()));
    this.checkStopped();
    if (!(state instanceof Api.WalletState)) throw new Error("WALLET_NOT_READY");
    const assertPrimaryMatches = (served: Api.TypeWalletState) => {
      const selected = loadWallet();
      if (
        !(served instanceof Api.WalletState) ||
        selected?.version !== "tg" ||
        !Address.parse(selected.address).equals(Address.parse(served.address)) ||
        selected.publicKey.toLowerCase() !== Buffer.from(served.publicKey).toString("hex")
      )
        throw new Error("PRIMARY_WALLET_MISMATCH");
    };
    assertPrimaryMatches(state);
    if (existsSync(KEY_FILE) && (statSync(KEY_FILE).mode & 0o077) === 0) {
      try {
        const cached = JSON.parse(readFileSync(KEY_FILE, "utf8"));
        if (
          cached.scheme === "telegram-rotation" &&
          /^[0-9a-f]{64}$/.test(cached.anchorSeed) &&
          /^[0-9a-f]{64}$/.test(cached.signingSeed)
        ) {
          const seed = Buffer.from(cached.anchorSeed, "hex");
          const pair = keyPairFromSeed(seed);
          const signing = keyPairFromSeed(Buffer.from(cached.signingSeed, "hex"));
          seed.fill(0);
          try {
            const wallet = new NativeTelegramWallet(pair.publicKey, cached.walletId);
            if (
              signing.publicKey.equals(Buffer.from(state.publicKey)) &&
              wallet.address.equals(Address.parse(state.address))
            ) {
              if (
                !setTelegramWalletVerification(
                  state.address,
                  Buffer.from(state.publicKey).toString("hex")
                )
              )
                throw new Error("PRIMARY_WALLET_MISMATCH");
              this.setStatus("ready");
              return;
            }
          } finally {
            pair.secretKey.fill(0);
            signing.secretKey.fill(0);
          }
        }
      } catch (error) {
        if (code(error) === "PRIMARY_WALLET_MISMATCH") throw error;
      }
    }
    assertPrimaryMatches(state);
    if (!state.canExportPhrase) throw new Error("WALLET_EXPORT_UNAVAILABLE");
    let proof: Api.TypeInputCheckPasswordSRP | undefined;
    let parts: Api.wallet.SecretPhraseParts | undefined;
    for (let attempt = 0; attempt < 4; ++attempt) {
      this.checkStopped();
      try {
        parts = await this.rpc(
          this.client.invoke(new Api.wallet.ExportSecretPhrase({ password: proof }))
        );
        break;
      } catch (error) {
        if (
          !["PASSWORD_MISSING", "PASSWORD_HASH_INVALID", "SRP_ID_INVALID"].includes(code(error)) ||
          attempt === 3
        )
          throw error;
        assertPrimaryMatches(state);
        const password = await this.password();
        try {
          this.setStatus("recovering");
          const parameters = await this.rpc(this.client.invoke(new Api.account.GetPassword()));
          proof = await computeCheck(parameters, password.toString("utf8"));
        } finally {
          password.fill(0);
        }
      }
    }
    this.checkStopped();
    if (
      !parts ||
      !parts.token ||
      parts.dcs.length === 0 ||
      new Set(parts.dcs).size !== parts.dcs.length ||
      parts.dcs.some((dc) => !Number.isSafeInteger(dc) || dc < 1 || dc >= 10_000)
    )
      throw new Error("PHRASE_PARTS_INVALID");
    this.setStatus("recovering");
    const ephemeral = generateWalletEphemeralKey();
    const shares: Buffer[] = [];
    let phrase: Buffer | undefined;
    try {
      for (const dc of parts.dcs) {
        this.checkStopped();
        const sender = await this.rpc(this.client.getSender(dc));
        const encrypted = await this.rpc(
          this.client.invokeWithSender(
            new Api.wallet.FetchEncryptedSecretPhrasePart({
              token: parts.token,
              publicKey: ephemeral.publicKey,
            }),
            sender
          )
        );
        this.checkStopped();
        shares.push(decryptWalletShare(Buffer.from(encrypted.data), ephemeral.seed));
      }
      phrase = combineWalletShares(shares);
      const keys = deriveTelegramWalletKeys(phrase);
      const pair = keyPairFromSeed(keys.anchorSeed);
      const signing = keyPairFromSeed(keys.signingSeed);
      try {
        if (!signing.publicKey.equals(Buffer.from(state.publicKey)))
          throw new Error("WALLET_KEY_MISMATCH");
        const address = Address.parse(state.address);
        const wallet = [0x7fff7f11, 0x7fff7ffd]
          .map((id) => new NativeTelegramWallet(pair.publicKey, id))
          .find((w) => w.address.equals(address));
        if (!wallet) throw new Error("WALLET_ADDRESS_MISMATCH");
        const currentState = await this.rpc(this.client.invoke(new Api.wallet.GetState()));
        this.checkStopped();
        assertPrimaryMatches(currentState);
        if (
          !(currentState instanceof Api.WalletState) ||
          !wallet.address.equals(Address.parse(currentState.address)) ||
          !signing.publicKey.equals(Buffer.from(currentState.publicKey))
        )
          throw new Error("WALLET_KEY_MISMATCH");
        privateJSON(KEY_FILE, {
          scheme: "telegram-rotation",
          version: "telegram",
          walletId: wallet.walletId,
          anchorSeed: keys.anchorSeed.toString("hex"),
          signingSeed: keys.signingSeed.toString("hex"),
        });
        if (
          !setTelegramWalletVerification(
            state.address,
            Buffer.from(state.publicKey).toString("hex")
          )
        )
          throw new Error("PRIMARY_WALLET_MISMATCH");
        this.setStatus("ready");
        await this.notify(
          "Telegram wallet signing is ready. Keys are stored privately; no phrase or key was sent to the AI. No transaction was sent."
        );
      } finally {
        signing.secretKey.fill(0);
        keys.anchorSeed.fill(0);
        keys.signingSeed.fill(0);
        pair.secretKey.fill(0);
      }
    } finally {
      ephemeral.seed.fill(0);
      shares.forEach((part) => part.fill(0));
      phrase?.fill(0);
      proof = undefined;
    }
  }
}
