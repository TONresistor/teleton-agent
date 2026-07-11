import { describe, expect, it } from "vitest";
import { requiresBuiltinApproval } from "../security-policy.js";

describe("built-in financial approval policy", () => {
  it.each([
    "ton_send",
    "jetton_send",
    "stonfi_swap",
    "dedust_swap",
    "dns_bid",
    "dns_start_auction",
    "dns_link",
    "dns_set_site",
    "dns_unlink",
    "telegram_buy_resale_gift",
    "telegram_set_collectible_price",
    "telegram_send_gift_offer",
    "telegram_resolve_gift_offer",
  ])("requires approval for %s", (toolName) => {
    expect(requiresBuiltinApproval(toolName)).toBe(true);
  });

  it.each(["ton_get_balance", "stonfi_quote", "dns_check", "telegram_get_stars_balance"])(
    "does not require approval for read-only tool %s",
    (toolName) => {
      expect(requiresBuiltinApproval(toolName)).toBe(false);
    }
  );
});
