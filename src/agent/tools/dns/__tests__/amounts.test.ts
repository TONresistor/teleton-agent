import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../types.js";
import { tonapiFetch } from "../../../../constants/api-endpoints.js";
import { dnsAuctionsExecutor } from "../auctions.js";
import { dnsCheckExecutor } from "../check.js";

vi.mock("../../../../constants/api-endpoints.js", () => ({ tonapiFetch: vi.fn() }));

const context = {} as ToolContext;
const prices = [
  [997259531, "0.997259531"],
  ["997086131", "0.997086131"],
  ["1", "0.000000001"],
  ["12345678901", "12.345678901"],
  ["9007199254740993", "9007199.254740993"],
  ["2000000000", "2"],
] as const;

function response(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}

function auction(price: number | string, domain = "example.ton") {
  return { domain, price, bids: 1, date: 1794092077, owner: "test-bidder" };
}

describe("native DNS auction amounts", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(prices)("preserves %s nanoTON as %s TON in auction listings", async (price, ton) => {
    vi.mocked(tonapiFetch).mockResolvedValue(response({ total: 1, data: [auction(price)] }));

    const result = await dnsAuctionsExecutor({ limit: 1 }, context);

    expect(result).toMatchObject({
      success: true,
      data: {
        showing: 1,
        auctions: [{ currentBid: `${ton} TON` }],
        message: expect.stringContaining(`${ton} TON`),
      },
    });
  });

  it.each(prices)("preserves %s nanoTON as %s TON in individual checks", async (price, ton) => {
    vi.mocked(tonapiFetch)
      .mockResolvedValueOnce(response({ item: { address: "test-nft" } }))
      .mockResolvedValueOnce(response({ total: 1, data: [auction(price)] }));

    const result = await dnsCheckExecutor({ domain: "example.ton" }, context);

    expect(result).toMatchObject({
      success: true,
      data: {
        status: "IN_AUCTION",
        currentBid: `${ton} TON`,
        message: expect.stringContaining(`${ton} TON`),
      },
    });
  });

  it("keeps the global total separate from the requested result count", async () => {
    vi.mocked(tonapiFetch).mockResolvedValue(
      response({
        total: 71,
        data: [
          auction(997259531, "first.ton"),
          auction(997086131, "second.ton"),
          auction("2000000000", "third.ton"),
        ],
      })
    );

    const result = await dnsAuctionsExecutor({ limit: 2 }, context);

    expect(result).toMatchObject({
      success: true,
      data: {
        total: 71,
        showing: 2,
        auctions: [{ domain: "first.ton" }, { domain: "second.ton" }],
        message: expect.stringContaining("Active auctions (2/71)"),
      },
    });
  });
});
