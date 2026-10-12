import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, createHmac } from "node:crypto";
import { Api, type TelegramClient } from "telegram";
import { keyPairFromSeed } from "@ton/crypto";
import { toLong } from "../../utils/gramjs-bigint.js";

const mocks = vi.hoisted(() => ({
  root: `/tmp/wallet-bootstrap-${process.pid}`,
  computeCheck: vi.fn(),
  primary: undefined as any,
  verified: vi.fn(() => true),
  revoke: vi.fn(),
}));
vi.mock("../../workspace/paths.js", () => ({ TELETON_ROOT: mocks.root }));
vi.mock("../../ton/wallet-service.js", () => ({
  loadWallet: () => mocks.primary,
  setTelegramWalletVerification: mocks.verified,
  clearTelegramWalletVerification: mocks.revoke,
  saveWallet: vi.fn(),
}));
vi.mock("telegram/Password.js", () => ({ computeCheck: mocks.computeCheck }));
import { TelegramWalletBootstrap } from "../wallet-bootstrap.js";
import {
  deriveTelegramWalletKeys,
  NativeTelegramWallet,
  walletSharedSecret,
} from "../wallet-protocol.js";

const phrase = "notice tortoise soup strong gun divide offer process salon siren general carry";
const owner = 42;
const invoke = vi.fn(),
  invokeWithSender = vi.fn(),
  sendMessage = vi.fn(),
  getSender = vi.fn();
const getMessages = vi.fn();
const client = {
  invoke,
  invokeWithSender,
  sendMessage,
  getSender,
  getMessages,
} as unknown as TelegramClient;
let controller: TelegramWalletBootstrap | undefined;
function seal(share: Buffer, peer: Buffer): Buffer {
  const seed = Buffer.alloc(32, 9);
  const publicKey = keyPairFromSeed(seed).publicKey;
  const secret = walletSharedSecret(seed, peer);
  const data = Buffer.alloc(220);
  data.writeUInt32LE(0x8b90dd08);
  data[4] = 215;
  share.copy(data, 5);
  const prefix = Buffer.alloc(20);
  prefix[0] = 20;
  const plain = Buffer.concat([prefix, data]);
  const expanded = createHmac("sha512", secret).update("tde2e_encrypt_data").digest();
  const msgId = createHmac("sha256", expanded.subarray(32))
    .update(Buffer.concat([plain, Buffer.alloc(4)]))
    .digest()
    .subarray(0, 16);
  const aes = createHmac("sha512", expanded.subarray(0, 32)).update(msgId).digest();
  const cipher = createCipheriv("aes-256-cbc", aes.subarray(0, 32), aes.subarray(32, 48));
  cipher.setAutoPadding(false);
  return Buffer.concat([publicKey, msgId, cipher.update(plain), cipher.final()]);
}
function reply(id = 900, sender = owner, group = false): Api.Message {
  return new Api.Message({
    id: 901,
    peerId: group
      ? new Api.PeerChat({ chatId: toLong(sender) })
      : new Api.PeerUser({ userId: toLong(sender) }),
    fromId: new Api.PeerUser({ userId: toLong(sender) }),
    date: 1,
    message: "private-password",
    replyTo: new Api.MessageReplyHeader({ replyToMsgId: id }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  getMessages.mockResolvedValue([]);
  mkdirSync(mocks.root, { recursive: true });
  const keys = deriveTelegramWalletKeys(Buffer.from(phrase));
  const publicKey = keyPairFromSeed(keys.anchorSeed).publicKey;
  const state = new Api.WalletState({
    address: new NativeTelegramWallet(publicKey).address.toString(),
    publicKey,
    balance: toLong(1),
    canExportPhrase: true,
  });
  mocks.primary = { version: "tg", address: state.address, publicKey: publicKey.toString("hex") };
  invoke.mockImplementation(async (request) => {
    if (request instanceof Api.wallet.GetState) return state;
    if (request instanceof Api.wallet.ExportSecretPhrase) {
      if (!request.password) throw { errorMessage: "PASSWORD_MISSING" };
      return new Api.wallet.SecretPhraseParts({ token: "private-export-token", dcs: [2, 3] });
    }
    return {};
  });
  getSender.mockImplementation(async (dc) => ({ dcId: dc }));
  const padded = Buffer.alloc(215, 32);
  Buffer.from(phrase).copy(padded);
  const shares = [Buffer.alloc(215, 7), Buffer.from(padded)];
  for (let i = 0; i < 215; ++i) shares[1][i] ^= shares[0][i];
  invokeWithSender.mockImplementation(
    async (request, sender) =>
      new Api.wallet.EncryptedSecretPhrasePart({
        data: seal(shares[sender.dcId === 2 ? 0 : 1], request.publicKey),
      })
  );
  sendMessage.mockResolvedValue({ id: 900 });
  mocks.computeCheck.mockResolvedValue(
    new Api.InputCheckPasswordSRP({ srpId: toLong(1), A: Buffer.alloc(1), M1: Buffer.alloc(1) })
  );
});
afterEach(() => {
  controller?.stop();
  controller = undefined;
  rmSync(mocks.root, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("deterministic Telegram wallet bootstrap", () => {
  it.each(["address", "publicKey"])(
    "refuses a different principal %s before exporting or overwriting keys",
    async (field) => {
      mocks.primary[field] =
        field === "address"
          ? new NativeTelegramWallet(
              keyPairFromSeed(Buffer.alloc(32, 3)).publicKey
            ).address.toString()
          : "00".repeat(32);
      controller = new TelegramWalletBootstrap(client, owner);
      await controller.start();
      expect(controller.status).toBe("blocked");
      expect(
        invoke.mock.calls.filter(([request]) => request instanceof Api.wallet.ExportSecretPhrase)
      ).toHaveLength(0);
      expect(mocks.verified).not.toHaveBeenCalled();
    }
  );
  it("never installs an old recovered key if the account and principal change during 2FA", async () => {
    const original = invoke.getMockImplementation()!;
    let reads = 0;
    const foreignPublic = keyPairFromSeed(Buffer.alloc(32, 8)).publicKey;
    const foreignState = new Api.WalletState({
      address: new NativeTelegramWallet(foreignPublic).address.toString(),
      publicKey: foreignPublic,
      balance: toLong(0),
    });
    invoke.mockImplementation(async (request) => {
      if (request instanceof Api.wallet.GetState && ++reads > 1) {
        mocks.primary = {
          version: "tg",
          address: foreignState.address,
          publicKey: foreignPublic.toString("hex"),
        };
        return foreignState;
      }
      return original(request);
    });
    controller = new TelegramWalletBootstrap(client, owner);
    const running = controller.start();
    await vi.waitFor(() => expect(controller?.status).toBe("waiting_2fa"));
    await controller.consume(reply());
    await running;
    expect(controller.status).toBe("blocked");
    expect(mocks.verified).not.toHaveBeenCalled();
    expect(() => readFileSync(join(mocks.root, "telegram-wallet.json"))).toThrow();
  });
  it("suppresses a reply to an old auth DM even if request metadata was lost", async () => {
    controller = new TelegramWalletBootstrap(client, owner);
    getMessages.mockResolvedValue([
      new Api.Message({
        id: 900,
        out: true,
        peerId: new Api.PeerUser({ userId: toLong(owner) }),
        date: 1,
        message: "[Teleton wallet — 2FA]\nOld request",
      }),
    ]);
    const message = reply();
    expect(await controller.consume(message)).toBe(true);
    expect(message.message).toBe("");
    expect(mocks.computeCheck).not.toHaveBeenCalled();
  });
  it("accepts only the owner's reply to the exact private request, recovers keys and never persists password/phrase", async () => {
    controller = new TelegramWalletBootstrap(client, owner);
    const job = controller.start();
    await vi.waitFor(() => expect(controller?.status).toBe("waiting_2fa"));
    expect(await controller.consume(reply(899))).toBe(false);
    expect(await controller.consume(reply(900, 43))).toBe(false);
    expect(await controller.consume(reply(900, owner, true))).toBe(false);
    expect(mocks.computeCheck).not.toHaveBeenCalled();
    const message = reply();
    expect(await controller.consume(message)).toBe(true);
    expect(message.message).toBe("");
    await job;
    expect(controller.status).toBe("ready");
    expect(mocks.computeCheck.mock.calls[0][1]).toBe("private-password");
    expect(getSender.mock.calls.map((row) => row[0])).toEqual([2, 3]);
    const cache = readFileSync(join(mocks.root, "telegram-wallet.json"), "utf8");
    expect(cache).not.toContain(phrase);
    expect(cache).not.toContain("private-password");
    expect(statSync(join(mocks.root, "telegram-wallet.json")).mode & 0o077).toBe(0);
    expect(JSON.stringify(sendMessage.mock.calls)).not.toContain("private-password");
    expect(await controller.consume(reply())).toBe(true);
    expect(mocks.computeCheck).toHaveBeenCalledTimes(1);
  });
  it("expires requests without accepting late secrets", async () => {
    vi.useFakeTimers();
    controller = new TelegramWalletBootstrap(client, owner);
    const job = controller.start();
    await vi.waitFor(() => expect(controller?.status).toBe("waiting_2fa"));
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    await job;
    expect(controller.status).toBe("blocked");
    const message = reply();
    expect(await controller.consume(message)).toBe(true);
    expect(message.message).toBe("");
    expect(mocks.computeCheck).not.toHaveBeenCalled();
  });
  it("does not request passwords when the server refuses export", async () => {
    invoke.mockRejectedValue({ errorMessage: "WALLET_UNAVAILABLE" });
    controller = new TelegramWalletBootstrap(client, owner);
    await controller.start();
    expect(controller.status).toBe("blocked");
    expect(mocks.computeCheck).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[0][1].message).toContain("WALLET_UNAVAILABLE");
  });
  it("suppresses late password replies even after a process restart", async () => {
    controller = new TelegramWalletBootstrap(client, owner);
    const job = controller.start();
    await vi.waitFor(() => expect(controller?.status).toBe("waiting_2fa"));
    controller.stop();
    await job;
    controller = new TelegramWalletBootstrap(client, owner);
    const message = reply();
    expect(await controller.consume(message)).toBe(true);
    expect(message.message).toBe("");
    expect(mocks.computeCheck).not.toHaveBeenCalled();
  });
});
