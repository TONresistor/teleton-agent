import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import { toLong } from "../../../../../utils/gramjs-bigint.js";
import type { ToolContext } from "../../../types.js";
import { telegramGetResaleGiftsExecutor } from "../get-resale-gifts.js";
import { telegramGetUniqueGiftExecutor } from "../get-unique-gift.js";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("../../../../../sdk/telegram-utils.js", () => ({
  getClient: () => ({ invoke }),
}));

const context = {} as ToolContext;

function gift(
  slug: string,
  fields: Partial<ConstructorParameters<typeof Api.StarGiftUnique>[0]> = {}
) {
  return new Api.StarGiftUnique({
    id: toLong(1),
    giftId: toLong(2),
    title: "Plush",
    slug,
    num: 1,
    attributes: [],
    availabilityIssued: 1,
    availabilityTotal: 2,
    ...fields,
  });
}

function resaleResponse(...gifts: Api.TypeStarGift[]) {
  return new Api.payments.ResaleStarGifts({ count: gifts.length, gifts, chats: [], users: [] });
}

describe("gift resale prices", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it.each([
    [undefined, 0],
    ["all", 0],
    ["stars", 1 << 5],
    ["ton", 1 << 6],
    ["fragment", 1 << 7],
  ] as const)("serializes only the selected filter (%s)", async (market, flags) => {
    invoke.mockResolvedValue(resaleResponse());

    const result = await telegramGetResaleGiftsExecutor({ giftId: "2", market }, context);

    expect(result.success).toBe(true);
    const [request] = invoke.mock.calls[0] as [Api.payments.GetResaleStarGifts];
    expect(request.getBytes().readUInt32LE(4)).toBe(flags);
  });

  it("distinguishes mixed, Stars-only, TON-only, and absent prices", async () => {
    const ton = new Api.StarsTonAmount({ amount: toLong("9007199254740993001") });
    const stars = new Api.StarsAmount({ amount: toLong(25), nanos: 0 });
    invoke.mockResolvedValue(
      resaleResponse(
        gift("Mixed-1", { resellAmount: [ton, stars] }),
        gift("Stars-1", { resellAmount: [stars] }),
        gift("Ton-1", { resellAmount: [ton], resaleTonOnly: true }),
        gift("None-1")
      )
    );

    const result = await telegramGetResaleGiftsExecutor({ giftId: "2" }, context);

    expect(result.data).toMatchObject({
      listings: [
        { priceStars: "25", priceTon: "9007199254.740993001", canBuyWithStars: true },
        { priceStars: "25", priceTon: undefined, canBuyWithStars: true },
        {
          priceStars: undefined,
          priceTon: "9007199254.740993001",
          resaleTonOnly: true,
          canBuyWithStars: false,
        },
        { priceStars: undefined, priceTon: undefined, canBuyWithStars: false },
      ],
      usage: expect.stringContaining("maximum Stars explicitly approved by the owner"),
    });
  });

  it("omits Stars purchase guidance for on-chain, TON-only, and fractional prices", async () => {
    const stars = new Api.StarsAmount({ amount: toLong(25), nanos: 0 });
    invoke.mockResolvedValue(
      resaleResponse(
        gift("Chain-1", { resellAmount: [stars], onchainSale: true, fixedSale: true }),
        gift("Ton-1", { resellAmount: [new Api.StarsTonAmount({ amount: toLong(1) })] }),
        gift("Fraction-1", {
          resellAmount: [new Api.StarsAmount({ amount: toLong(25), nanos: 1 })],
        })
      )
    );

    const result = await telegramGetResaleGiftsExecutor({ giftId: "2" }, context);

    expect(result.data).toMatchObject({
      listings: [
        { onchainSale: true, fixedSale: true, canBuyWithStars: false },
        { canBuyWithStars: false },
        { priceStars: "25.000000001", canBuyWithStars: false },
      ],
      usage: undefined,
    });
  });

  it("does not recommend a Stars purchase in a Fragment search", async () => {
    const stars = new Api.StarsAmount({ amount: toLong(25), nanos: 0 });
    invoke.mockResolvedValue(resaleResponse(gift("Fragment-1", { resellAmount: [stars] })));

    const result = await telegramGetResaleGiftsExecutor(
      { giftId: "2", market: "fragment" },
      context
    );

    expect(result.data).toMatchObject({ listings: [{ canBuyWithStars: false }], usage: undefined });
  });

  it("keeps raw amounts and includes readable prices and on-chain details", async () => {
    invoke.mockResolvedValue(
      new Api.payments.UniqueStarGift({
        gift: gift("Chain-1", {
          resellAmount: [
            new Api.StarsAmount({ amount: toLong("9007199254740993"), nanos: 1 }),
            new Api.StarsTonAmount({ amount: toLong("1250000000") }),
          ],
          onchainSale: true,
          fixedSale: true,
          mySale: true,
          offerMinAmount: toLong("9007199254740993001"),
          feeBps: 0,
        }),
        chats: [],
        users: [],
      })
    );

    const result = await telegramGetUniqueGiftExecutor({ slug: "Chain-1" }, context);

    expect(result.data).toMatchObject({
      resellPrices: [
        {
          amount: "9007199254740993",
          currency: "Stars",
          displayAmount: "9007199254740993.000000001",
          isTon: false,
        },
        { amount: "1250000000", currency: "TON", displayAmount: "1.25", isTon: true },
      ],
      onchainSale: true,
      fixedSale: true,
      mySale: true,
      offerMinAmount: "9007199254740993001",
      feeBps: 0,
    });
  });
});
