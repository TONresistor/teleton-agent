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
} from "../../ton/wallet-service.js";
import { sendTon } from "../../ton/transfer.js";
import { tonapiFetch } from "../../constants/api-endpoints.js";
import { withBlockchainRetry } from "../../utils/retry.js";

// ─── Helpers ──────────────────────────────────────────────────────

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const VALID_ADDRESS = "EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2";

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

      it("returns txRef on success", async () => {
        (sendTon as Mock).mockResolvedValue("42_1700000000_1.5");

        const result = await sdk.sendTON(VALID_ADDRESS, 1.5, "hello");
        expect(result).toEqual({ txRef: "42_1700000000_1.5", amount: 1.5 });
        expect(sendTon).toHaveBeenCalledWith({
          toAddress: VALID_ADDRESS,
          amount: 1.5,
          comment: "hello",
          bounce: false,
        });
      });

      it("throws OPERATION_FAILED when sendTon returns null", async () => {
        (sendTon as Mock).mockResolvedValue(null);

        await expect(sdk.sendTON(VALID_ADDRESS, 1)).rejects.toMatchObject({
          code: "OPERATION_FAILED",
          message: expect.stringContaining("no reference returned"),
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
        mocks.tonClient.mockImplementation(function (this: any) {
          this.getTransactions = mockGetTx;
        });
        mocks.formatTransactions.mockReturnValue(mockTxs);

        const result = await sdk.getTransactions(VALID_ADDRESS, 5);
        expect(result).toEqual(mockTxs);
      });

      it("caps limit at 50", async () => {
        const mockGetTx = vi.fn().mockResolvedValue([]);
        mocks.tonClient.mockImplementation(function (this: any) {
          this.getTransactions = mockGetTx;
        });
        mocks.formatTransactions.mockReturnValue([]);

        await sdk.getTransactions(VALID_ADDRESS, 999);
        expect(mockGetTx).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ limit: 50 })
        );
      });

      it("defaults limit to 10 when not specified", async () => {
        const mockGetTx = vi.fn().mockResolvedValue([]);
        mocks.tonClient.mockImplementation(function (this: any) {
          this.getTransactions = mockGetTx;
        });
        mocks.formatTransactions.mockReturnValue([]);

        await sdk.getTransactions(VALID_ADDRESS);
        expect(mockGetTx).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ limit: 10 })
        );
      });

      it("returns empty array on error", async () => {
        mocks.tonClient.mockImplementation(function () {
          throw new Error("connection failed");
        });

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
          storeMaybeRef: vi.fn().mockReturnThis(),
          storeStringTail: vi.fn().mockReturnThis(),
          endCell: vi.fn().mockReturnValue(cellMock),
        };
        mocks.beginCell.mockReturnValue(builderMock);

        // Mock WalletContractV5R1
        mocks.walletV5R1Create.mockReturnValue({});

        // Mock toNano (used in TEP-74 transfer body)
        mocks.toNano.mockReturnValue(BigInt(1));

        // Mock TonClient (must use regular function for `new` constructor)
        const mockWalletContract = {
          getSeqno: vi.fn().mockResolvedValue(42),
          sendTransfer: vi.fn().mockResolvedValue(undefined),
        };
        mocks.tonClient.mockImplementation(function (this: any) {
          this.open = vi.fn().mockReturnValue(mockWalletContract);
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
        expect(result).toEqual({ success: true, seqno: 42 });
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
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════

  // These now use top-level ESM imports (mocked by vi.mock).
  // We configure the mock return values to match the real behaviour.
  describe("Utility methods", () => {
    describe("toNano()", () => {
      it("converts a number to nanoTON", () => {
        mocks.toNano.mockReturnValue(BigInt("1500000000"));
        const result = sdk.toNano(1.5);
        expect(mocks.toNano).toHaveBeenCalledWith("1.5");
        expect(result).toBe(BigInt("1500000000"));
      });

      it("converts a string to nanoTON", () => {
        mocks.toNano.mockReturnValue(BigInt("2000000000"));
        const result = sdk.toNano("2");
        expect(mocks.toNano).toHaveBeenCalledWith("2");
        expect(result).toBe(BigInt("2000000000"));
      });

      it("converts zero", () => {
        mocks.toNano.mockReturnValue(BigInt(0));
        expect(sdk.toNano(0)).toBe(BigInt(0));
      });

      it("throws PluginSDKError on invalid input", () => {
        mocks.toNano.mockImplementation(() => {
          throw new Error("Invalid number");
        });
        expect(() => sdk.toNano("not_a_number")).toThrow(PluginSDKError);
      });
    });

    describe("fromNano()", () => {
      it("converts nanoTON bigint to string", () => {
        mocks.fromNano.mockReturnValue("1.5");
        const result = sdk.fromNano(BigInt("1500000000"));
        expect(result).toBe("1.5");
      });

      it("converts nanoTON string to string", () => {
        mocks.fromNano.mockReturnValue("3");
        const result = sdk.fromNano("3000000000");
        expect(result).toBe("3");
      });

      it("converts zero", () => {
        mocks.fromNano.mockReturnValue("0");
        expect(sdk.fromNano(BigInt(0))).toBe("0");
      });
    });

    describe("validateAddress()", () => {
      it("returns true for a valid TON address", () => {
        mocks.addressParse.mockReturnValue({});
        expect(sdk.validateAddress(VALID_ADDRESS)).toBe(true);
      });

      it("returns false for an invalid address", () => {
        mocks.addressParse.mockImplementation(() => {
          throw new Error("Invalid");
        });
        expect(sdk.validateAddress("not-an-address")).toBe(false);
      });

      it("returns false for empty string", () => {
        mocks.addressParse.mockImplementation(() => {
          throw new Error("Invalid");
        });
        expect(sdk.validateAddress("")).toBe(false);
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
  // ERROR HANDLING PATTERNS
  // ═══════════════════════════════════════════════════════════════

  describe("Error handling patterns", () => {
    it("query methods return null/[] on error, never throw", async () => {
      // Force all wallet-service calls to throw
      (getWalletAddress as Mock).mockImplementation(() => {
        throw new Error("boom");
      });
      (getWalletBalance as Mock).mockRejectedValue(new Error("boom"));
      (getTonPrice as Mock).mockRejectedValue(new Error("boom"));
      (tonapiFetch as Mock).mockRejectedValue(new Error("boom"));

      // These should all return null/[]
      expect(sdk.getAddress()).toBeNull();
      expect(await sdk.getBalance(VALID_ADDRESS)).toBeNull();
      expect(await sdk.getPrice()).toBeNull();
      expect(await sdk.getJettonBalances(VALID_ADDRESS)).toEqual([]);
      expect(await sdk.getJettonInfo("EQ")).toBeNull();
      expect(await sdk.getNftItems(VALID_ADDRESS)).toEqual([]);
      expect(await sdk.getNftInfo("EQ")).toBeNull();
      expect(await sdk.getJettonWalletAddress(VALID_ADDRESS, "EQ")).toBeNull();
    });

    it("mutation methods throw PluginSDKError, not raw errors", async () => {
      (getWalletAddress as Mock).mockReturnValue(null);

      // sendTON
      try {
        await sdk.sendTON(VALID_ADDRESS, 1);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PluginSDKError);
      }

      // sendJetton
      (loadWallet as Mock).mockReturnValue(null);
      try {
        await sdk.sendJetton("EQ", "EQ", 1);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PluginSDKError);
      }

      // verifyPayment (no db)
      try {
        await sdk.verifyPayment({ amount: 1, memo: "x", gameType: "y" });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(PluginSDKError);
      }
    });
  });
});
