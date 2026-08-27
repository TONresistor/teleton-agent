import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { PluginSDKError } from "@teleton-agent/sdk";
import Database from "better-sqlite3";

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock("../../ton/wallet-service.js", () => ({
  getWalletAddress: vi.fn(),
  getWalletBalance: vi.fn(),
  getTonPrice: vi.fn(),
  loadWallet: vi.fn(),
  getKeyPair: vi.fn(),
  getCachedTonClient: vi.fn(),
  invalidateTonClientCache: vi.fn(),
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

vi.mock("../../ton/tx-lock.js", () => ({
  withTxLock: vi.fn((fn: () => any) => fn()),
}));

// We use a shared object so the mock factory (hoisted) and the tests
// can reference the same spy functions. vi.hoisted() runs before vi.mock.
const mocks = vi.hoisted(() => ({
  addressParse: vi.fn(),
  beginCell: vi.fn(),
  tonClient: vi.fn(),
  walletV5R1Create: vi.fn(),
  toNano: vi.fn(),
  fromNano: vi.fn(),
  internal: vi.fn(),
  getCachedHttpEndpoint: vi.fn().mockResolvedValue("https://toncenter.test"),
  formatTransactions: vi.fn((txs: any[]) => txs),
}));

vi.mock("@ton/core", () => ({
  Address: { parse: mocks.addressParse },
  beginCell: mocks.beginCell,
  SendMode: { PAY_GAS_SEPARATELY: 1, IGNORE_ERRORS: 2 },
  storeMessage: vi.fn(() => vi.fn()),
}));

vi.mock("@ton/ton", () => ({
  TonClient: mocks.tonClient,
  WalletContractV5R1: { create: mocks.walletV5R1Create },
  toNano: mocks.toNano,
  fromNano: mocks.fromNano,
  internal: mocks.internal,
}));

vi.mock("../../ton/endpoint.js", () => ({
  getCachedHttpEndpoint: mocks.getCachedHttpEndpoint,
}));

vi.mock("../../ton/format-transactions.js", () => ({
  formatTransactions: mocks.formatTransactions,
}));

// ─── Imports (after mocks) ────────────────────────────────────────

import { createTonSDK } from "../ton.js";
import {
  getWalletAddress,
  getWalletBalance,
  getTonPrice,
  loadWallet,
  getKeyPair,
  getCachedTonClient,
  invalidateTonClientCache,
} from "../../ton/wallet-service.js";
import { sendTon } from "../../ton/transfer.js";
import { tonapiFetch } from "../../constants/api-endpoints.js";
import { withBlockchainRetry } from "../../utils/retry.js";
import { withTxLock } from "../../ton/tx-lock.js";

// ─── Helpers ──────────────────────────────────────────────────────

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const VALID_ADDRESS = "EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2";

/** A confirmed external-in wallet tx, for mocking on-chain send confirmation (hash = "cd"*32). */
const CONFIRMED_TX = {
  lt: 100n,
  now: 2000,
  inMessage: { info: { type: "external-in" } },
  description: {
    type: "generic",
    computePhase: { type: "vm", success: true, exitCode: 0 },
    actionPhase: { success: true, resultCode: 0, noFunds: false },
  },
  hash: () => Buffer.from("cd".repeat(32), "hex"),
} as any;

/** getTransactions mock: empty pre-send snapshot, then the confirmed tx on every poll. */
function confirmingGetTransactions() {
  return vi.fn().mockResolvedValueOnce([]).mockResolvedValue([CONFIRMED_TX]);
}

function mockResponse(data: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS used_transactions (
      tx_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      game_type TEXT NOT NULL,
      used_at INTEGER NOT NULL
    )
  `);
  return db;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("createTonSDK", () => {
  let sdk: ReturnType<typeof createTonSDK>;

  beforeEach(() => {
    vi.clearAllMocks();
    sdk = createTonSDK(mockLog as any, null);

    // Default: Address.parse returns an object with toString
    mocks.addressParse.mockImplementation((addr: string) => ({
      toString: () => addr,
      toRawString: () => addr,
    }));

    // withBlockchainRetry just executes the function
    (withBlockchainRetry as Mock).mockImplementation((fn: () => any) => fn());
  });

  // ═══════════════════════════════════════════════════════════════
  // WALLET METHODS
  // ═══════════════════════════════════════════════════════════════

  describe("Wallet methods", () => {
    describe("getAddress()", () => {
      it("returns the wallet address", () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        expect(sdk.getAddress()).toBe(VALID_ADDRESS);
      });

      it("returns null when no wallet is configured", () => {
        (getWalletAddress as Mock).mockReturnValue(null);
        expect(sdk.getAddress()).toBeNull();
      });

      it("returns null and logs error on exception", () => {
        (getWalletAddress as Mock).mockImplementation(() => {
          throw new Error("file not found");
        });
        expect(sdk.getAddress()).toBeNull();
        expect(mockLog.error).toHaveBeenCalledWith("ton.getAddress() failed:", expect.any(Error));
      });
    });

    describe("getBalance()", () => {
      const balance = { balance: "12.50", balanceNano: "12500000000" };

      it("returns balance for own address when no address provided", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (getWalletBalance as Mock).mockResolvedValue(balance);

        const result = await sdk.getBalance();
        expect(result).toEqual(balance);
        expect(getWalletBalance).toHaveBeenCalledWith(VALID_ADDRESS);
      });

      it("returns balance for a specified address", async () => {
        const otherAddr = "EQAbc123";
        (getWalletBalance as Mock).mockResolvedValue(balance);

        const result = await sdk.getBalance(otherAddr);
        expect(result).toEqual(balance);
        expect(getWalletBalance).toHaveBeenCalledWith(otherAddr);
      });

      it("returns null when wallet address is not available", async () => {
        (getWalletAddress as Mock).mockReturnValue(null);
        const result = await sdk.getBalance();
        expect(result).toBeNull();
      });

      it("returns null on error", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (getWalletBalance as Mock).mockRejectedValue(new Error("network"));

        const result = await sdk.getBalance();
        expect(result).toBeNull();
        expect(mockLog.error).toHaveBeenCalled();
      });
    });

    describe("getPrice()", () => {
      it("returns price info", async () => {
        const price = { usd: 3.45, source: "TonAPI", timestamp: Date.now() };
        (getTonPrice as Mock).mockResolvedValue(price);

        const result = await sdk.getPrice();
        expect(result).toEqual(price);
      });

      it("returns null on error", async () => {
        (getTonPrice as Mock).mockRejectedValue(new Error("timeout"));
        const result = await sdk.getPrice();
        expect(result).toBeNull();
        expect(mockLog.error).toHaveBeenCalled();
      });
    });

    describe("sendTON()", () => {
      beforeEach(() => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
      });

      it("throws WALLET_NOT_INITIALIZED when wallet is missing", async () => {
        (getWalletAddress as Mock).mockReturnValue(null);
        await expect(sdk.sendTON("EQAbc", 1)).rejects.toThrow(PluginSDKError);
        await expect(sdk.sendTON("EQAbc", 1)).rejects.toMatchObject({
          code: "WALLET_NOT_INITIALIZED",
        });
      });

      it("throws OPERATION_FAILED for non-positive amount", async () => {
        await expect(sdk.sendTON(VALID_ADDRESS, 0)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
        await expect(sdk.sendTON(VALID_ADDRESS, -5)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws OPERATION_FAILED for NaN amount", async () => {
        await expect(sdk.sendTON(VALID_ADDRESS, NaN)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws OPERATION_FAILED for Infinity amount", async () => {
        await expect(sdk.sendTON(VALID_ADDRESS, Infinity)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws INVALID_ADDRESS for malformed address", async () => {
        mocks.addressParse.mockImplementation(() => {
          throw new Error("Invalid address");
        });
        await expect(sdk.sendTON("not-an-address", 1)).rejects.toMatchObject({
          code: "INVALID_ADDRESS",
        });
      });

      it("returns the on-chain tx hash as txRef on success", async () => {
        (sendTon as Mock).mockResolvedValue({
          hash: "cd".repeat(32),
          seqno: 42,
          at: 1700000000000,
        });

        const result = await sdk.sendTON(VALID_ADDRESS, 1.5, "hello");
        expect(result).toEqual({ txRef: "cd".repeat(32), amount: 1.5 });
        expect(sendTon).toHaveBeenCalledWith({
          toAddress: VALID_ADDRESS,
          amount: 1.5,
          comment: "hello",
          bounce: false,
        });
      });

      it("throws OPERATION_FAILED when the transfer is not confirmed", async () => {
        (sendTon as Mock).mockResolvedValue(null);

        await expect(sdk.sendTON(VALID_ADDRESS, 1)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
          message: expect.stringContaining("not be confirmed"),
        });
      });

      it("re-throws PluginSDKError from underlying layers", async () => {
        (sendTon as Mock).mockRejectedValue(
          new PluginSDKError("insufficient funds", "OPERATION_FAILED")
        );
        await expect(sdk.sendTON(VALID_ADDRESS, 100)).rejects.toThrow(PluginSDKError);
      });

      it("wraps non-PluginSDKError into OPERATION_FAILED", async () => {
        (sendTon as Mock).mockRejectedValue(new Error("network error"));
        await expect(sdk.sendTON(VALID_ADDRESS, 1)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
          message: expect.stringContaining("network error"),
        });
      });
    });

    describe("getTransactions()", () => {
      it("returns formatted transactions", async () => {
        const mockTxs = [{ hash: "abc", type: "ton_received" }];
        const mockGetTx = vi.fn().mockResolvedValue(mockTxs);
        (getCachedTonClient as Mock).mockResolvedValue({ getTransactions: mockGetTx });
        mocks.formatTransactions.mockReturnValue(mockTxs);

        const result = await sdk.getTransactions(VALID_ADDRESS, 5);
        expect(result).toEqual(mockTxs);
      });

      it("caps limit at 50", async () => {
        const mockGetTx = vi.fn().mockResolvedValue([]);
        (getCachedTonClient as Mock).mockResolvedValue({ getTransactions: mockGetTx });
        mocks.formatTransactions.mockReturnValue([]);

        await sdk.getTransactions(VALID_ADDRESS, 999);
        expect(mockGetTx).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ limit: 50 })
        );
      });

      it("defaults limit to 10 when not specified", async () => {
        const mockGetTx = vi.fn().mockResolvedValue([]);
        (getCachedTonClient as Mock).mockResolvedValue({ getTransactions: mockGetTx });
        mocks.formatTransactions.mockReturnValue([]);

        await sdk.getTransactions(VALID_ADDRESS);
        expect(mockGetTx).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ limit: 10 })
        );
      });

      it("returns empty array on error", async () => {
        (getCachedTonClient as Mock).mockRejectedValue(new Error("connection failed"));

        const result = await sdk.getTransactions(VALID_ADDRESS);
        expect(result).toEqual([]);
        expect(mockLog.error).toHaveBeenCalled();
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // JETTON METHODS
  // ═══════════════════════════════════════════════════════════════

  describe("Jetton methods", () => {
    describe("getJettonBalances()", () => {
      const jettonApiResponse = {
        balances: [
          {
            balance: "1500000000",
            wallet_address: { address: "EQJettonWallet1" },
            jetton: {
              address: "EQJettonMaster1",
              symbol: "USDT",
              name: "Tether USD",
              decimals: 6,
              verification: "whitelist",
            },
            price: { prices: { USD: "1.001" } },
          },
          {
            balance: "5000000000000",
            wallet_address: { address: "EQJettonWallet2" },
            jetton: {
              address: "EQJettonMaster2",
              symbol: "TOK",
              name: "Test Token",
              decimals: 9,
              verification: "none",
            },
          },
          {
            balance: "100",
            wallet_address: { address: "EQBlacklisted" },
            jetton: {
              address: "EQBlackJetton",
              symbol: "SCAM",
              name: "Scam Token",
              decimals: 9,
              verification: "blacklist",
            },
          },
        ],
      };

      it("returns formatted jetton balances", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse(jettonApiResponse));

        const result = await sdk.getJettonBalances();
        expect(result).toHaveLength(2);
        expect(result[0].symbol).toBe("USDT");
        expect(result[1].symbol).toBe("TOK");
      });

      it("formats decimals correctly for 6-decimal token (USDT)", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse(jettonApiResponse));

        const result = await sdk.getJettonBalances();
        // 1500000000 with 6 decimals = 1500.0
        expect(result[0].balanceFormatted).toBe("1500");
        expect(result[0].decimals).toBe(6);
      });

      it("formats decimals correctly for 9-decimal token", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse(jettonApiResponse));

        const result = await sdk.getJettonBalances();
        // 5000000000000 with 9 decimals = 5000.0
        expect(result[1].balanceFormatted).toBe("5000");
        expect(result[1].decimals).toBe(9);
      });

      it("filters blacklisted jettons", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse(jettonApiResponse));

        const result = await sdk.getJettonBalances();
        const symbols = result.map((b) => b.symbol);
        expect(symbols).not.toContain("SCAM");
      });

      it("sets verified flag based on whitelist verification", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse(jettonApiResponse));

        const result = await sdk.getJettonBalances();
        expect(result[0].verified).toBe(true); // "whitelist"
        expect(result[1].verified).toBe(false); // "none"
      });

      it("includes usdPrice when available", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse(jettonApiResponse));

        const result = await sdk.getJettonBalances();
        expect(result[0].usdPrice).toBe(1.001);
        expect(result[1].usdPrice).toBeUndefined();
      });

      it("uses provided ownerAddress instead of wallet", async () => {
        const customAddr = "EQCustomOwner";
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({ balances: [] }));

        await sdk.getJettonBalances(customAddr);
        expect(tonapiFetch).toHaveBeenCalledWith(`/accounts/${customAddr}/jettons`);
      });

      it("returns empty array when wallet not available", async () => {
        (getWalletAddress as Mock).mockReturnValue(null);
        const result = await sdk.getJettonBalances();
        expect(result).toEqual([]);
      });

      it("returns empty array on API error", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({}, 500));

        const result = await sdk.getJettonBalances();
        expect(result).toEqual([]);
        expect(mockLog.error).toHaveBeenCalled();
      });

      it("returns empty array on network failure", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockRejectedValue(new Error("DNS resolution failed"));

        const result = await sdk.getJettonBalances();
        expect(result).toEqual([]);
        expect(mockLog.error).toHaveBeenCalled();
      });

      it("handles fractional balances correctly", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            balances: [
              {
                balance: "1234567890",
                wallet_address: { address: "EQW" },
                jetton: {
                  address: "EQJ",
                  symbol: "TKN",
                  name: "Token",
                  decimals: 9,
                  verification: "none",
                },
              },
            ],
          })
        );

        const result = await sdk.getJettonBalances();
        // 1234567890 / 10^9 = 1.23456789
        expect(result[0].balanceFormatted).toBe("1.23456789");
      });
    });

    describe("getJettonInfo()", () => {
      it("returns jetton metadata", async () => {
        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            metadata: {
              address: "EQJettonMaster",
              name: "My Token",
              symbol: "MTK",
              decimals: "6",
              description: "A test token",
            },
            total_supply: "1000000000000",
            holders_count: 42,
            verification: "whitelist",
            preview: "https://img.test/mtk.png",
          })
        );

        const result = await sdk.getJettonInfo("EQJettonMaster");
        expect(result).toEqual({
          address: "EQJettonMaster",
          name: "My Token",
          symbol: "MTK",
          decimals: 6,
          totalSupply: "1000000000000",
          holdersCount: 42,
          verified: true,
          description: "A test token",
          image: "https://img.test/mtk.png",
        });
      });

      it("returns null on 404", async () => {
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({}, 404));
        const result = await sdk.getJettonInfo("EQNonexistent");
        expect(result).toBeNull();
      });

      it("returns null on non-OK response", async () => {
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({}, 500));
        const result = await sdk.getJettonInfo("EQJetton");
        expect(result).toBeNull();
        expect(mockLog.error).toHaveBeenCalled();
      });

      it("returns null on exception", async () => {
        (tonapiFetch as Mock).mockRejectedValue(new Error("timeout"));
        const result = await sdk.getJettonInfo("EQJetton");
        expect(result).toBeNull();
      });

      it("handles missing metadata fields gracefully", async () => {
        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            metadata: {},
            verification: "none",
          })
        );

        const result = await sdk.getJettonInfo("EQMinimal");
        expect(result).toEqual({
          address: "EQMinimal",
          name: "Unknown",
          symbol: "UNKNOWN",
          decimals: 9,
          totalSupply: "0",
          holdersCount: 0,
          verified: false,
          description: undefined,
          image: undefined,
        });
      });
    });

    describe("sendJetton()", () => {
      const jettonAddr = "EQJettonMaster";
      const recipientAddr = "EQRecipient";

      beforeEach(() => {
        (loadWallet as Mock).mockReturnValue({
          address: VALID_ADDRESS,
          mnemonic: "word ".repeat(24).trim().split(" "),
        });

        // Mock getKeyPair
        (getKeyPair as Mock).mockResolvedValue({
          publicKey: Buffer.alloc(32),
          secretKey: Buffer.alloc(64),
        });

        // Mock beginCell chain
        const cellMock = { endCell: () => ({}) };
        const builderMock = {
          storeUint: vi.fn().mockReturnThis(),
          storeCoins: vi.fn().mockReturnThis(),
          storeAddress: vi.fn().mockReturnThis(),
          storeBit: vi.fn().mockReturnThis(),
          storeRef: vi.fn().mockReturnThis(),
          storeMaybeRef: vi.fn().mockReturnThis(),
          storeStringTail: vi.fn().mockReturnThis(),
          endCell: vi.fn().mockReturnValue(cellMock),
        };
        mocks.beginCell.mockReturnValue(builderMock);

        // Mock WalletContractV5R1
        mocks.walletV5R1Create.mockReturnValue({});

        // Mock toNano (used in TEP-74 transfer body)
        mocks.toNano.mockReturnValue(BigInt(1));

        // Mock getCachedTonClient — returns a client with an open() method
        const mockWalletContract = {
          address: { toString: () => "EQwallet" },
          getSeqno: vi.fn().mockResolvedValue(42),
          sendTransfer: vi.fn().mockResolvedValue(undefined),
        };
        (getCachedTonClient as Mock).mockResolvedValue({
          open: vi.fn().mockReturnValue(mockWalletContract),
          getTransactions: confirmingGetTransactions(),
        });
      });

      it("throws WALLET_NOT_INITIALIZED when wallet missing", async () => {
        (loadWallet as Mock).mockReturnValue(null);
        await expect(sdk.sendJetton(jettonAddr, recipientAddr, 10)).rejects.toMatchObject({
          code: "WALLET_NOT_INITIALIZED",
        });
      });

      it("throws OPERATION_FAILED for non-positive amount", async () => {
        await expect(sdk.sendJetton(jettonAddr, recipientAddr, 0)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });

        await expect(sdk.sendJetton(jettonAddr, recipientAddr, -1)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws INVALID_ADDRESS for bad recipient", async () => {
        mocks.addressParse.mockImplementation(() => {
          throw new Error("bad address");
        });

        await expect(sdk.sendJetton(jettonAddr, "garbage", 10)).rejects.toMatchObject({
          code: "INVALID_ADDRESS",
        });
      });

      it("throws OPERATION_FAILED when jetton not in balances", async () => {
        // Restore Address.parse for this test
        mocks.addressParse.mockImplementation((addr: string) => ({
          toString: () => addr,
        }));

        (tonapiFetch as Mock).mockResolvedValue(mockResponse({ balances: [] }));

        await expect(sdk.sendJetton(jettonAddr, recipientAddr, 10)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
          message: expect.stringContaining("don't own"),
        });
      });

      it("throws OPERATION_FAILED on insufficient balance", async () => {
        mocks.addressParse.mockImplementation((addr: string) => ({
          toString: () => addr,
        }));

        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            balances: [
              {
                balance: "5000000000", // 5 tokens (9 decimals)
                wallet_address: { address: "EQJettonWallet" },
                jetton: {
                  address: jettonAddr,
                  decimals: 9,
                },
              },
            ],
          })
        );

        await expect(
          sdk.sendJetton(jettonAddr, recipientAddr, 100) // want 100, have 5
        ).rejects.toMatchObject({
          code: "OPERATION_FAILED",
          message: expect.stringContaining("Insufficient balance"),
        });
      });

      it("succeeds and returns { success, seqno }", async () => {
        mocks.addressParse.mockImplementation((addr: string) => ({
          toString: () => addr,
        }));

        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            balances: [
              {
                balance: "100000000000", // 100 tokens (9 decimals)
                wallet_address: { address: "EQJettonWallet" },
                jetton: {
                  address: jettonAddr,
                  decimals: 9,
                },
              },
            ],
          })
        );

        const result = await sdk.sendJetton(jettonAddr, recipientAddr, 10);
        expect(result).toEqual({ success: true, seqno: 42, txRef: "cd".repeat(32) });
      });

      it("throws OPERATION_FAILED when getKeyPair returns null", async () => {
        mocks.addressParse.mockImplementation((addr: string) => ({
          toString: () => addr,
        }));

        (getKeyPair as Mock).mockResolvedValue(null);
        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            balances: [
              {
                balance: "100000000000",
                wallet_address: { address: "EQJettonWallet" },
                jetton: { address: jettonAddr, decimals: 9 },
              },
            ],
          })
        );

        await expect(sdk.sendJetton(jettonAddr, recipientAddr, 1)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
          message: expect.stringContaining("key derivation"),
        });
      });
    });

    describe("getJettonWalletAddress()", () => {
      it("returns wallet address for matching jetton", async () => {
        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            balances: [
              {
                wallet_address: { address: "EQMyJettonWallet" },
                jetton: { address: "eqjettonmaster" },
              },
            ],
          })
        );

        const result = await sdk.getJettonWalletAddress(VALID_ADDRESS, "eqjettonmaster");
        expect(result).toBe("EQMyJettonWallet");
      });

      it("returns null when jetton not found", async () => {
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({ balances: [] }));

        const result = await sdk.getJettonWalletAddress(VALID_ADDRESS, "EQNonexistent");
        expect(result).toBeNull();
      });

      it("returns null on API error", async () => {
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({}, 500));
        const result = await sdk.getJettonWalletAddress(VALID_ADDRESS, "EQJ");
        expect(result).toBeNull();
        expect(mockLog.error).toHaveBeenCalled();
      });

      it("returns null on network failure", async () => {
        (tonapiFetch as Mock).mockRejectedValue(new Error("timeout"));
        const result = await sdk.getJettonWalletAddress(VALID_ADDRESS, "EQJ");
        expect(result).toBeNull();
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // NFT METHODS
  // ═══════════════════════════════════════════════════════════════

  describe("NFT methods", () => {
    describe("getNftItems()", () => {
      const nftApiResponse = {
        nft_items: [
          {
            address: "EQNft1",
            index: 0,
            owner: { address: "EQOwner1" },
            collection: { address: "EQColl1", name: "Cool Collection" },
            metadata: {
              name: "Cool NFT #1",
              description: "A cool NFT",
            },
            previews: [{ url: "https://img/small.png" }, { url: "https://img/medium.png" }],
            trust: "whitelist",
          },
          {
            address: "EQNft2",
            index: 1,
            owner: { address: "EQOwner2" },
            collection: {},
            metadata: {},
            previews: [],
            trust: "blacklist",
          },
          {
            address: "EQNft3",
            index: 5,
            owner: { address: "EQOwner3" },
            collection: { address: "EQColl2", name: "Another" },
            metadata: { name: "NFT #3" },
            previews: [{ url: "https://img/only.png" }],
            trust: "none",
          },
        ],
      };

      it("returns NFT items with correct mapping", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse(nftApiResponse));

        const result = await sdk.getNftItems();
        expect(result).toHaveLength(2); // blacklisted one filtered
        expect(result[0]).toEqual({
          address: "EQNft1",
          index: 0,
          ownerAddress: "EQOwner1",
          collectionAddress: "EQColl1",
          collectionName: "Cool Collection",
          name: "Cool NFT #1",
          description: "A cool NFT",
          image: "https://img/medium.png", // prefers second preview
          verified: true,
        });
      });

      it("filters blacklisted NFTs", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse(nftApiResponse));

        const result = await sdk.getNftItems();
        const addresses = result.map((n) => n.address);
        expect(addresses).not.toContain("EQNft2");
      });

      it("uses first preview when only one available", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse(nftApiResponse));

        const result = await sdk.getNftItems();
        const nft3 = result.find((n) => n.address === "EQNft3");
        expect(nft3?.image).toBe("https://img/only.png");
      });

      it("uses provided ownerAddress", async () => {
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({ nft_items: [] }));

        await sdk.getNftItems("EQCustomOwner");
        expect(tonapiFetch).toHaveBeenCalledWith(expect.stringContaining("EQCustomOwner"));
      });

      it("returns empty array when wallet unavailable", async () => {
        (getWalletAddress as Mock).mockReturnValue(null);
        const result = await sdk.getNftItems();
        expect(result).toEqual([]);
      });

      it("returns empty array on API error", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({}, 500));

        const result = await sdk.getNftItems();
        expect(result).toEqual([]);
      });

      it("returns empty array when nft_items is not an array", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({ nft_items: null }));

        const result = await sdk.getNftItems();
        expect(result).toEqual([]);
      });

      it("returns empty array on network failure", async () => {
        (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);
        (tonapiFetch as Mock).mockRejectedValue(new Error("network"));

        const result = await sdk.getNftItems();
        expect(result).toEqual([]);
      });
    });

    describe("getNftInfo()", () => {
      it("returns NFT info", async () => {
        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            address: "EQNft1",
            index: 3,
            owner: { address: "EQOwner" },
            collection: { address: "EQColl", name: "Collection" },
            metadata: { name: "NFT #3", description: "desc" },
            previews: [{ url: "https://img/s.png" }, { url: "https://img/m.png" }],
            trust: "whitelist",
          })
        );

        const result = await sdk.getNftInfo("EQNft1");
        expect(result).toEqual({
          address: "EQNft1",
          index: 3,
          ownerAddress: "EQOwner",
          collectionAddress: "EQColl",
          collectionName: "Collection",
          name: "NFT #3",
          description: "desc",
          image: "https://img/m.png",
          verified: true,
        });
      });

      it("returns null on 404", async () => {
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({}, 404));
        const result = await sdk.getNftInfo("EQNonexistent");
        expect(result).toBeNull();
      });

      it("returns null on non-OK response", async () => {
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({}, 500));
        const result = await sdk.getNftInfo("EQNft");
        expect(result).toBeNull();
      });

      it("returns null on exception", async () => {
        (tonapiFetch as Mock).mockRejectedValue(new Error("fail"));
        const result = await sdk.getNftInfo("EQNft");
        expect(result).toBeNull();
      });

      it("truncates description to 200 characters", async () => {
        const longDesc = "A".repeat(300);
        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            address: "EQNft",
            index: 0,
            metadata: { description: longDesc },
            trust: "none",
          })
        );

        const result = await sdk.getNftInfo("EQNft");
        expect(result?.description).toHaveLength(200);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // VERIFY PAYMENT
  // ═══════════════════════════════════════════════════════════════

  describe("verifyPayment()", () => {
    let db: Database.Database;
    let sdkWithDb: ReturnType<typeof createTonSDK>;

    beforeEach(() => {
      db = createTestDb();
      sdkWithDb = createTonSDK(mockLog as any, db);
      (getWalletAddress as Mock).mockReturnValue(VALID_ADDRESS);

      // Spy on getTransactions to bypass its internal dynamic imports.
      // verifyPayment calls this.getTransactions(address, 20).
      vi.spyOn(sdkWithDb, "getTransactions").mockResolvedValue([]);
    });

    afterEach(() => {
      db.close();
    });

    it("throws when no database is available", async () => {
      const sdkNoDB = createTonSDK(mockLog as any, null);
      await expect(
        sdkNoDB.verifyPayment({ amount: 1, memo: "test", gameType: "dice" })
      ).rejects.toMatchObject({ code: "OPERATION_FAILED" });
    });

    it("throws WALLET_NOT_INITIALIZED when no wallet", async () => {
      (getWalletAddress as Mock).mockReturnValue(null);
      await expect(
        sdkWithDb.verifyPayment({ amount: 1, memo: "test", gameType: "dice" })
      ).rejects.toMatchObject({ code: "WALLET_NOT_INITIALIZED" });
    });

    it("returns verified: true when matching transaction found", async () => {
      vi.spyOn(sdkWithDb, "getTransactions").mockResolvedValue([
        {
          type: "ton_received",
          hash: "abc123hash",
          amount: "1.5 TON",
          from: "EQSender",
          comment: "player42",
          date: "2025-01-01T00:00:00Z",
          secondsAgo: 120,
          explorer: "",
        },
      ]);

      const result = await sdkWithDb.verifyPayment({
        amount: 1.5,
        memo: "player42",
        gameType: "spin",
      });

      expect(result.verified).toBe(true);
      expect(result.txHash).toBe("abc123hash");
      expect(result.amount).toBe(1.5);
      expect(result.playerWallet).toBe("EQSender");
    });

    it("returns verified: false when no matching transaction", async () => {
      vi.spyOn(sdkWithDb, "getTransactions").mockResolvedValue([]);

      const result = await sdkWithDb.verifyPayment({
        amount: 1,
        memo: "test",
        gameType: "dice",
      });

      expect(result.verified).toBe(false);
      expect(result.error).toContain("Payment not found");
    });

    it("rejects transactions that are too old", async () => {
      vi.spyOn(sdkWithDb, "getTransactions").mockResolvedValue([
        {
          type: "ton_received",
          hash: "oldhash",
          amount: "1 TON",
          from: "EQSender",
          comment: "memo1",
          date: "2025-01-01T00:00:00Z",
          secondsAgo: 700, // > 10 min default
          explorer: "",
        },
      ]);

      const result = await sdkWithDb.verifyPayment({
        amount: 1,
        memo: "memo1",
        gameType: "dice",
      });

      expect(result.verified).toBe(false);
    });

    it("respects custom maxAgeMinutes", async () => {
      vi.spyOn(sdkWithDb, "getTransactions").mockResolvedValue([
        {
          type: "ton_received",
          hash: "agethash",
          amount: "1 TON",
          from: "EQSender",
          comment: "memo1",
          date: "2025-01-01T00:00:00Z",
          secondsAgo: 700, // > 10 min but < 15 min
          explorer: "",
        },
      ]);

      const result = await sdkWithDb.verifyPayment({
        amount: 1,
        memo: "memo1",
        gameType: "dice",
        maxAgeMinutes: 15,
      });

      expect(result.verified).toBe(true);
    });

    it("prevents replay: same tx_hash cannot be used twice", async () => {
      vi.spyOn(sdkWithDb, "getTransactions").mockResolvedValue([
        {
          type: "ton_received",
          hash: "unique_hash_123",
          amount: "2 TON",
          from: "EQSender",
          comment: "player1",
          date: "2025-01-01T00:00:00Z",
          secondsAgo: 60,
          explorer: "",
        },
      ]);

      const first = await sdkWithDb.verifyPayment({
        amount: 2,
        memo: "player1",
        gameType: "spin",
      });
      expect(first.verified).toBe(true);

      const second = await sdkWithDb.verifyPayment({
        amount: 2,
        memo: "player1",
        gameType: "spin",
      });
      expect(second.verified).toBe(false);
    });

    it("matches memo case-insensitively", async () => {
      vi.spyOn(sdkWithDb, "getTransactions").mockResolvedValue([
        {
          type: "ton_received",
          hash: "casehash",
          amount: "1 TON",
          from: "EQSender",
          comment: "Player42",
          date: "2025-01-01T00:00:00Z",
          secondsAgo: 60,
          explorer: "",
        },
      ]);

      const result = await sdkWithDb.verifyPayment({
        amount: 1,
        memo: "player42",
        gameType: "dice",
      });

      expect(result.verified).toBe(true);
    });

    it("strips @ prefix from memo for matching", async () => {
      vi.spyOn(sdkWithDb, "getTransactions").mockResolvedValue([
        {
          type: "ton_received",
          hash: "athash",
          amount: "1 TON",
          from: "EQSender",
          comment: "@player42",
          date: "2025-01-01T00:00:00Z",
          secondsAgo: 60,
          explorer: "",
        },
      ]);

      const result = await sdkWithDb.verifyPayment({
        amount: 1,
        memo: "player42",
        gameType: "dice",
      });

      expect(result.verified).toBe(true);
    });

    it("rejects amount below tolerance (99%)", async () => {
      vi.spyOn(sdkWithDb, "getTransactions").mockResolvedValue([
        {
          type: "ton_received",
          hash: "lowhash",
          amount: "0.98 TON", // 98% of 1.0 — below 99% threshold
          from: "EQSender",
          comment: "test",
          date: "2025-01-01T00:00:00Z",
          secondsAgo: 60,
          explorer: "",
        },
      ]);

      const result = await sdkWithDb.verifyPayment({
        amount: 1,
        memo: "test",
        gameType: "dice",
      });

      expect(result.verified).toBe(false);
    });

    it("skips non-ton_received transactions", async () => {
      vi.spyOn(sdkWithDb, "getTransactions").mockResolvedValue([
        {
          type: "ton_sent",
          hash: "senthash",
          amount: "1 TON",
          from: "EQSender",
          comment: "test",
          date: "2025-01-01T00:00:00Z",
          secondsAgo: 60,
          explorer: "",
        },
      ]);

      const result = await sdkWithDb.verifyPayment({
        amount: 1,
        memo: "test",
        gameType: "dice",
      });

      expect(result.verified).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SIGNED TRANSFERS (no broadcast)
  // ═══════════════════════════════════════════════════════════════

  describe("Signed transfer methods", () => {
    const MOCK_PUBLIC_KEY = "a".repeat(64);
    const mockWalletData = {
      version: "w5r1" as const,
      address: VALID_ADDRESS,
      publicKey: MOCK_PUBLIC_KEY,
      mnemonic: Array(24).fill("test"),
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    const mockKeyPair = {
      publicKey: Buffer.from(MOCK_PUBLIC_KEY, "hex"),
      secretKey: Buffer.alloc(64),
    };

    const mockBocBuffer = Buffer.from("mock-signed-boc");
    const mockCell = {
      toBoc: vi.fn().mockReturnValue(mockBocBuffer),
    };

    describe("getPublicKey()", () => {
      it("returns hex public key when wallet is initialized", () => {
        (loadWallet as Mock).mockReturnValue(mockWalletData);
        expect(sdk.getPublicKey()).toBe(MOCK_PUBLIC_KEY);
      });

      it("returns null when wallet is not initialized", () => {
        (loadWallet as Mock).mockReturnValue(null);
        expect(sdk.getPublicKey()).toBeNull();
      });

      it("returns null and logs error on exception", () => {
        (loadWallet as Mock).mockImplementation(() => {
          throw new Error("file not found");
        });
        expect(sdk.getPublicKey()).toBeNull();
        expect(mockLog.error).toHaveBeenCalledWith("ton.getPublicKey() failed:", expect.any(Error));
      });
    });

    describe("getWalletVersion()", () => {
      it("returns v5r1", () => {
        expect(sdk.getWalletVersion()).toBe("v5r1");
      });
    });

    describe("createTransfer()", () => {
      const MOCK_RAW_ADDRESS = "0:ed1691307050047117b998b561d8de82d31fbf84910ced6eb5fc92e7485ef8a7";

      beforeEach(() => {
        (loadWallet as Mock).mockReturnValue(mockWalletData);
        (getKeyPair as Mock).mockResolvedValue(mockKeyPair);
        mocks.walletV5R1Create.mockReturnValue({
          address: { toString: () => VALID_ADDRESS, toRawString: () => MOCK_RAW_ADDRESS },
          init: undefined,
          createTransfer: vi.fn().mockReturnValue(mockCell),
        });
        const mockContract = {
          getSeqno: vi.fn().mockResolvedValue(42),
        };
        (getCachedTonClient as Mock).mockResolvedValue({
          open: vi.fn().mockReturnValue(mockContract),
          getTransactions: confirmingGetTransactions(),
        });
        mocks.toNano.mockReturnValue(BigInt(50000000));
        mocks.internal.mockReturnValue({});
        // Mock beginCell chain for external message wrapping
        const extCellMock = { toBoc: vi.fn().mockReturnValue(mockBocBuffer) };
        const extBuilderMock = {
          store: vi.fn().mockReturnThis(),
          endCell: vi.fn().mockReturnValue(extCellMock),
        };
        mocks.beginCell.mockReturnValue(extBuilderMock);
      });

      it("returns signed transfer with boc, publicKey, walletVersion", async () => {
        const result = await sdk.createTransfer(VALID_ADDRESS, 0.05, "hello");

        expect(result).toEqual({
          signedBoc: mockBocBuffer.toString("base64"),
          walletPublicKey: MOCK_PUBLIC_KEY,
          walletAddress: MOCK_RAW_ADDRESS,
          seqno: 42,
          validUntil: expect.any(Number),
          boc: mockBocBuffer.toString("base64"),
          publicKey: MOCK_PUBLIC_KEY,
          walletVersion: "v5r1",
        });
      });

      it("works without comment", async () => {
        const result = await sdk.createTransfer(VALID_ADDRESS, 1);

        expect(result.signedBoc).toBe(mockBocBuffer.toString("base64"));
        expect(result.walletPublicKey).toBe(MOCK_PUBLIC_KEY);
        expect(result.walletAddress).toBe(MOCK_RAW_ADDRESS);
        expect(result.seqno).toBe(42);
        expect(result.validUntil).toBeGreaterThan(0);
        // backward compat aliases
        expect(result.boc).toBe(mockBocBuffer.toString("base64"));
        expect(result.publicKey).toBe(MOCK_PUBLIC_KEY);
        expect(result.walletVersion).toBe("v5r1");
      });

      it("throws WALLET_NOT_INITIALIZED when wallet missing", async () => {
        (loadWallet as Mock).mockReturnValue(null);
        await expect(sdk.createTransfer(VALID_ADDRESS, 1)).rejects.toMatchObject({
          code: "WALLET_NOT_INITIALIZED",
        });
      });

      it("throws INVALID_ADDRESS for bad address", async () => {
        mocks.addressParse.mockImplementation(() => {
          throw new Error("bad address");
        });
        await expect(sdk.createTransfer("garbage", 1)).rejects.toMatchObject({
          code: "INVALID_ADDRESS",
        });
      });

      it("throws OPERATION_FAILED for non-positive amount", async () => {
        await expect(sdk.createTransfer(VALID_ADDRESS, 0)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
        await expect(sdk.createTransfer(VALID_ADDRESS, -1)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws OPERATION_FAILED for NaN amount", async () => {
        await expect(sdk.createTransfer(VALID_ADDRESS, NaN)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws OPERATION_FAILED when getKeyPair returns null", async () => {
        (getKeyPair as Mock).mockResolvedValue(null);
        await expect(sdk.createTransfer(VALID_ADDRESS, 1)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
          message: expect.stringContaining("key derivation"),
        });
      });
    });

    describe("createJettonTransfer()", () => {
      const jettonAddr = "EQJettonMaster";
      const recipientAddr = "EQRecipient";
      const cellMock = {
        toBoc: vi.fn().mockReturnValue(mockBocBuffer),
      };

      beforeEach(() => {
        (loadWallet as Mock).mockReturnValue(mockWalletData);
        (getKeyPair as Mock).mockResolvedValue(mockKeyPair);

        mocks.addressParse.mockImplementation((addr: string) => ({
          toString: () => addr,
        }));

        // Mock beginCell chain (supports both jetton body building and external message wrapping)
        const builderMock = {
          storeUint: vi.fn().mockReturnThis(),
          storeCoins: vi.fn().mockReturnThis(),
          storeAddress: vi.fn().mockReturnThis(),
          storeBit: vi.fn().mockReturnThis(),
          storeRef: vi.fn().mockReturnThis(),
          storeStringTail: vi.fn().mockReturnThis(),
          store: vi.fn().mockReturnThis(),
          endCell: vi.fn().mockReturnValue(cellMock),
        };
        mocks.beginCell.mockReturnValue(builderMock);
        mocks.toNano.mockReturnValue(BigInt(1));
        mocks.internal.mockReturnValue({});

        const mockWallet = {
          address: { toString: () => VALID_ADDRESS, toRawString: () => "0:raw-jetton-wallet" },
          init: undefined,
          createTransfer: vi.fn().mockReturnValue(cellMock),
        };
        mocks.walletV5R1Create.mockReturnValue(mockWallet);

        const mockContract = {
          getSeqno: vi.fn().mockResolvedValue(10),
        };
        (getCachedTonClient as Mock).mockResolvedValue({
          open: vi.fn().mockReturnValue(mockContract),
          getTransactions: confirmingGetTransactions(),
        });

        // Mock TonAPI jetton balances
        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            balances: [
              {
                balance: "100000000000", // 100 tokens (9 decimals)
                wallet_address: { address: "EQJettonWallet" },
                jetton: { address: jettonAddr, decimals: 9 },
              },
            ],
          })
        );
      });

      it("returns signed transfer for jetton", async () => {
        const result = await sdk.createJettonTransfer(jettonAddr, recipientAddr, 10);

        expect(result).toEqual({
          signedBoc: mockBocBuffer.toString("base64"),
          walletPublicKey: MOCK_PUBLIC_KEY,
          walletAddress: "0:raw-jetton-wallet",
          seqno: 10,
          validUntil: expect.any(Number),
          boc: mockBocBuffer.toString("base64"),
          publicKey: MOCK_PUBLIC_KEY,
          walletVersion: "v5r1",
        });
      });

      it("throws WALLET_NOT_INITIALIZED when wallet missing", async () => {
        (loadWallet as Mock).mockReturnValue(null);
        await expect(sdk.createJettonTransfer(jettonAddr, recipientAddr, 10)).rejects.toMatchObject(
          { code: "WALLET_NOT_INITIALIZED" }
        );
      });

      it("throws INVALID_ADDRESS for bad recipient", async () => {
        mocks.addressParse.mockImplementation(() => {
          throw new Error("bad address");
        });
        await expect(sdk.createJettonTransfer(jettonAddr, "garbage", 10)).rejects.toMatchObject({
          code: "INVALID_ADDRESS",
        });
      });

      it("throws OPERATION_FAILED when jetton not in balances", async () => {
        mocks.addressParse.mockImplementation((addr: string) => ({
          toString: () => addr,
        }));
        (tonapiFetch as Mock).mockResolvedValue(mockResponse({ balances: [] }));

        await expect(sdk.createJettonTransfer(jettonAddr, recipientAddr, 10)).rejects.toMatchObject(
          {
            code: "OPERATION_FAILED",
            message: expect.stringContaining("don't own"),
          }
        );
      });

      it("throws OPERATION_FAILED on insufficient balance", async () => {
        (tonapiFetch as Mock).mockResolvedValue(
          mockResponse({
            balances: [
              {
                balance: "5000000000", // 5 tokens
                wallet_address: { address: "EQJettonWallet" },
                jetton: { address: jettonAddr, decimals: 9 },
              },
            ],
          })
        );

        await expect(
          sdk.createJettonTransfer(jettonAddr, recipientAddr, 100)
        ).rejects.toMatchObject({
          code: "OPERATION_FAILED",
          message: expect.stringContaining("Insufficient balance"),
        });
      });

      it("throws OPERATION_FAILED when getKeyPair returns null", async () => {
        (getKeyPair as Mock).mockResolvedValue(null);
        await expect(sdk.createJettonTransfer(jettonAddr, recipientAddr, 1)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
          message: expect.stringContaining("key derivation"),
        });
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // LOW-LEVEL TRANSFER METHODS
  // ═══════════════════════════════════════════════════════════════

  describe("Low-level transfer methods", () => {
    const MOCK_PUBLIC_KEY = "a".repeat(64);
    const mockWalletData = {
      version: "w5r1" as const,
      address: VALID_ADDRESS,
      publicKey: MOCK_PUBLIC_KEY,
      mnemonic: Array(24).fill("test"),
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    const mockKeyPair = {
      publicKey: Buffer.from(MOCK_PUBLIC_KEY, "hex"),
      secretKey: Buffer.alloc(64),
    };

    describe("getSeqno()", () => {
      beforeEach(() => {
        (loadWallet as Mock).mockReturnValue(mockWalletData);
        (getKeyPair as Mock).mockResolvedValue(mockKeyPair);
        mocks.walletV5R1Create.mockReturnValue({});
        const mockContract = {
          getSeqno: vi.fn().mockResolvedValue(42),
        };
        (getCachedTonClient as Mock).mockResolvedValue({
          open: vi.fn().mockReturnValue(mockContract),
          getTransactions: confirmingGetTransactions(),
        });
      });

      it("returns current seqno when wallet initialized", async () => {
        const seqno = await sdk.getSeqno();
        expect(seqno).toBe(42);
      });

      it("throws WALLET_NOT_INITIALIZED when no wallet", async () => {
        (loadWallet as Mock).mockReturnValue(null);
        await expect(sdk.getSeqno()).rejects.toMatchObject({
          code: "WALLET_NOT_INITIALIZED",
        });
      });

      it("throws OPERATION_FAILED when getKeyPair returns null", async () => {
        (getKeyPair as Mock).mockResolvedValue(null);
        await expect(sdk.getSeqno()).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("invalidates client cache on 429", async () => {
        const err429 = Object.assign(new Error("Too Many Requests"), { status: 429 });
        (getCachedTonClient as Mock).mockRejectedValue(err429);

        await expect(sdk.getSeqno()).rejects.toMatchObject({ code: "OPERATION_FAILED" });
        expect(invalidateTonClientCache).toHaveBeenCalled();
      });
    });

    describe("runGetMethod()", () => {
      beforeEach(() => {
        mocks.addressParse.mockImplementation((addr: string) => ({
          toString: () => addr,
          toRawString: () => addr,
        }));
      });

      it("returns exitCode and stack for valid call", async () => {
        const mockTupleReader = {
          remaining: 2,
          pop: vi
            .fn()
            .mockReturnValueOnce({ type: "int", value: 123n })
            .mockReturnValueOnce({ type: "int", value: 456n }),
        };
        // Decrement remaining on each pop call
        let remaining = 2;
        Object.defineProperty(mockTupleReader, "remaining", {
          get: () => remaining,
        });
        const originalPop = mockTupleReader.pop;
        mockTupleReader.pop = vi.fn(() => {
          remaining--;
          return originalPop();
        });

        (getCachedTonClient as Mock).mockResolvedValue({
          runMethodWithError: vi.fn().mockResolvedValue({
            exit_code: 0,
            stack: mockTupleReader,
          }),
        });

        const result = await sdk.runGetMethod(VALID_ADDRESS, "get_data");
        expect(result.exitCode).toBe(0);
        expect(result.stack).toEqual([
          { type: "int", value: 123n },
          { type: "int", value: 456n },
        ]);
      });

      it("throws INVALID_ADDRESS for bad address", async () => {
        mocks.addressParse.mockImplementation(() => {
          throw new Error("bad address");
        });

        await expect(sdk.runGetMethod("garbage", "get_data")).rejects.toMatchObject({
          code: "INVALID_ADDRESS",
        });
      });

      it("throws OPERATION_FAILED on client error", async () => {
        (getCachedTonClient as Mock).mockResolvedValue({
          runMethodWithError: vi.fn().mockRejectedValue(new Error("network error")),
        });

        await expect(sdk.runGetMethod(VALID_ADDRESS, "get_data")).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("works without optional stack parameter", async () => {
        const remaining = 0;
        const mockTupleReader = {
          get remaining() {
            return remaining;
          },
          pop: vi.fn(),
        };

        const mockRunMethod = vi.fn().mockResolvedValue({
          exit_code: 0,
          stack: mockTupleReader,
        });

        (getCachedTonClient as Mock).mockResolvedValue({
          runMethodWithError: mockRunMethod,
        });

        const result = await sdk.runGetMethod(VALID_ADDRESS, "get_data");
        expect(result.exitCode).toBe(0);
        expect(result.stack).toEqual([]);
        // Verify the third argument is an empty array when stack is omitted
        expect(mockRunMethod).toHaveBeenCalledWith(expect.anything(), "get_data", []);
      });

      it("does not require wallet", async () => {
        // loadWallet is not called for read-only runGetMethod
        (loadWallet as Mock).mockReturnValue(null);

        const remaining = 0;
        const mockTupleReader = {
          get remaining() {
            return remaining;
          },
          pop: vi.fn(),
        };
        (getCachedTonClient as Mock).mockResolvedValue({
          runMethodWithError: vi.fn().mockResolvedValue({
            exit_code: 0,
            stack: mockTupleReader,
          }),
        });

        const result = await sdk.runGetMethod(VALID_ADDRESS, "get_jetton_data");
        expect(result.exitCode).toBe(0);
        expect(loadWallet).not.toHaveBeenCalled();
      });

      it("invalidates client cache on 429", async () => {
        const err429 = Object.assign(new Error("Too Many Requests"), { status: 429 });
        (getCachedTonClient as Mock).mockRejectedValue(err429);

        await expect(sdk.runGetMethod(VALID_ADDRESS, "get_data")).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
        expect(invalidateTonClientCache).toHaveBeenCalled();
      });
    });

    describe("send()", () => {
      const mockContract = {
        address: { toString: () => VALID_ADDRESS },
        getSeqno: vi.fn().mockResolvedValue(7),
        sendTransfer: vi.fn().mockResolvedValue(undefined),
      };

      beforeEach(() => {
        (loadWallet as Mock).mockReturnValue(mockWalletData);
        (getKeyPair as Mock).mockResolvedValue(mockKeyPair);
        mocks.walletV5R1Create.mockReturnValue({});
        mocks.toNano.mockReturnValue(BigInt(1000000000));
        mocks.internal.mockReturnValue({});
        mocks.addressParse.mockImplementation((addr: string) => ({
          toString: () => addr,
          toRawString: () => addr,
        }));
        (getCachedTonClient as Mock).mockResolvedValue({
          open: vi.fn().mockReturnValue(mockContract),
          getTransactions: confirmingGetTransactions(),
        });
        (withTxLock as Mock).mockImplementation((fn: () => any) => fn());
        mockContract.getSeqno.mockResolvedValue(7);
        mockContract.sendTransfer.mockResolvedValue(undefined);
      });

      it("sends with default options", async () => {
        const result = await sdk.send(VALID_ADDRESS, 1);
        expect(result).toEqual({ hash: "cd".repeat(32), seqno: 7 });
        expect(withTxLock).toHaveBeenCalled();
      });

      it("sends with Cell body", async () => {
        const mockCell = { toBoc: vi.fn() };
        const result = await sdk.send(VALID_ADDRESS, 1, { body: mockCell as any });
        expect(result.seqno).toBe(7);
        expect(mocks.internal).toHaveBeenCalledWith(expect.objectContaining({ body: mockCell }));
      });

      it("sends with string body (comment)", async () => {
        const result = await sdk.send(VALID_ADDRESS, 1, { body: "hello" });
        expect(result.seqno).toBe(7);
        expect(mocks.internal).toHaveBeenCalledWith(expect.objectContaining({ body: "hello" }));
      });

      it("sends with stateInit", async () => {
        const mockCode = { toBoc: vi.fn() };
        const mockData = { toBoc: vi.fn() };
        const stateInit = { code: mockCode as any, data: mockData as any };
        const result = await sdk.send(VALID_ADDRESS, 1, { stateInit });
        expect(result.seqno).toBe(7);
        expect(mocks.internal).toHaveBeenCalledWith(expect.objectContaining({ init: stateInit }));
      });

      it("sends with custom sendMode (0, 1, 2, 3)", async () => {
        for (const sendMode of [0, 1, 2, 3]) {
          vi.clearAllMocks();
          (loadWallet as Mock).mockReturnValue(mockWalletData);
          (getKeyPair as Mock).mockResolvedValue(mockKeyPair);
          mocks.walletV5R1Create.mockReturnValue({});
          mocks.toNano.mockReturnValue(BigInt(1000000000));
          mocks.internal.mockReturnValue({});
          mocks.addressParse.mockImplementation((addr: string) => ({
            toString: () => addr,
            toRawString: () => addr,
          }));
          mockContract.getSeqno.mockResolvedValue(7);
          mockContract.sendTransfer.mockResolvedValue(undefined);
          (getCachedTonClient as Mock).mockResolvedValue({
            open: vi.fn().mockReturnValue(mockContract),
            getTransactions: confirmingGetTransactions(),
          });
          (withTxLock as Mock).mockImplementation((fn: () => any) => fn());

          const result = await sdk.send(VALID_ADDRESS, 1, { sendMode });
          expect(result.seqno).toBe(7);
          expect(mockContract.sendTransfer).toHaveBeenCalledWith(
            expect.objectContaining({ sendMode })
          );
        }
      });

      it("throws WALLET_NOT_INITIALIZED", async () => {
        (loadWallet as Mock).mockReturnValue(null);
        await expect(sdk.send(VALID_ADDRESS, 1)).rejects.toMatchObject({
          code: "WALLET_NOT_INITIALIZED",
        });
      });

      it("throws INVALID_ADDRESS for bad address", async () => {
        mocks.addressParse.mockImplementation(() => {
          throw new Error("bad address");
        });
        await expect(sdk.send("garbage", 1)).rejects.toMatchObject({
          code: "INVALID_ADDRESS",
        });
      });

      it("throws OPERATION_FAILED for negative value or NaN", async () => {
        await expect(sdk.send(VALID_ADDRESS, -1)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
        await expect(sdk.send(VALID_ADDRESS, NaN)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws OPERATION_FAILED for unsafe sendMode (4, 32, 128)", async () => {
        await expect(sdk.send(VALID_ADDRESS, 1, { sendMode: 4 })).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
        await expect(sdk.send(VALID_ADDRESS, 1, { sendMode: 32 })).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
        await expect(sdk.send(VALID_ADDRESS, 1, { sendMode: 128 })).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws OPERATION_FAILED when getKeyPair returns null", async () => {
        (getKeyPair as Mock).mockResolvedValue(null);
        await expect(sdk.send(VALID_ADDRESS, 1)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("returns { hash, seqno } on success", async () => {
        const result = await sdk.send(VALID_ADDRESS, 1);
        expect(result).toHaveProperty("hash");
        expect(result).toHaveProperty("seqno");
        expect(result.seqno).toBe(7);
        expect(typeof result.hash).toBe("string");
      });

      it("allows zero-value send", async () => {
        const someCell = { toBoc: vi.fn() };
        const result = await sdk.send(VALID_ADDRESS, 0, { body: someCell as any });
        expect(result).toHaveProperty("seqno", 7);
      });
    });

    describe("sendMessages()", () => {
      const mockContract = {
        address: { toString: () => VALID_ADDRESS },
        getSeqno: vi.fn().mockResolvedValue(15),
        sendTransfer: vi.fn().mockResolvedValue(undefined),
      };

      beforeEach(() => {
        (loadWallet as Mock).mockReturnValue(mockWalletData);
        (getKeyPair as Mock).mockResolvedValue(mockKeyPair);
        mocks.walletV5R1Create.mockReturnValue({});
        mocks.toNano.mockReturnValue(BigInt(1000000000));
        mocks.internal.mockReturnValue({});
        mocks.addressParse.mockImplementation((addr: string) => ({
          toString: () => addr,
          toRawString: () => addr,
        }));
        (getCachedTonClient as Mock).mockResolvedValue({
          open: vi.fn().mockReturnValue(mockContract),
          getTransactions: confirmingGetTransactions(),
        });
        (withTxLock as Mock).mockImplementation((fn: () => any) => fn());
        mockContract.getSeqno.mockResolvedValue(15);
        mockContract.sendTransfer.mockResolvedValue(undefined);
      });

      it("sends multiple messages", async () => {
        const msgs = [
          { to: VALID_ADDRESS, value: 1 },
          { to: VALID_ADDRESS, value: 2 },
        ];
        const result = await sdk.sendMessages(msgs);
        expect(result).toEqual({ hash: "cd".repeat(32), seqno: 15 });
        expect(mocks.internal).toHaveBeenCalledTimes(2);
        expect(withTxLock).toHaveBeenCalled();
      });

      it("throws WALLET_NOT_INITIALIZED", async () => {
        (loadWallet as Mock).mockReturnValue(null);
        await expect(sdk.sendMessages([{ to: VALID_ADDRESS, value: 1 }])).rejects.toMatchObject({
          code: "WALLET_NOT_INITIALIZED",
        });
      });

      it("throws OPERATION_FAILED for empty messages array", async () => {
        await expect(sdk.sendMessages([])).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws OPERATION_FAILED for > 255 messages", async () => {
        const msgs = Array.from({ length: 256 }, () => ({
          to: VALID_ADDRESS,
          value: 1,
        }));
        await expect(sdk.sendMessages(msgs)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws INVALID_ADDRESS for bad address in messages", async () => {
        mocks.addressParse.mockImplementation(() => {
          throw new Error("bad address");
        });
        await expect(sdk.sendMessages([{ to: "garbage", value: 1 }])).rejects.toMatchObject({
          code: "INVALID_ADDRESS",
        });
      });

      it("throws OPERATION_FAILED for negative value in messages", async () => {
        await expect(sdk.sendMessages([{ to: VALID_ADDRESS, value: -1 }])).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws OPERATION_FAILED for unsafe sendMode", async () => {
        await expect(
          sdk.sendMessages([{ to: VALID_ADDRESS, value: 1 }], { sendMode: 4 })
        ).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("throws OPERATION_FAILED when getKeyPair returns null", async () => {
        (getKeyPair as Mock).mockResolvedValue(null);
        await expect(sdk.sendMessages([{ to: VALID_ADDRESS, value: 1 }])).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });

      it("allows zero-value message", async () => {
        const someCell = { toBoc: vi.fn() };
        const result = await sdk.sendMessages([
          { to: VALID_ADDRESS, value: 0, body: someCell as any },
        ]);
        expect(result).toHaveProperty("seqno", 15);
      });
    });

    describe("createSender()", () => {
      const mockContract = {
        address: { toString: () => VALID_ADDRESS },
        getSeqno: vi.fn().mockResolvedValue(20),
        sendTransfer: vi.fn().mockResolvedValue(undefined),
      };
      const mockWalletAddress = { toString: () => VALID_ADDRESS };

      beforeEach(() => {
        (loadWallet as Mock).mockReturnValue(mockWalletData);
        (getKeyPair as Mock).mockResolvedValue(mockKeyPair);
        mocks.walletV5R1Create.mockReturnValue({
          address: mockWalletAddress,
        });
        mocks.internal.mockReturnValue({});
        (getCachedTonClient as Mock).mockResolvedValue({
          open: vi.fn().mockReturnValue(mockContract),
          getTransactions: confirmingGetTransactions(),
        });
        (withTxLock as Mock).mockImplementation((fn: () => any) => fn());
        mockContract.getSeqno.mockResolvedValue(20);
        mockContract.sendTransfer.mockResolvedValue(undefined);
      });

      it("returns object with address and send function", async () => {
        const sender = await sdk.createSender();
        expect(sender).toHaveProperty("address");
        expect(sender).toHaveProperty("send");
        expect(typeof sender.send).toBe("function");
        expect(sender.address).toBe(mockWalletAddress);
      });

      it("sender.send() calls withTxLock and sendTransfer", async () => {
        const sender = await sdk.createSender();
        const mockTo = { toString: () => VALID_ADDRESS };
        await sender.send({
          to: mockTo as any,
          value: BigInt(1000000000),
        });
        expect(withTxLock).toHaveBeenCalled();
        expect(mockContract.sendTransfer).toHaveBeenCalledWith(
          expect.objectContaining({
            seqno: 20,
            secretKey: mockKeyPair.secretKey,
          })
        );
      });

      it("throws WALLET_NOT_INITIALIZED", async () => {
        (loadWallet as Mock).mockReturnValue(null);
        await expect(sdk.createSender()).rejects.toMatchObject({
          code: "WALLET_NOT_INITIALIZED",
        });
      });

      it("throws OPERATION_FAILED when getKeyPair returns null", async () => {
        (getKeyPair as Mock).mockResolvedValue(null);
        await expect(sdk.createSender()).rejects.toMatchObject({
          code: "OPERATION_FAILED",
        });
      });
    });
  });
});
