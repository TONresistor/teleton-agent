import { describe, it, expect } from "vitest";
import { HookRegistry } from "../registry.js";
import type { HookRegistration } from "../types.js";

describe("HookRegistry", () => {
  it("2.1 register adds hook, getHooks retrieves it", () => {
    const registry = new HookRegistry();
    const handler = () => {};
    registry.register({
      pluginId: "test-plugin",
      hookName: "tool:before",
      handler,
      priority: 0,
    });

    const hooks = registry.getHooks("tool:before");
    expect(hooks).toHaveLength(1);
    expect(hooks[0].pluginId).toBe("test-plugin");
    expect(hooks[0].handler).toBe(handler);
  });

  it("2.2 getHooks returns only hooks for specified name", () => {
    const registry = new HookRegistry();
    registry.register({
      pluginId: "a",
      hookName: "tool:before",
      handler: () => {},
      priority: 0,
    });
    registry.register({
      pluginId: "b",
      hookName: "tool:after",
      handler: () => {},
      priority: 0,
    });

    expect(registry.getHooks("tool:before")).toHaveLength(1);
    expect(registry.getHooks("tool:after")).toHaveLength(1);
    expect(registry.getHooks("session:start")).toHaveLength(0);
  });

  it("2.3 clear removes all hooks", () => {
    const registry = new HookRegistry();
    registry.register({
      pluginId: "a",
      hookName: "tool:before",
      handler: () => {},
      priority: 0,
    });
    expect(registry.hasHooks("tool:before")).toBe(true);

    registry.clear();
    expect(registry.hasHooks("tool:before")).toBe(false);
    expect(registry.getHooks("tool:before")).toHaveLength(0);
  });

  it("2.4 multiple plugins register same hook name", () => {
    const registry = new HookRegistry();
    registry.register({
      pluginId: "plugin-a",
      hookName: "tool:before",
      handler: () => {},
      priority: 0,
    });
    registry.register({
      pluginId: "plugin-b",
      hookName: "tool:before",
      handler: () => {},
      priority: 5,
    });

    const hooks = registry.getHooks("tool:before");
    expect(hooks).toHaveLength(2);
    expect(hooks.map((h) => h.pluginId)).toEqual(["plugin-a", "plugin-b"]);
  });

  // ── Global Priority Tests ──────────────────────────────────────────

  it("2.5 getHooks sorts by effectivePriority (globalPriority + priority)", () => {
    const registry = new HookRegistry();
    registry.register({
      pluginId: "analytics",
      hookName: "tool:before",
      handler: () => {},
      priority: 0,
      globalPriority: 50,
    });
    registry.register({
      pluginId: "security",
      hookName: "tool:before",
      handler: () => {},
      priority: 0,
      globalPriority: -100,
    });
    registry.register({
      pluginId: "helper",
      hookName: "tool:before",
      handler: () => {},
      priority: 0,
      globalPriority: 0,
    });

    const hooks = registry.getHooks("tool:before");
    expect(hooks.map((h) => h.pluginId)).toEqual(["security", "helper", "analytics"]);
  });

  it("2.6 globalPriority defaults to 0 when omitted (backward-compat)", () => {
    const registry = new HookRegistry();
    registry.register({
      pluginId: "legacy",
      hookName: "tool:before",
      handler: () => {},
      priority: 10,
    });

    const hooks = registry.getHooks("tool:before");
    expect(hooks[0].globalPriority).toBe(0);
  });

  it("2.7 effectivePriority combines global + handler priority", () => {
    const registry = new HookRegistry();
    // globalPriority=-50, handler priority=30 → effective=-20
    registry.register({
      pluginId: "combined-a",
      hookName: "message:receive",
      handler: () => {},
      priority: 30,
      globalPriority: -50,
    });
    // globalPriority=0, handler priority=-10 → effective=-10
    registry.register({
      pluginId: "combined-b",
      hookName: "message:receive",
      handler: () => {},
      priority: -10,
      globalPriority: 0,
    });

    const hooks = registry.getHooks("message:receive");
    // -20 < -10, so combined-a first
    expect(hooks.map((h) => h.pluginId)).toEqual(["combined-a", "combined-b"]);
  });

  it("2.8 same effectivePriority preserves registration order (stable sort)", () => {
    const registry = new HookRegistry();
    registry.register({
      pluginId: "first",
      hookName: "tool:after",
      handler: () => {},
      priority: 10,
      globalPriority: -10,
    });
    registry.register({
      pluginId: "second",
      hookName: "tool:after",
      handler: () => {},
      priority: 0,
      globalPriority: 0,
    });

    const hooks = registry.getHooks("tool:after");
    // Both effective = 0, registration order preserved
    expect(hooks.map((h) => h.pluginId)).toEqual(["first", "second"]);
  });

  it("2.9 getRegistrations filters by plugin and returns defensive copies", () => {
    const registry = new HookRegistry();
    registry.register({
      pluginId: "plugin-a",
      hookName: "tool:before",
      handler: () => {},
      priority: 1,
    });
    registry.register({
      pluginId: "plugin-b",
      hookName: "tool:after",
      handler: () => {},
      priority: 2,
    });

    const all = registry.getRegistrations();
    const pluginA = registry.getRegistrations("plugin-a");

    expect(all.map((registration) => registration.pluginId)).toEqual(["plugin-a", "plugin-b"]);
    expect(pluginA).toHaveLength(1);
    expect(pluginA[0].pluginId).toBe("plugin-a");

    pluginA[0].priority = 99;
    expect(registry.getHooks("tool:before")[0].priority).toBe(1);
  });

  it("2.10 replacePlugin replaces only the target plugin registrations", () => {
    const registry = new HookRegistry();
    registry.register({
      pluginId: "plugin-a",
      hookName: "tool:before",
      handler: () => {},
      priority: 0,
    });
    registry.register({
      pluginId: "plugin-b",
      hookName: "tool:before",
      handler: () => {},
      priority: 0,
    });
    const replacement: HookRegistration = {
      pluginId: "ignored",
      hookName: "tool:after",
      handler: () => {},
      priority: -5,
      globalPriority: 10,
    };

    registry.replacePlugin("plugin-a", [replacement]);

    expect(registry.getHooks("tool:before").map((hook) => hook.pluginId)).toEqual(["plugin-b"]);
    expect(registry.getHooks("tool:after")).toMatchObject([
      { pluginId: "plugin-a", priority: -5, globalPriority: 10 },
    ]);
  });
});
