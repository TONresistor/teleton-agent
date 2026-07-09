import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { registerAllTools } from "../register-all.js";

const ADMIN_ONLY_TOOLS = [
  "ton_send",
  "jetton_send",
  "stonfi_swap",
  "dedust_swap",
  "telegram_get_dialogs",
  "telegram_get_history",
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
});
