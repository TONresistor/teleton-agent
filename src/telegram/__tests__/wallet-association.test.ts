import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { Api, type TelegramClient } from "telegram";
import { keyPairFromSeed, signVerify } from "@ton/crypto";
import { createHash } from "node:crypto";
import { toLong } from "../../utils/gramjs-bigint.js";
const mocks = vi.hoisted(() => ({
  root: `/tmp/wallet-association-${process.pid}`,
  primary: undefined as any,
  save: vi.fn(),
  srp: vi.fn(),
  verified: vi.fn(() => true),
  revoke: vi.fn(),
}));
vi.mock("../../workspace/paths.js", () => ({ TELETON_ROOT: mocks.root }));
vi.mock("../../ton/wallet-service.js", () => ({
  setTelegramWalletVerification: mocks.verified,
  clearTelegramWalletVerification: mocks.revoke,
  loadWallet: () => mocks.primary,
  saveWallet: (value: any) => {
    mocks.save(value);
    mocks.primary = value;
  },
}));
vi.mock("telegram/Password.js", () => ({ computeCheck: mocks.srp }));
import { TelegramWalletBootstrap } from "../wallet-bootstrap.js";
import { deriveTelegramWalletKeys, NativeTelegramWallet } from "../wallet-protocol.js";
const phrase = "notice tortoise soup strong gun divide offer process salon siren general carry";
const seeds = deriveTelegramWalletKeys(Buffer.from(phrase));
const pair = keyPairFromSeed(seeds.signingSeed);
const wallet = new NativeTelegramWallet(pair.publicKey);
const expected = () =>
  new Api.WalletState({
    address: wallet.address.toString(),
    publicKey: pair.publicKey,
    balance: toLong(0),
  });
let state: Api.TypeWalletState;
const send = vi.fn(),
  invoke = vi.fn(),
  notify = vi.fn();
let controller: TelegramWalletBootstrap;
const client = {
  session: { dcId: 2 },
  getSender: vi.fn(async () => ({ send })),
  invoke,
  sendMessage: notify,
  getMessages: vi.fn(async () => []),
} as unknown as TelegramClient;
beforeEach(() => {
  vi.clearAllMocks();
  mkdirSync(mocks.root, { recursive: true });
  mocks.primary = {
    version: "tg",
    address: wallet.address.toString({ bounceable: false }),
    publicKey: pair.publicKey.toString("hex"),
    walletId: wallet.walletId,
    mnemonic: phrase.split(" "),
    createdAt: "now",
    telegramAssociation: "pending",
  };
  state = new Api.WalletStateEmpty({});
  invoke.mockImplementation(async (request) => {
    if (request instanceof Api.wallet.GetState) return state;
    if (request instanceof Api.wallet.GetProofChallenge)
      return new Api.wallet.ProofChallenge({
        domain: "telegram.org",
        payload: "one-shot-challenge",
        expires: Math.floor(Date.now() / 1000) + 300,
      });
    if (request instanceof Api.account.GetPassword) return {};
    return {};
  });
  send.mockImplementation(async (request) => {
    expect(request).toBeInstanceOf(Api.wallet.ReplaceWallet);
    expect(request.wallet).toBeInstanceOf(Api.InputWalletImported);

    const proof = request.wallet.proof,
      domain = Buffer.from("telegram.org"),
      wc = Buffer.alloc(4),
      n = Buffer.alloc(4),
      ts = Buffer.alloc(8);
    wc.writeInt32BE(0);
    n.writeUInt32LE(domain.length);
    ts.writeBigUInt64LE(BigInt(proof.timestamp));
    const hash = (v: Buffer) => createHash("sha256").update(v).digest();
    const h = hash(
      Buffer.concat([
        Buffer.from([255, 255]),
        Buffer.from("ton-connect"),
        hash(
          Buffer.concat([
            Buffer.from("ton-proof-item-v2/"),
            wc,
            wallet.address.hash,
            n,
            domain,
            ts,
            Buffer.from("one-shot-challenge"),
          ])
        ),
      ])
    );
    expect(signVerify(h, proof.signature, request.wallet.publicKey)).toBe(true);
    state = expected();
    return state;
  });
  notify.mockResolvedValue({ id: 900 });
  mocks.srp.mockResolvedValue(
    new Api.InputCheckPasswordSRP({ srpId: toLong(1), A: Buffer.from([1]), M1: Buffer.from([2]) })
  );
  controller = new TelegramWalletBootstrap(client, 42);
});
afterEach(() => {
  controller.stop();
  rmSync(mocks.root, { recursive: true, force: true });
});
describe("new-onboarding TgWallet association", () => {
  it("imports once, verifies served state, installs private keys and enables the linked primary", async () => {
    await controller.start();
    expect(send).toHaveBeenCalledTimes(1);
    expect(controller.status).toBe("ready");
    expect(mocks.verified).toHaveBeenCalledWith(
      wallet.address.toString(),
      pair.publicKey.toString("hex")
    );
    expect(mocks.primary.telegramAssociation).toBe("linked");
    expect(mocks.primary.keySource).toBe("telegram-wallet");
    expect(mocks.primary.mnemonic).toEqual([]);
    const path = join(mocks.root, "telegram-wallet.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8")).signingSeed).toBe(
      seeds.signingSeed.toString("hex")
    );
    expect(JSON.stringify(notify.mock.calls)).not.toContain(phrase);
  });
  it("reconciles a completed import after a restart without replacing again", async () => {
    state = expected();
    writeFileSync(
      join(mocks.root, "telegram-wallet-association.json"),
      JSON.stringify({ address: mocks.primary.address, status: "submitted" })
    );
    await controller.start();
    expect(send).not.toHaveBeenCalled();
    expect(controller.status).toBe("ready");
  });
  it("never replaces a different existing Telegram wallet", async () => {
    state = new Api.WalletState({
      address: new NativeTelegramWallet(
        keyPairFromSeed(Buffer.alloc(32, 5)).publicKey
      ).address.toString(),
      publicKey: keyPairFromSeed(Buffer.alloc(32, 5)).publicKey,
      balance: toLong(0),
    });
    await controller.start();
    expect(send).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(controller.status).toBe("blocked");
    expect(
      JSON.parse(readFileSync(join(mocks.root, "telegram-wallet-auth-status.json"), "utf8")).code
    ).toBe("TELEGRAM_WALLET_ALREADY_EXISTS");
  });
  it("preserves an ambiguous submission and never resends on restart", async () => {
    send.mockRejectedValue(new Error("connection lost"));
    await controller.start();
    expect(controller.status).toBe("blocked");
    expect(mocks.save).not.toHaveBeenCalled();
    controller.stop();
    controller = new TelegramWalletBootstrap(client, 42);
    await controller.start();
    expect(send).toHaveBeenCalledTimes(1);
    expect(controller.status).toBe("blocked");
  });
  it("keeps an existing V5R1 untouched without calling the wallet API", async () => {
    mocks.primary = { ...mocks.primary, version: "w5r1", telegramAssociation: undefined };
    await controller.start();
    expect(invoke).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(controller.status).toBe("disabled");
  });
  it("rejects an expired ownership challenge without submitting", async () => {
    const original = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (request) =>
      request instanceof Api.wallet.GetProofChallenge
        ? new Api.wallet.ProofChallenge({ domain: "telegram.org", payload: "expired", expires: 1 })
        : original(request)
    );
    await controller.start();
    expect(send).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(controller.status).toBe("blocked");
  });
  it("accepts 2FA only as the admin's reply to its exact DM and uses a fresh challenge", async () => {
    const success = send.getMockImplementation()!;
    send
      .mockImplementationOnce(async () => {
        throw { errorMessage: "PASSWORD_MISSING" };
      })
      .mockImplementation(success);
    const running = controller.start();
    await vi.waitFor(() => expect(controller.status).toBe("waiting_2fa"));
    const wrong = new Api.Message({
      id: 901,
      peerId: new Api.PeerUser({ userId: toLong(42) }),
      date: 1,
      message: "password",
      replyTo: new Api.MessageReplyHeader({ replyToMsgId: 899 }),
    });
    expect(await controller.consume(wrong)).toBe(false);
    const reply = new Api.Message({
      id: 902,
      peerId: new Api.PeerUser({ userId: toLong(42) }),
      date: 1,
      message: "private-password",
      replyTo: new Api.MessageReplyHeader({ replyToMsgId: 900 }),
    });
    expect(await controller.consume(reply)).toBe(true);
    expect(reply.message).toBe("");
    await running;
    expect(controller.status).toBe("ready");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].password).toBeInstanceOf(Api.InputCheckPasswordSRP);
    expect(
      invoke.mock.calls.filter(([request]) => request instanceof Api.wallet.GetProofChallenge)
    ).toHaveLength(2);
    for (const name of [
      "telegram-wallet.json",
      "telegram-wallet-association.json",
      "telegram-wallet-auth-requests.json",
    ])
      expect(readFileSync(join(mocks.root, name), "utf8")).not.toContain("private-password");
  });
  it("reconciles a lost success response without sending again", async () => {
    send.mockImplementation(async () => {
      state = expected();
      throw new Error("lost response");
    });
    await controller.start();
    expect(send).toHaveBeenCalledTimes(1);
    expect(controller.status).toBe("ready");
  });
});
