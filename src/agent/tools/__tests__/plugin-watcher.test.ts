import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { Type } from "@sinclair/typebox";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import type { Config } from "../../../config/schema.js";
import type { PluginModule, ToolExecutor } from "../types.js";
import { PluginExecutionGate } from "../plugin-execution-gate.js";
import { ToolRegistry } from "../registry.js";
import { HookRegistry } from "../../../sdk/hooks/registry.js";
import { InlineRouter } from "../../../bot/inline-router.js";

const testPaths = vi.hoisted(() => {
  const root = `/tmp/teleton-plugin-watcher-${process.pid}`;
  return { root, pluginsDir: `${root}/plugins` };
});

const loaderMocks = vi.hoisted(() => ({
  adaptPlugin: vi.fn(),
  assertTrustedPluginPath: vi.fn(),
  ensurePluginDeps: vi.fn(),
}));

vi.mock("../../../workspace/paths.js", () => ({
  TELETON_ROOT: testPaths.root,
  WORKSPACE_PATHS: { PLUGINS_DIR: testPaths.pluginsDir },
}));

vi.mock("../plugin-loader.js", () => loaderMocks);

import { PluginWatcher } from "../plugin-watcher.js";

const config = {
  agent: { provider: "anthropic", model: "test", max_tokens: 100 },
  telegram: { admin_ids: [], mode: "user" },
  plugins: {},
} as Config;

const tool = (name: string, executor: ToolExecutor) => ({
  tool: {
    name,
    description: `Test tool ${name}`,
    parameters: Type.Object({}),
    category: "data-bearing" as const,
  },
  executor,
});

describe("PluginWatcher", () => {
  let db: InstanceType<typeof Database>;
  let gate: PluginExecutionGate;
  let registry: ToolRegistry;
  let hookRegistry: HookRegistry;
  let inlineRouter: InlineRouter;
  let modules: PluginModule[];

  beforeAll(() => {
    mkdirSync(testPaths.pluginsDir, { recursive: true, mode: 0o700 });
    writeFileSync(`${testPaths.root}/package.json`, JSON.stringify({ type: "module" }), {
      mode: 0o600,
    });
  });

  beforeEach(() => {
    writeFileSync(`${testPaths.pluginsDir}/stateful.js`, "export const tools = [];\n", {
      mode: 0o600,
    });
    db = new Database(":memory:");
    gate = new PluginExecutionGate();
    registry = new ToolRegistry("user", gate);
    hookRegistry = new HookRegistry(gate);
    inlineRouter = new InlineRouter();
    modules = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  afterAll(() => {
    rmSync(testPaths.root, { recursive: true, force: true });
  });

  function createWatcher(): PluginWatcher {
    return new PluginWatcher({
      config,
      registry,
      sdkDeps: { bridge: { getMode: () => "user" } as never, inlineRouter, executionGate: gate },
      modules,
      pluginContext: { bridge: { getMode: () => "user" } as never, db, config },
      loadedModuleNames: [],
      hookRegistry,
      inlineRouter,
      executionGate: gate,
    });
  }

  async function reloadNow(watcher: PluginWatcher): Promise<boolean> {
    return (
      watcher as unknown as { reloadPlugin(pluginName: string): Promise<boolean> }
    ).reloadPlugin("stateful");
  }

  it("activates tools, hooks, and Bot handlers only after candidate startup", async () => {
    const order: string[] = [];
    const oldBotHandler = vi.fn(async () => []);
    const candidateBotHandler = vi.fn(async () => []);
    const oldHookHandler = vi.fn();
    const candidateHookHandler = vi.fn();
    const oldExecutor = vi.fn(async () => ({ success: true }));
    const candidateExecutor = vi.fn(async () => ({ success: true }));
    const oldModule: PluginModule = {
      name: "stateful",
      version: "1.0.0",
      sourceId: "stateful",
      tools: vi.fn(() => [tool("stateful_old", oldExecutor)]),
      stop: vi.fn(async () => {
        order.push("old-stop");
      }),
    };
    modules.push(oldModule);
    registry.registerPluginTools("stateful", [tool("stateful_old", oldExecutor)]);
    hookRegistry.register({
      pluginId: "stateful",
      hookName: "tool:after",
      handler: oldHookHandler,
      priority: 0,
    });
    inlineRouter.registerPlugin("stateful", { onInlineQuery: oldBotHandler });

    const candidate: PluginModule = {
      name: "stateful",
      version: "2.0.0",
      sourceId: "stateful",
      migrate: vi.fn(() => order.push("candidate-migrate")),
      tools: vi.fn(() => {
        order.push("candidate-tools");
        return [tool("stateful_new", candidateExecutor)];
      }),
      start: vi.fn(async () => {
        order.push("candidate-start");
        expect(registry.has("stateful_old")).toBe(true);
        expect(registry.has("stateful_new")).toBe(false);
        expect(inlineRouter.getPluginHandlers("stateful")?.onInlineQuery).toBe(oldBotHandler);
        expect(hookRegistry.getHooks("tool:after")[0]?.handler).toBe(oldHookHandler);
      }),
      stop: vi.fn(async () => undefined),
    };
    loaderMocks.adaptPlugin.mockImplementation((...args: unknown[]) => {
      const sdkDeps = args[4] as { inlineRouter: InlineRouter };
      const candidateHooks = args[5] as HookRegistry;
      candidateHooks.register({
        pluginId: "stateful",
        hookName: "tool:after",
        handler: candidateHookHandler,
        priority: 0,
      });
      sdkDeps.inlineRouter.registerPlugin("stateful", { onInlineQuery: candidateBotHandler });
      return candidate;
    });

    const result = await reloadNow(createWatcher());

    expect(result).toBe(true);
    expect(order).toEqual(["old-stop", "candidate-migrate", "candidate-tools", "candidate-start"]);
    expect(modules).toEqual([candidate]);
    expect(registry.has("stateful_old")).toBe(false);
    expect(registry.has("stateful_new")).toBe(true);
    expect(hookRegistry.getHooks("tool:after")[0]?.handler).toBe(candidateHookHandler);
    expect(inlineRouter.getPluginHandlers("stateful")?.onInlineQuery).toBe(candidateBotHandler);
    expect(gate.isQuiesced("stateful")).toBe(false);
  });

  it("reopens and restores the old runtime when candidate initialization fails", async () => {
    const oldBotHandler = vi.fn(async () => []);
    const restoredBotHandler = vi.fn(async () => []);
    const candidateBotHandler = vi.fn(async () => []);
    const oldHookHandler = vi.fn();
    const restoredHookHandler = vi.fn();
    const candidateHookHandler = vi.fn();
    const oldExecutor = vi.fn(async () => ({ success: true }));
    const candidateStop = vi.fn(async () => undefined);
    const oldModule: PluginModule = {
      name: "stateful",
      version: "1.0.0",
      sourceId: "stateful",
      migrate: vi.fn(),
      tools: vi.fn(() => {
        hookRegistry.register({
          pluginId: "stateful",
          hookName: "tool:after",
          handler: restoredHookHandler,
          priority: 0,
        });
        inlineRouter.registerPlugin("stateful", { onInlineQuery: restoredBotHandler });
        return [tool("stateful_old", oldExecutor)];
      }),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    modules.push(oldModule);
    registry.registerPluginTools("stateful", [tool("stateful_old", oldExecutor)]);
    hookRegistry.register({
      pluginId: "stateful",
      hookName: "tool:after",
      handler: oldHookHandler,
      priority: 0,
    });
    inlineRouter.registerPlugin("stateful", { onInlineQuery: oldBotHandler });

    const candidate: PluginModule = {
      name: "stateful",
      version: "2.0.0",
      sourceId: "stateful",
      migrate: vi.fn(),
      tools: vi.fn(() => {
        throw new Error("candidate tools failed");
      }),
      stop: candidateStop,
    };
    loaderMocks.adaptPlugin.mockImplementation((...args: unknown[]) => {
      const sdkDeps = args[4] as { inlineRouter: InlineRouter };
      const candidateHooks = args[5] as HookRegistry;
      candidateHooks.register({
        pluginId: "stateful",
        hookName: "tool:after",
        handler: candidateHookHandler,
        priority: 0,
      });
      sdkDeps.inlineRouter.registerPlugin("stateful", { onInlineQuery: candidateBotHandler });
      return candidate;
    });

    const result = await reloadNow(createWatcher());

    expect(result).toBe(false);
    expect(candidateStop).toHaveBeenCalledOnce();
    expect(oldModule.migrate).toHaveBeenCalledOnce();
    expect(oldModule.start).toHaveBeenCalledOnce();
    expect(modules).toEqual([oldModule]);
    expect(registry.has("stateful_old")).toBe(true);
    expect(hookRegistry.getHooks("tool:after")[0]?.handler).toBe(restoredHookHandler);
    expect(inlineRouter.getPluginHandlers("stateful")?.onInlineQuery).toBe(restoredBotHandler);
    expect(gate.isQuiesced("stateful")).toBe(false);
  });
});
