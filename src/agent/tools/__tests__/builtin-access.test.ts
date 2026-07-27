import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { registerAllTools } from "../register-all.js";

const ADMIN_ONLY_TOOLS = [
  "ton_get_address",
  "ton_send",
  "jetton_send",
  "stonfi_swap",
  "dedust_swap",
  "telegram_get_dialogs",
  "telegram_get_history",
  "telegram_search_global",
  "telegram_search_posts",
  "telegram_create_scheduled_task",
  "workspace_list",
  "workspace_read",
  "workspace_write",
  "workspace_delete",
  "workspace_rename",
  "workspace_info",
  "memory_read",
  "memory_search",
  "session_search",
  "vision_analyze",
] as const;

const OWNER_PRIVATE_READS = [
  "ton_get_address",
  "ton_get_balance",
  "ton_my_transactions",
  "jetton_balances",
  "nft_list",
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
  "telegram_search_global",
  "telegram_search_messages",
  "telegram_search_posts",
  "vision_analyze",
] as const;

describe("built-in tool access policy", () => {
  it("hides private and financial tools from a non-admin DM", () => {
    const registry = new ToolRegistry("user");
    registerAllTools(registry);

    const visible = new Set(
      registry.getForContext(false, null, "dm", false, 12345).map((t) => t.name)
    );

    for (const name of ADMIN_ONLY_TOOLS) {
      expect(visible.has(name), `${name} must require admin authority`).toBe(false);
    }
  });

  it("allows trusted social actions without exposing financial actions", () => {
    const registry = new ToolRegistry("user");
    registerAllTools(registry);
    registry.setAllowFrom([12345]);

    const visible = new Set(
      registry.getForContext(false, null, "dm", false, 12345).map((t) => t.name)
    );

    expect(visible.has("telegram_send_message")).toBe(true);
    expect(visible.has("ton_send")).toBe(false);
    expect(visible.has("telegram_get_history")).toBe(false);
  });

  it("keeps every owner-default and account-private read admin-only", () => {
    const registry = new ToolRegistry("user");
    registerAllTools(registry);
    registry.setAllowFrom([12345]);

    const visible = new Set(
      registry.getForContext(false, null, "dm", false, 12345).map((t) => t.name)
    );

    for (const name of OWNER_PRIVATE_READS) {
      expect(visible.has(name), `${name} must remain owner-only`).toBe(false);
    }
  });

  it("hides global Telegram search tools in bot mode", () => {
    const registry = new ToolRegistry("bot");
    registerAllTools(registry);

    const visible = new Set(
      registry.getForContext(false, null, "dm", true, 42).map((tool) => tool.name)
    );

    expect(visible.has("telegram_search_global")).toBe(false);
    expect(visible.has("telegram_search_posts")).toBe(false);
  });
});
