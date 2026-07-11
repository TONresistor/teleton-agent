import type { Tool, ToolAccessLevel, ToolScope } from "./types.js";
import { scopeToLevel } from "./scope.js";

/**
 * Data-bearing tools that expose owner-only state rather than public network data.
 * Keep this list narrow: public market, DNS and blockchain lookups remain available.
 */
const OWNER_PRIVATE_DATA = new Set([
  "journal_query",
  "memory_read",
  "memory_search",
  "session_search",
  "telegram_get_admined_channels",
  "telegram_get_blocked",
  "telegram_get_common_chats",
  "telegram_get_dialogs",
  "telegram_get_folders",
  "telegram_get_history",
  "telegram_get_me",
  "telegram_get_my_gifts",
  "telegram_get_my_stickers",
  "telegram_get_replies",
  "telegram_get_scheduled_messages",
  "telegram_get_stars_balance",
  "telegram_get_stars_transactions",
  "telegram_get_user_info",
  "telegram_search_messages",
  "ton_get_address",
  "ton_get_balance",
  "ton_my_transactions",
  "jetton_balances",
  "nft_list",
]);

const OWNER_ONLY_ACTIONS = new Set(["telegram_create_scheduled_task"]);

/**
 * Built-ins that spend funds, sign an on-chain state change, or transfer a
 * collectible. These must never rely on natural-language model instructions
 * as proof of owner consent.
 */
const APPROVAL_REQUIRED = new Set([
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
]);

export function requiresBuiltinApproval(toolName: string): boolean {
  return APPROVAL_REQUIRED.has(toolName);
}

/**
 * Built-in security defaults. Channel placement and authority are intentionally
 * independent: a tool can be DM-only and still require an admin identity.
 */
export function getBuiltinMinimumAccess(tool: Tool, scope?: ToolScope): ToolAccessLevel {
  if (scope === "dm-only" || scope === "group-only" || scope === "admin-only") {
    return "admin";
  }
  if (scope === "allowlist" || scope === "disabled") {
    return scopeToLevel(scope);
  }

  if (
    OWNER_ONLY_ACTIONS.has(tool.name) ||
    OWNER_PRIVATE_DATA.has(tool.name) ||
    tool.name.startsWith("workspace_")
  ) {
    return "admin";
  }

  // Telegram tools operate through the owner's account. Even harmless-looking
  // reads/actions are not offered to arbitrary users when dm_policy is open.
  if (tool.name.startsWith("telegram_")) return "allowlist";

  // Uncategorised built-ins are actions by convention. Public read-only tools
  // explicitly declare data-bearing and remain available to open conversations.
  return tool.category === "data-bearing" ? "all" : "allowlist";
}
