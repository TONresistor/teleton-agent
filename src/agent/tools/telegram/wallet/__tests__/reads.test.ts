import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import type { ToolContext } from "../../../types.js";
import { tools } from "../index.js";
import { tools as contacts } from "../../contacts/index.js";
import { walletData } from "../reads.js";
import { getBuiltinMinimumAccess } from "../../../security-policy.js";
import { ToolRegistry } from "../../../registry.js";
import { toLong } from "../../../../../utils/gramjs-bigint.js";

const enabled = vi.hoisted(() => ({ value: true }));
vi.mock("../../../../../ton/wallet-service.js", () => ({
  isTelegramWalletEnabled: () => enabled.value,
}));
const walletTools = [
  ...tools,
  contacts.find((entry) => entry.tool.name === "telegram_get_wallet_address")!,
];
function registerWalletTools(
  registry: ToolRegistry,
  executor?: (typeof tools)[number]["executor"]
) {
  for (const entry of walletTools)
    registry.register(
      entry.tool,
      executor ?? entry.executor,
      entry.scope,
      entry.mode,
      entry.tags,
      getBuiltinMinimumAccess(entry.tool, entry.scope)
    );
}
const invoke = vi.fn();
const context = {
  bridge: { getMode: () => "user", getClient: () => ({ getClient: () => ({ invoke }) }) },
} as unknown as ToolContext;

describe("Telegram wallet read tools", () => {
  it("exposes every wallet tool to admins in groups and DMs, never to non-admins", () => {
    const registry = new ToolRegistry("user");
    registerWalletTools(registry);
    registry.setAllowFrom([7]);
    for (const isGroup of [false, true]) {
      expect(
        registry
          .getForContext(isGroup, null, "123", true, 42)
          .map((tool) => tool.name)
          .sort()
      ).toEqual(walletTools.map((entry) => entry.tool.name).sort());
      expect(registry.getForContext(isGroup, null, "123", false, 7)).toEqual([]);
      const catalog = registry.getNamespaceCatalog(isGroup, "123", true, 42);
      expect(catalog.flatMap((entry) => entry.toolNames)).toContain(
        "telegram_wallet_get_gasless_info"
      );
    }
    registry.setMode("bot");
    expect(registry.getForContext(true, null, "123", true, 42)).toEqual([]);
  });

  it("hides wallet tools and rejects stale calls for legacy agents, while keeping TON tools", async () => {
    enabled.value = false;
    const registry = new ToolRegistry("user");
    const execute = vi.fn().mockResolvedValue({ success: true });
    registerWalletTools(registry, execute);
    const resolver = walletTools[walletTools.length - 1].tool;
    registry.register({ ...resolver, name: "ton_get_address" }, execute, "admin-only", "both");
    for (const isGroup of [false, true]) {
      expect(registry.getForContext(isGroup, null, "123", true, 42).map((t) => t.name)).toEqual([
        "ton_get_address",
      ]);
      expect(
        registry.getNamespaceCatalog(isGroup, "123", true, 42).flatMap((entry) => entry.toolNames)
      ).not.toContain("telegram_wallet_get_state");
    }
    for (const name of walletTools.map((entry) => entry.tool.name)) {
      expect(registry.isToolEnabled(name)).toBe(false);
      const result = await registry.execute(
        { type: "toolCall", id: "legacy", name, arguments: {} },
        {
          ...context,
          isGroup: false,
          senderId: 42,
          config: { telegram: { admin_ids: [42] } },
        } as unknown as ToolContext
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("disabled");
    }
    expect(execute).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    enabled.value = true;
    vi.clearAllMocks();
    invoke.mockResolvedValue(
      new Api.wallet.Transactions({ balance: toLong(0), transactions: [], chats: [], users: [] })
    );
  });
  it("preserves transaction lookup and pagination parameters", async () => {
    await tools
      .find((item) => item.tool.name === "telegram_wallet_get_transactions")!
      .executor({ offset: "cursor", limit: 3, inbound: true }, context);
    expect(invoke.mock.calls[0][0]).toMatchObject({
      offset: "cursor",
      limit: 3,
      inbound: true,
      outbound: undefined,
    });
  });
  it("distinguishes unavailable API from a user with no address", async () => {
    invoke.mockRejectedValue(new Error("400: WALLET_UNAVAILABLE"));
    const result = await tools[0].executor({}, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not proof that the target user has no wallet");
  });
  it("serializes nested values without losing long precision", () => {
    expect(
      walletData({ transactions: [{ amount: toLong("9007199254740993") }], _client: {} })
    ).toEqual({ transactions: [{ amount: "9007199254740993" }] });
  });
});
