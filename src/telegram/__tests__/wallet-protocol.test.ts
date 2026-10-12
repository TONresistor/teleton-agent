import { describe, expect, it } from "vitest";
import { keyPairFromSeed, signVerify } from "@ton/crypto";
import { internal, SendMode } from "@ton/core";
import {
  decryptWalletData,
  deriveTelegramWalletKeys,
  NativeTelegramWallet,
  walletSharedSecret,
  generateTelegramWalletMnemonic,
} from "../wallet-protocol.js";

describe("official Telegram wallet protocol", () => {
  it("decrypts the independent TDLib simple_message golden vector", () => {
    const secret = Buffer.from(
      "f9fb473b9887e50ea38eef7380c82361432cd4b22c5f9b3700809990d8ed344c",
      "hex"
    );
    const ciphertext = Buffer.from(
      "967f5245b03e07ab7be6044174306a4af811e96708ae3ad2ab427aa5495508b1c319ca0353531c0a2921e307f2455856",
      "hex"
    );
    expect(decryptWalletData(ciphertext, secret).toString()).toBe("Hello, World!");
    ciphertext[20] ^= 1;
    expect(() => decryptWalletData(ciphertext, secret)).toThrow("PHRASE_PART_INVALID");
  });
  it("matches wallet-engine's independent SLIP-0010 anchor key vector", () => {
    const half = "notice tortoise soup strong gun divide offer process salon siren general carry";
    const keys = deriveTelegramWalletKeys(Buffer.from(half));
    expect(keyPairFromSeed(keys.anchorSeed).publicKey.toString("hex")).toBe(
      "b15818c2ee759a300db662988f9b0b484e4135071075d67b478704030b2a1514"
    );
    expect(keys.signingSeed.equals(keys.anchorSeed)).toBe(true);
    const rotated = deriveTelegramWalletKeys(
      Buffer.from(`${half} clump left year void clutch tool case burden fix income champion lounge`)
    );
    expect(rotated.anchorSeed.equals(keys.anchorSeed)).toBe(true);
    expect(rotated.signingSeed.equals(keys.anchorSeed)).toBe(false);
    expect(() => deriveTelegramWalletKeys(Buffer.from("abandon ".repeat(12)))).toThrow(
      "PHRASE_INVALID"
    );
  });
  it("generates a fresh native wallet with the deployment signing key", () => {
    const words = generateTelegramWalletMnemonic();
    expect(words).toHaveLength(12);
    const seeds = deriveTelegramWalletKeys(Buffer.from(words.join(" ")));
    expect(seeds.anchorSeed.equals(seeds.signingSeed)).toBe(true);
  });
  it.each([2, 4, 5, 7, 255])("encodes %i messages as the contract's Tolk array", (count) => {
    const pair = keyPairFromSeed(Buffer.alloc(32, 1));
    const wallet = new NativeTelegramWallet(pair.publicKey);
    const messages = Array.from({ length: count }, (_, i) =>
      internal({ to: wallet.address, value: BigInt(i + 1) })
    );
    const body = wallet.createTransfer({
      seqno: 0,
      secretKey: pair.secretKey,
      timeout: 1900000000,
      sendMode: 1,
      messages,
    });
    const slice = body.beginParse();
    const signature = slice.loadBuffer(64);
    expect(signVerify(slice.asCell().hash(), signature, pair.publicKey)).toBe(true);
    expect(slice.loadUint(32)).toBe(0x73896e75);
    slice.skip(96);
    expect(slice.loadUint(8)).toBe(count);
    let head = slice.loadMaybeRef();
    let decoded = 0;
    while (head) {
      const chunk = head.beginParse();
      head = chunk.loadMaybeRef();
      while (chunk.remainingRefs) {
        expect(chunk.loadUint(8)).toBe(3);
        chunk.loadRef();
        decoded++;
      }
      expect(chunk.remainingBits).toBe(0);
    }
    expect(decoded).toBe(count);
  });
  it("uses TDLib's Ed25519-to-X25519 shared-secret derivation symmetrically", () => {
    const a = Buffer.alloc(32, 1),
      b = Buffer.alloc(32, 2);
    expect(walletSharedSecret(a, keyPairFromSeed(b).publicKey)).toEqual(
      walletSharedSecret(b, keyPairFromSeed(a).publicKey)
    );
    expect(() => walletSharedSecret(a, Buffer.alloc(32))).toThrow();
  });
  it("serializes and signs the official native Wallet revision-00 request", () => {
    const pair = keyPairFromSeed(Buffer.alloc(32, 1));
    const wallet = new NativeTelegramWallet(pair.publicKey);
    const body = wallet.createTransfer({
      seqno: 5,
      timeout: 1_900_000_000,
      secretKey: pair.secretKey,
      sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
      messages: [internal({ to: wallet.address, value: 1n })],
    });
    const slice = body.beginParse();
    const signature = slice.loadBuffer(64);
    expect(signVerify(slice.asCell().hash(), signature, pair.publicKey)).toBe(true);
    expect(slice.loadUint(32)).toBe(0x63896e75);
    expect(slice.loadUint(32)).toBe(0x7fff7f11);
    expect(slice.loadUint(32)).toBe(1_900_000_000);
    expect(slice.loadUint(32)).toBe(5);
    expect(slice.loadUint(8)).toBe(3);
    expect(slice.remainingRefs).toBe(1);
    expect(wallet.init.code.hash().toString("hex")).toBe(
      "9149ae51c1e4689710cebf7830297b16acfbadb363a920a537893e7ffeeca768"
    );
  });
});
