import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginSDKError } from "@teleton-agent/sdk";

const mocks = vi.hoisted(() => ({
  tonapiFetch: vi.fn(),
  loadWallet: vi.fn(),
  linkDnsWallet: vi.fn(),
  unlinkDnsWallet: vi.fn(),
  setDnsSite: vi.fn(),
}));

vi.mock("../../constants/api-endpoints.js", () => ({ tonapiFetch: mocks.tonapiFetch }));
vi.mock("../../ton/wallet-service.js", () => ({
  loadWallet: mocks.loadWallet,
  getKeyPair: vi.fn(),
  getCachedTonClient: vi.fn(),
}));
vi.mock("../../ton/dns-service.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../ton/dns-service.js")>();
  return {
    ...original,
    linkDnsWallet: mocks.linkDnsWallet,
    unlinkDnsWallet: mocks.unlinkDnsWallet,
    setDnsSite: mocks.setDnsSite,
  };
});

import { DnsUpdateError } from "../../ton/dns-service.js";
import { createDnsSDK } from "../ton-dns.js";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createDnsSDK", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadWallet.mockReturnValue({ address: "EQ-wallet" });
  });

  it("normalizes domains and reports availability on 404", async () => {
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    await expect(createDnsSDK(log).check(" Example.TON ")).resolves.toEqual({
      domain: "example.ton",
      available: true,
    });
    expect(mocks.tonapiFetch).toHaveBeenCalledWith("/dns/example.ton");
  });

  it("maps a registered domain response", async () => {
    mocks.tonapiFetch.mockResolvedValue(
      response({
        wallet: { address: "EQ-record" },
        item: { address: "EQ-nft", owner: { address: "EQ-owner" } },
      })
    );
    await expect(createDnsSDK(log).check("example")).resolves.toEqual({
      domain: "example.ton",
      available: false,
      owner: "EQ-owner",
      nftAddress: "EQ-nft",
      walletAddress: "EQ-record",
    });
  });

  it("fails with a typed error for an empty domain", async () => {
    await expect(createDnsSDK(log).check("  ")).rejects.toMatchObject({
      name: "PluginSDKError",
      code: "INVALID_INPUT",
    });
    expect(mocks.tonapiFetch).not.toHaveBeenCalled();
  });

  it("returns null when resolution is unavailable", async () => {
    mocks.tonapiFetch.mockResolvedValue(response({}, 404));
    await expect(createDnsSDK(log).resolve("missing")).resolves.toBeNull();
  });

  it("bounds auction queries and maps their result", async () => {
    mocks.tonapiFetch.mockResolvedValue(
      response({
        data: [
          {
            domain: "sale.ton",
            nft: { address: "EQ-nft" },
            owner: { address: "EQ-owner" },
            price: "1500000000",
            date: 123,
            bids: 4,
          },
        ],
      })
    );
    await expect(createDnsSDK(log).getAuctions(500)).resolves.toEqual([
      {
        domain: "sale.ton",
        nftAddress: "EQ-nft",
        owner: "EQ-owner",
        lastBid: "1.50",
        endTime: 123,
        bids: 4,
      },
    ]);
    expect(mocks.tonapiFetch).toHaveBeenCalledWith("/dns/auctions?tld=ton&limit=100");
  });

  it("rejects an invalid auction limit and bid amount", async () => {
    const sdk = createDnsSDK(log);
    await expect(sdk.getAuctions(0)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(sdk.bid("example", Number.NaN)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("requires a wallet before starting an auction", async () => {
    mocks.loadWallet.mockReturnValue(null);
    await expect(createDnsSDK(log).startAuction("example")).rejects.toMatchObject({
      code: "WALLET_NOT_INITIALIZED",
    });
  });

  it("delegates owned-record updates to the canonical DNS service", async () => {
    const sdk = createDnsSDK(log);
    await sdk.link("example", "EQ-address");
    await sdk.unlink("example");
    await sdk.setSiteRecord("example", "a".repeat(64));

    expect(mocks.linkDnsWallet).toHaveBeenCalledWith("example", "EQ-address");
    expect(mocks.unlinkDnsWallet).toHaveBeenCalledWith("example");
    expect(mocks.setDnsSite).toHaveBeenCalledWith("example", "a".repeat(64));
  });

  it("maps canonical DNS validation failures to SDK error codes", async () => {
    mocks.setDnsSite.mockRejectedValue(new DnsUpdateError("Invalid ADNL", "INVALID_ADNL_ADDRESS"));
    await expect(createDnsSDK(log).setSiteRecord("example", "bad")).rejects.toEqual(
      new PluginSDKError("Invalid ADNL", "INVALID_INPUT")
    );
  });
});
