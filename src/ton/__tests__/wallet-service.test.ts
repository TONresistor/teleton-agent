import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WalletContractV5R1 } from "@ton/ton";
const root = vi.hoisted(() => `/tmp/teleton-wallet-service-${process.pid}`);
vi.mock("../../workspace/paths.js", () => ({ TELETON_ROOT: root }));
import {
  generateWallet,
  saveWallet,
  loadWallet,
  getKeyPair,
  createWalletContract,
  getHighloadKeyPair,
  importWallet,
  isTelegramWalletEnabled,
  setTelegramWalletVerification,
  clearTelegramWalletVerification,
} from "../wallet-service.js";
import { NativeTelegramWallet } from "../../telegram/wallet-protocol.js";
beforeEach(() => {
  clearTelegramWalletVerification();
  rmSync(root, { recursive: true, force: true });
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});
describe("wallet type compatibility", () => {
  it("creates TgWallet by default, restores its phrase and uses its anchor address", async () => {
    const wallet = await generateWallet();
    saveWallet(wallet);
    expect(loadWallet()?.version).toBe("tg");
    expect(isTelegramWalletEnabled()).toBe(false);
    saveWallet({ ...wallet, telegramAssociation: "linked" });
    expect(isTelegramWalletEnabled()).toBe(false);
    expect(setTelegramWalletVerification(wallet.address, wallet.publicKey)).toBe(true);
    expect(isTelegramWalletEnabled()).toBe(true);
    expect((await importWallet(wallet.mnemonic, "tg")).address).toBe(wallet.address);
    const keys = (await getKeyPair())!;
    const contract = createWalletContract(keys);
    expect(contract).toBeInstanceOf(NativeTelegramWallet);
    expect(contract.address.toString({ bounceable: false })).toBe(wallet.address);
    expect(keys.publicKey.toString("hex")).toBe(wallet.publicKey);
  });
  it("keeps existing V5R1 addresses and preserves their Highload key on a switch", async () => {
    const original = await generateWallet("w5r1");
    saveWallet(original);
    expect(isTelegramWalletEnabled()).toBe(false);
    const oldKeys = (await getKeyPair())!;
    expect(createWalletContract(oldKeys)).toBeInstanceOf(WalletContractV5R1);
    saveWallet(await generateWallet());
    expect(JSON.parse(readFileSync(join(root, "wallet-highload-legacy.json"), "utf8"))).toEqual(
      original
    );
    expect((await getHighloadKeyPair())!.publicKey).toEqual(oldKeys.publicKey);
    expect((await getKeyPair())!.publicKey).not.toEqual(oldKeys.publicKey);
  });
  it("requires live verification even for an old TgWallet without a status", async () => {
    const wallet = await generateWallet();
    saveWallet({ ...wallet, telegramAssociation: undefined });
    expect(isTelegramWalletEnabled()).toBe(false);
    expect(setTelegramWalletVerification(wallet.address, "00".repeat(32))).toBe(false);
    expect(setTelegramWalletVerification((await generateWallet()).address, wallet.publicKey)).toBe(
      false
    );
    expect(isTelegramWalletEnabled()).toBe(false);
    expect(setTelegramWalletVerification(wallet.address, wallet.publicKey)).toBe(true);
    expect(isTelegramWalletEnabled()).toBe(true);
    clearTelegramWalletVerification();
    expect(isTelegramWalletEnabled()).toBe(false);
  });
  it("revokes verification when saving or selecting another wallet", async () => {
    const wallet = await generateWallet();
    saveWallet({ ...wallet, telegramAssociation: "linked" });
    setTelegramWalletVerification(wallet.address, wallet.publicKey);
    saveWallet({ ...wallet, telegramAssociation: "linked" });
    expect(isTelegramWalletEnabled()).toBe(false);
    setTelegramWalletVerification(wallet.address, wallet.publicKey);
    saveWallet(await generateWallet("w5r1"));
    expect(isTelegramWalletEnabled()).toBe(false);
  });
  it("rejects a foreign Telegram signer source before signing", async () => {
    const wallet = await generateWallet();
    saveWallet({ ...wallet, keySource: "telegram-wallet", mnemonic: [] });
    const seed = Buffer.alloc(32, 5).toString("hex");
    writeFileSync(
      join(root, "telegram-wallet.json"),
      JSON.stringify({ scheme: "telegram-rotation", anchorSeed: seed, signingSeed: seed })
    );
    await expect(getKeyPair()).rejects.toThrow("address mismatch");
  });
});
