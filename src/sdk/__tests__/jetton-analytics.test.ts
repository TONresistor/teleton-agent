import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { PluginSDKError, type PluginLogger } from "@teleton-agent/sdk";

vi.mock("../../constants/api-endpoints.js", () => ({
  GECKOTERMINAL_API_URL: "https://gecko.test/api/v2",
  tonapiFetch: vi.fn(),
}));

vi.mock("../../utils/fetch.js", () => ({
  fetchWithTimeout: vi.fn(),
}));

import { tonapiFetch } from "../../constants/api-endpoints.js";
import { fetchWithTimeout } from "../../utils/fetch.js";
import { createJettonAnalyticsSDK } from "../ton/jetton-analytics.js";

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(body),
});

const log: PluginLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("jetton analytics SDK", () => {
  const sdk = createJettonAnalyticsSDK(log);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty addresses and invalid limits before any network call", async () => {
    await expect(sdk.getJettonPrice(" ")).rejects.toBeInstanceOf(PluginSDKError);
    await expect(sdk.getJettonHolders("EQJETTON", 0)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(sdk.getJettonHistory("")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(tonapiFetch).not.toHaveBeenCalled();
  });

  it("maps price rates and returns null for missing or failed data", async () => {
    (tonapiFetch as Mock).mockResolvedValueOnce(
      response({
        rates: {
          EQJETTON: {
            prices: { USD: 1.25, TON: 0.5 },
            diff_24h: { USD: "+1%" },
            diff_7d: { USD: "+2%" },
            diff_30d: { USD: "-3%" },
          },
        },
      })
    );

    await expect(sdk.getJettonPrice("EQJETTON")).resolves.toEqual({
      priceUSD: 1.25,
      priceTON: 0.5,
      change24h: "+1%",
      change7d: "+2%",
      change30d: "-3%",
    });

    (tonapiFetch as Mock).mockResolvedValueOnce(response({ rates: {} }));
    await expect(sdk.getJettonPrice("EQJETTON")).resolves.toBeNull();

    (tonapiFetch as Mock).mockRejectedValueOnce(new Error("network"));
    await expect(sdk.getJettonPrice("EQJETTON")).resolves.toBeNull();
  });

  it("maps holders using token decimals and caps the requested limit", async () => {
    (tonapiFetch as Mock)
      .mockResolvedValueOnce(
        response({
          addresses: [
            { owner: { address: "EQOWNER", name: "Alice" }, balance: "1234500" },
            { address: "EQFALLBACK", balance: "10" },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({ metadata: { decimals: "4" }, total_supply: "1", holders_count: 2 })
      );

    await expect(sdk.getJettonHolders("EQJETTON", 500)).resolves.toEqual([
      {
        rank: 1,
        address: "EQOWNER",
        name: "Alice",
        balance: "123.45",
        balanceRaw: "1234500",
      },
      {
        rank: 2,
        address: "EQFALLBACK",
        name: null,
        balance: "0.001",
        balanceRaw: "10",
      },
    ]);
    expect(tonapiFetch).toHaveBeenCalledWith(expect.stringContaining("limit=100"));
  });

  it("falls back to 9 decimals when metadata is malformed", async () => {
    (tonapiFetch as Mock)
      .mockResolvedValueOnce(
        response({ addresses: [{ address: "EQOWNER", balance: "1000000000" }] })
      )
      .mockResolvedValueOnce(response({ metadata: { decimals: "invalid" } }));

    await expect(sdk.getJettonHolders("EQJETTON")).resolves.toMatchObject([{ balance: "1" }]);
  });

  it("fails holders reads closed to an empty list", async () => {
    (tonapiFetch as Mock)
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({}, 503));
    await expect(sdk.getJettonHolders("EQJETTON")).resolves.toEqual([]);

    (tonapiFetch as Mock).mockRejectedValueOnce(new Error("network"));
    await expect(sdk.getJettonHolders("EQJETTON")).resolves.toEqual([]);
  });

  it("combines TonAPI and GeckoTerminal history", async () => {
    (tonapiFetch as Mock)
      .mockResolvedValueOnce(
        response({
          rates: {
            EQJETTON: {
              prices: { USD: 2.5, TON: 1.25 },
              diff_24h: { USD: "+1%" },
              diff_7d: { USD: "+2%" },
              diff_30d: { USD: "+3%" },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        response({ metadata: { symbol: "JET", name: "Jetton" }, holders_count: 42 })
      );
    (fetchWithTimeout as Mock).mockResolvedValueOnce(
      response({
        data: {
          attributes: {
            volume_usd: { h24: "1234" },
            fdv_usd: "5000",
            market_cap_usd: "4000",
          },
        },
      })
    );

    await expect(sdk.getJettonHistory("EQJETTON")).resolves.toEqual({
      symbol: "JET",
      name: "Jetton",
      currentPrice: "$2.500000",
      currentPriceTON: "1.250000 TON",
      changes: { "24h": "+1%", "7d": "+2%", "30d": "+3%" },
      volume24h: "$1,234",
      fdv: "$5,000",
      marketCap: "$4,000",
      holders: 42,
    });
  });

  it("returns defaults for unavailable history sources and null on rejection", async () => {
    (tonapiFetch as Mock)
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({}, 503));
    (fetchWithTimeout as Mock).mockResolvedValueOnce(response({}, 503));

    await expect(sdk.getJettonHistory("EQJETTON")).resolves.toMatchObject({
      symbol: "TOKEN",
      currentPrice: "N/A",
      volume24h: "N/A",
    });

    (tonapiFetch as Mock).mockRejectedValueOnce(new Error("network"));
    await expect(sdk.getJettonHistory("EQJETTON")).resolves.toBeNull();
  });
});
