import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { Type } from "@sinclair/typebox";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { Config } from "../../../config/schema.js";
import type { PluginModule, ToolExecutor } from "../../../agent/tools/types.js";
import { PluginExecutionGate } from "../../../agent/tools/plugin-execution-gate.js";
import { ToolRegistry } from "../../../agent/tools/registry.js";
import { HookRegistry } from "../../../sdk/hooks/registry.js";
import { InlineRouter } from "../../../bot/inline-router.js";

const testPaths = vi.hoisted(() => {
  const root = "/tmp/teleton-marketplace-" + process.pid;
  return { root, pluginsDir: root + "/plugins" };
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

vi.mock("../../../agent/tools/plugin-loader.js", () => loaderMocks);

import { MarketplaceService } from "../marketplace.js";

const config = {
  agent: { provider: "anthropic", model: "test", max_tokens: 100 },
  telegram: { admin_ids: [], mode: "user" },
  plugins: {},
} as Config;

const tool = (name: string, executor: ToolExecutor) => ({
  tool: {
    name,
    description: "Test tool " + name,
    parameters: Type.Object({}),
    category: "data-bearing" as const,
  },
  executor,
});

describe("MarketplaceService runtime lifecycle", () => {
  let db: InstanceType<typeof Database>;
  let gate: PluginExecutionGate;
  let registry: ToolRegistry;
  let hookRegistry: HookRegistry;
  let inlineRouter: InlineRouter;
  let modules: PluginModule[];
  let rewireHooks: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    mkdirSync(testPaths.pluginsDir, { recursive: true, mode: 0o700 });
    writeFileSync(testPaths.root + "/package.json", JSON.stringify({ type: "module" }), {
      mode: 0o600,
    });
  });

  beforeEach(() => {
    db = new Database(":memory:");
    gate = new PluginExecutionGate();
    registry = new ToolRegistry("user", gate);
    hookRegistry = new HookRegistry(gate);
    inlineRouter = new InlineRouter();
    modules = [];
    rewireHooks = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    db.close();
    rmSync(testPaths.pluginsDir, { recursive: true, force: true });
    mkdirSync(testPaths.pluginsDir, { recursive: true, mode: 0o700 });
  });

  afterAll(() => {
    rmSync(testPaths.root, { recursive: true, force: true });
  });

  function createService(): MarketplaceService {
    return new MarketplaceService({
      toolRegistry: registry,
      modules,
      config,
      sdkDeps: {
        bridge: { getMode: () => "user" } as never,
        inlineRouter,
        executionGate: gate,
      },
      pluginContext: { bridge: { getMode: () => "user" } as never, db, config },
      loadedModuleNames: () => modules.map((module) => module.name),
      rewireHooks,
      hookRegistry,
      inlineRouter,
      executionGate: gate,
    });
  }

  it("drains in-flight work before stop and removes every runtime surface", async () => {
    const stop = vi.fn(async () => undefined);
    const plugin: PluginModule = {
      name: "marketplace-test",
      version: "1.0.0",
      sourceId: "marketplace-test",
      tools: () => [],
      stop,
    };
    modules.push(plugin);
    registry.registerPluginTools("marketplace-test", [
      tool(
        "marketplace_test_read",
        vi.fn(async () => ({ success: true }))
      ),
    ]);
    hookRegistry.register({
      pluginId: "marketplace-test",
      hookName: "tool:after",
      handler: vi.fn(),
      priority: 0,
    });
    inlineRouter.registerPlugin("marketplace-test", { onInlineQuery: vi.fn(async () => []) });
    const release = gate.enter("marketplace-test");

    const uninstall = createService().uninstallPlugin("marketplace-test");
    await Promise.resolve();
    expect(stop).not.toHaveBeenCalled();

    release?.();
    await uninstall;

    expect(stop).toHaveBeenCalledOnce();
    expect(registry.has("marketplace_test_read")).toBe(false);
    expect(hookRegistry.getRegistrations("marketplace-test")).toEqual([]);
    expect(inlineRouter.hasPlugin("marketplace-test")).toBe(false);
    expect(modules).toEqual([]);
    expect(gate.isQuiesced("marketplace-test")).toBe(false);
  });

  it("publishes a downloaded plugin only after candidate startup succeeds", async () => {
    const candidateHook = vi.fn();
    const candidateBot = vi.fn(async () => []);
    const candidateExecutor = vi.fn(async () => ({ success: true }));
    const candidate: PluginModule = {
      name: "marketplace-test",
      version: "2.0.0",
      sourceId: "marketplace-test",
      migrate: vi.fn(),
      tools: vi.fn(() => [tool("marketplace_test_read", candidateExecutor)]),
      start: vi.fn(async () => {
        expect(registry.has("marketplace_test_read")).toBe(false);
        expect(hookRegistry.getRegistrations("marketplace-test")).toEqual([]);
        expect(inlineRouter.hasPlugin("marketplace-test")).toBe(false);
      }),
      stop: vi.fn(async () => undefined),
    };
    loaderMocks.adaptPlugin.mockImplementation((...args: unknown[]) => {
      const sdkDeps = args[4] as { inlineRouter: InlineRouter };
      const candidateHooks = args[5] as HookRegistry;
      candidateHooks.register({
        pluginId: "marketplace-test",
        hookName: "tool:after",
        handler: candidateHook,
        priority: 0,
      });
      sdkDeps.inlineRouter.registerPlugin("marketplace-test", { onInlineQuery: candidateBot });
      return candidate;
    });

    const service = createService();
    Reflect.set(service, "cache", {
      entries: [
        {
          id: "marketplace-test",
          name: "Marketplace Test",
          description: "Test plugin",
          author: "Teleton",
          tags: [],
          path: "plugins/marketplace-test",
        },
      ],
      fetchedAt: Date.now(),
    });
    Reflect.set(
      service,
      "manifestCache",
      new Map([
        [
          "marketplace-test",
          {
            data: { name: "marketplace-test", version: "2.0.0" },
            fetchedAt: Date.now(),
          },
        ],
      ])
    );
    Reflect.set(
      service,
      "downloadDir",
      vi.fn(async (_remotePath: string, localDir: string) => {
        writeFileSync(localDir + "/index.js", "export const tools = [];\n", { mode: 0o600 });
      })
    );

    const result = await service.installPlugin("marketplace-test");

    expect(result).toEqual({ name: "marketplace-test", version: "2.0.0", toolCount: 1 });
    expect(modules).toEqual([candidate]);
    expect(registry.has("marketplace_test_read")).toBe(true);
    expect(hookRegistry.getHooks("tool:after")[0]?.handler).toBe(candidateHook);
    expect(inlineRouter.getPluginHandlers("marketplace-test")?.onInlineQuery).toBe(candidateBot);
    expect(gate.isQuiesced("marketplace-test")).toBe(false);
  });

  it("keeps the existing runtime intact when an update cannot drain active work", async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn(async () => undefined);
      const plugin: PluginModule = {
        name: "marketplace-test",
        version: "1.0.0",
        sourceId: "marketplace-test",
        tools: () => [],
        stop,
      };
      modules.push(plugin);
      registry.registerPluginTools("marketplace-test", [
        tool(
          "marketplace_test_read",
          vi.fn(async () => ({ success: true }))
        ),
      ]);
      const release = gate.enter("marketplace-test");

      const update = createService().updatePlugin("marketplace-test");
      const rejected = expect(update).rejects.toThrow(/did not drain/);
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;

      expect(stop).not.toHaveBeenCalled();
      expect(modules).toEqual([plugin]);
      expect(registry.has("marketplace_test_read")).toBe(true);
      expect(gate.isQuiesced("marketplace-test")).toBe(false);
      release?.();
    } finally {
      vi.useRealTimers();
    }
  });
});
