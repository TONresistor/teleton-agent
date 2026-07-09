import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("../../../../../sdk/telegram-utils.js", () => ({
  getClient: vi.fn(() => ({ invoke })),
}));

import { telegramBuyResaleGiftExecutor } from "../buy-resale-gift.js";

function paymentForm(price: number, currency = "XTR") {
  return {
    formId: 123n,
    invoice: {
      currency,
      prices: [{ label: "gift", amount: BigInt(price) }],
    },
  };
}

describe("telegram_buy_resale_gift", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("fails closed when the current price exceeds the approved maximum", async () => {
    invoke.mockResolvedValueOnce(paymentForm(101));

    const result = await telegramBuyResaleGiftExecutor({ slug: "Plush-1", maxPriceStars: 100 }, {
      bridge: {},
    } as never);

    expect(result.success).toBe(false);
    expect(result.error).toContain("101 Stars");
    expect(result.error).toContain("approved maximum of 100 Stars");
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("purchases only after verifying the live Stars price", async () => {
    invoke.mockResolvedValueOnce(paymentForm(100)).mockResolvedValueOnce({});

    const result = await telegramBuyResaleGiftExecutor({ slug: "Plush-1", maxPriceStars: 100 }, {
      bridge: {},
    } as never);

    expect(result).toMatchObject({
      success: true,
      data: { slug: "Plush-1", purchased: true, priceStars: 100 },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-Stars payment form", async () => {
    invoke.mockResolvedValueOnce(paymentForm(1, "TON"));

    const result = await telegramBuyResaleGiftExecutor({ slug: "Plush-1", maxPriceStars: 100 }, {
      bridge: {},
    } as never);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported resale currency");
    expect(invoke).toHaveBeenCalledOnce();
  });
});
