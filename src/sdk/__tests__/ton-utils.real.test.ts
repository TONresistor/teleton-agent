/**
 * ton-utils.real.test.ts
 *
 * Tests for toNano / fromNano / validateAddress using the REAL @ton/ton and
 * @ton/core implementations — no mock for those two packages.
 *
 * Only infrastructure modules (wallet-service, transfer, http clients…) are
 * mocked so we can instantiate createTonSDK without side-effects.
 */

import { describe, it, expect, vi } from "vitest";
import { PluginSDKError } from "@teleton-agent/sdk";

// ─── Mock infrastructure — NOT @ton/ton or @ton/core ─────────────────────────

vi.mock("../../ton/wallet-service.js", () => ({
  getWalletAddress: vi.fn(),
  getWalletBalance: vi.fn(),
  getTonPrice: vi.fn(),
  loadWallet: vi.fn(),
  getKeyPair: vi.fn(),
}));

vi.mock("../../ton/transfer.js", () => ({
  sendTon: vi.fn(),
}));

vi.mock("../../constants/limits.js", () => ({
  PAYMENT_TOLERANCE_RATIO: 0.99,
}));

vi.mock("../../utils/retry.js", () => ({
  withBlockchainRetry: vi.fn(),
}));

vi.mock("../../constants/api-endpoints.js", () => ({
  tonapiFetch: vi.fn(),
}));

vi.mock("../../ton/endpoint.js", () => ({
  getCachedHttpEndpoint: vi.fn().mockResolvedValue("https://toncenter.test"),
}));

vi.mock("../../ton/format-transactions.js", () => ({
  formatTransactions: vi.fn((txs: any[]) => txs),
}));

// withTxLock is a passthrough in this context (no real transactions sent)
vi.mock("../../ton/tx-lock.js", () => ({
  withTxLock: vi.fn((fn: () => Promise<any>) => fn()),
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import { createTonSDK } from "../ton.js";

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// SDK instance — db is null (utilities do not require a database)
const sdk = createTonSDK(mockLog as any, null);

// ─── Known-valid TON address (EQ bounceable, verified on mainnet) ─────────────
const VALID_BOUNCEABLE = "EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2";
// Same address in raw hex format (both should parse correctly)
const VALID_RAW_HEX = "0:ed169130705004711b99c35615c6fd41a16e7b52bea6dcb87f6f84d3e6b57f7e";

// ─────────────────────────────────────────────────────────────────────────────

describe("TonSDK utility methods — real @ton/ton + @ton/core", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // toNano()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("toNano()", () => {
    it("converts 1.5 (number) → 1_500_000_000n", () => {
      expect(sdk.toNano(1.5)).toBe(BigInt("1500000000"));
    });

    it("converts '1.5' (string) → 1_500_000_000n", () => {
      expect(sdk.toNano("1.5")).toBe(BigInt("1500000000"));
    });

    it("converts integer 2 → 2_000_000_000n", () => {
      expect(sdk.toNano(2)).toBe(BigInt("2000000000"));
    });

    it("converts 0 → 0n", () => {
      expect(sdk.toNano(0)).toBe(BigInt(0));
    });

    it("converts sub-nano precision '0.5' → 500_000_000n", () => {
      expect(sdk.toNano("0.5")).toBe(BigInt("500000000"));
    });

    it("converts large amount 1_000_000 → 1_000_000_000_000_000n", () => {
      expect(sdk.toNano(1_000_000)).toBe(BigInt("1000000000000000"));
    });

    // The library allows negative values — SDK utility does not add extra guard
    // (amount validation is the responsibility of sendTON / sendJetton)
    it("accepts negative values (library behaviour) → negative bigint", () => {
      expect(sdk.toNano(-1)).toBe(BigInt("-1000000000"));
    });

    it("throws PluginSDKError on non-numeric string 'not_a_number'", () => {
      expect(() => sdk.toNano("not_a_number")).toThrow(PluginSDKError);
    });

    it("throws PluginSDKError on NaN", () => {
      expect(() => sdk.toNano(NaN)).toThrow(PluginSDKError);
    });

    it("throws PluginSDKError on Infinity", () => {
      expect(() => sdk.toNano(Infinity)).toThrow(PluginSDKError);
    });

    it("throws PluginSDKError on scientific notation string '1e9'", () => {
      // @ton/core's parser does not support 'e' notation
      expect(() => sdk.toNano("1e9")).toThrow(PluginSDKError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // fromNano()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("fromNano()", () => {
    it("converts 1_500_000_000n → '1.5'", () => {
      expect(sdk.fromNano(BigInt("1500000000"))).toBe("1.5");
    });

    it("converts 3_000_000_000n → '3'", () => {
      expect(sdk.fromNano(BigInt("3000000000"))).toBe("3");
    });

    it("converts 0n → '0'", () => {
      expect(sdk.fromNano(BigInt(0))).toBe("0");
    });

    it("accepts string input '1500000000' → '1.5'", () => {
      expect(sdk.fromNano("1500000000")).toBe("1.5");
    });

    it("preserves precision: 1n → '0.000000001'", () => {
      expect(sdk.fromNano(BigInt(1))).toBe("0.000000001");
    });

    it("preserves precision: 999_999_999n → '0.999999999'", () => {
      expect(sdk.fromNano(BigInt("999999999"))).toBe("0.999999999");
    });

    it("round-trips with toNano for 2.5", () => {
      expect(sdk.fromNano(sdk.toNano(2.5))).toBe("2.5");
    });

    it("round-trips with toNano for 0.1", () => {
      expect(sdk.fromNano(sdk.toNano("0.1"))).toBe("0.1");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // validateAddress()
  // ═══════════════════════════════════════════════════════════════════════════

  describe("validateAddress()", () => {
    it("returns true for a valid bounceable address (EQ…)", () => {
      expect(sdk.validateAddress(VALID_BOUNCEABLE)).toBe(true);
    });

    it("returns true for a valid raw hex address (0:…)", () => {
      expect(sdk.validateAddress(VALID_RAW_HEX)).toBe(true);
    });

    it("returns false for an empty string", () => {
      expect(sdk.validateAddress("")).toBe(false);
    });

    it("returns false for a random alphanumeric string", () => {
      expect(sdk.validateAddress("not-an-address")).toBe(false);
    });

    it("returns false for a truncated address", () => {
      expect(sdk.validateAddress("EQDtFpEwcFAEc")).toBe(false);
    });

    it("returns false for a raw address with short hex payload", () => {
      expect(sdk.validateAddress("0:abc123")).toBe(false);
    });

    it("returns false for a URL that looks like an address", () => {
      expect(sdk.validateAddress("https://ton.org/wallet")).toBe(false);
    });
  });
});
