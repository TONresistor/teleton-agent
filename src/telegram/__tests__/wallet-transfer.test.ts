import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Api, type TelegramClient } from "telegram";
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import { Cell, loadMessage } from "@ton/core";
import { toLong } from "../../utils/gramjs-bigint.js";

const mocks = vi.hoisted(() => ({
  root: `/tmp/teleton-wallet-transfer-${process.pid}`,
  state: vi.fn(),
  seqno: vi.fn(),
  account: vi.fn(),
}));
vi.mock("../../workspace/paths.js", () => ({ TELETON_ROOT: mocks.root }));
vi.mock("../../ton/wallet-service.js", () => ({
  getCachedTonClient: async () => ({
    getContractState: mocks.account,
    open: () => ({ getSeqno: mocks.seqno }),
  }),
}));
import { sendTelegramWalletTransfer, telegramWalletSigner } from "../wallet-transfer.js";

let words: string[];
let wallet: WalletContractV4;
let state: Api.WalletState;
const send = vi.fn();
const invoke = vi.fn();
const client = {
  invoke,
  getSender: async () => ({ send }),
  session: { dcId: 2 },
} as unknown as TelegramClient;
const keyFile = join(mocks.root, "telegram-wallet.json");
const pendingFile = join(mocks.root, "telegram-wallet-pending.json");
const params = { to: "", amount: "0.1", comment: "test" };

beforeAll(async () => {
  words = await mnemonicNew();
  const keys = await mnemonicToPrivateKey(words);
  wallet = WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey });
  state = new Api.WalletState({
    address: wallet.address.toString(),
    publicKey: keys.publicKey,
    balance: toLong("1000000000"),
  });
  params.to = wallet.address.toString();
});
beforeEach(() => {
  vi.clearAllMocks();
  rmSync(mocks.root, { recursive: true, force: true });
  mkdirSync(mocks.root);
  writeFileSync(keyFile, JSON.stringify({ version: "v4", mnemonic: words }), { mode: 0o600 });
  mocks.seqno.mockResolvedValue(7);
  mocks.account.mockResolvedValue({ state: "active", code: wallet.init.code.toBoc() });
  invoke.mockImplementation(async (request) =>
    request instanceof Api.wallet.GetState
      ? state
      : new Api.wallet.Transactions({ balance: toLong(1), transactions: [], chats: [], users: [] })
  );
  send.mockResolvedValue(
    new Api.Updates({
      updates: [new Api.UpdateSentWalletTransaction({ msgHash: "receipt-hash" })],
      users: [],
      chats: [],
      date: 0,
      seq: 0,
    })
  );
});
afterAll(() => {
  rmSync(mocks.root, { recursive: true, force: true });
});

describe("Telegram wallet transfers", () => {
  it("supports a standard v5r1 wallet whose key and address match Telegram", async () => {
    const keys = await mnemonicToPrivateKey(words);
    const v5 = WalletContractV5R1.create({ workchain: 0, publicKey: keys.publicKey });
    writeFileSync(keyFile, JSON.stringify({ version: "v5r1", mnemonic: words }), { mode: 0o600 });
    invoke.mockResolvedValue(
      new Api.WalletState({
        address: v5.address.toString(),
        publicKey: keys.publicKey,
        balance: toLong("1000000000"),
      })
    );
    mocks.account.mockResolvedValue({ state: "active", code: v5.init.code.toBoc() });
    expect((await sendTelegramWalletTransfer(client, params)).status).toBe("submitted");
    const message = loadMessage(Cell.fromBoc(send.mock.calls[0][0].dataNormal)[0].beginParse());
    if (message.info.type !== "external-in") throw new Error("Expected external message");
    expect(message.info.dest.equals(v5.address)).toBe(true);
  });

  it("signs the matching wallet and submits a single RPC without exposing the key", async () => {
    const result = await sendTelegramWalletTransfer(client, params);
    expect(result.status).toBe("submitted");
    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0][0] as Api.wallet.SendTransfer;
    expect(request).toBeInstanceOf(Api.wallet.SendTransfer);
    expect(request.userId).toBeInstanceOf(Api.InputUserEmpty);
    expect(request.dataGasless).toBeUndefined();
    const message = loadMessage(Cell.fromBoc(request.dataNormal)[0].beginParse());
    expect(message.info.type).toBe("external-in");
    if (message.info.type === "external-in")
      expect(message.info.dest.equals(wallet.address)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(words.join(" "));
    expect(JSON.parse(readFileSync(pendingFile, "utf8")).messageHash).toBe("receipt-hash");
  });
  it("refuses a missing signing key before broadcasting", async () => {
    rmSync(keyFile);
    await expect(sendTelegramWalletTransfer(client, params)).rejects.toThrow(
      "signing key is not configured"
    );
    expect(send).not.toHaveBeenCalled();
  });
  it("refuses unsafe permissions and mismatched public keys", async () => {
    chmodSync(keyFile, 0o644);
    await expect(telegramWalletSigner(state)).rejects.toThrow("0600");
    chmodSync(keyFile, 0o600);
    await expect(
      telegramWalletSigner(
        new Api.WalletState({
          address: state.address,
          publicKey: Buffer.alloc(32),
          balance: toLong(1),
        })
      )
    ).rejects.toThrow("public key");
  });
  it("refuses a different on-chain wallet implementation", async () => {
    mocks.account.mockResolvedValue({ state: "active", code: Cell.EMPTY.toBoc() });
    await expect(sendTelegramWalletTransfer(client, params)).rejects.toThrow("on-chain code");
    expect(send).not.toHaveBeenCalled();
  });
  it("retains unknown outcomes across calls and never automatically resends", async () => {
    send.mockRejectedValue(new Error("TIMEOUT"));
    expect((await sendTelegramWalletTransfer(client, params)).status).toBe("unknown");
    await expect(sendTelegramWalletTransfer(client, params)).rejects.toThrow("still unresolved");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("clears the pending marker on an explicit Telegram rejection", async () => {
    send.mockRejectedValue(Object.assign(new Error("WALLET_KEY_MISMATCH"), { code: 400 }));
    await expect(sendTelegramWalletTransfer(client, params)).rejects.toThrow("WALLET_KEY_MISMATCH");
    expect(existsSync(pendingFile)).toBe(false);
  });
  it.each(["0", "-1", "0.0000000001", "NaN", "1e2"])(
    "rejects invalid amount %s",
    async (amount) => {
      await expect(sendTelegramWalletTransfer(client, { ...params, amount })).rejects.toThrow(
        "Amount"
      );
      expect(send).not.toHaveBeenCalled();
    }
  );
});
