import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
const fixtureRoot = vi.hoisted(() => `/tmp/teleton-plugin-gate-tests-${process.pid}`);
vi.mock("../../../workspace/paths.js", () => ({
  WORKSPACE_PATHS: { PLUGINS_DIR: fixtureRoot + "/plugins" },
  TELETON_ROOT: fixtureRoot,
}));
import { ConfigSchema } from "../../../config/schema.js";
import { adaptPlugin } from "../plugin-loader.js";
import { PluginWatcher } from "../plugin-watcher.js";
import { ToolRegistry } from "../registry.js";
import { HookRegistry } from "../../../sdk/hooks/registry.js";
import type { PluginModule } from "../types.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const globals = globalThis as typeof globalThis & {
  __teletonReloadTest?: {
    entered: ReturnType<typeof deferred>;
    release: ReturnType<typeof deferred>;
    ready: boolean;
    fail: boolean;
  };
};
let mainDb: Database.Database | undefined;
let modules: PluginModule[] = [];
afterEach(async () => {
  for (const module of modules) await module.stop?.();
  mainDb?.close();
  mainDb = undefined;
  modules = [];
  delete globals.__teletonReloadTest;
  rmSync(fixtureRoot, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("plugin reload resource barrier", () => {
  it.each([false, true])(
    "drains old work before replacement or failed-start rollback (fail=%s)",
    async (fail) => {
      mkdirSync(fixtureRoot + "/plugins", { recursive: true });
      mainDb = new Database(":memory:");
      const oldEntered = deferred(),
        oldRelease = deferred();
      const state = { entered: deferred(), release: deferred(), ready: false, fail };
      globals.__teletonReloadTest = state;
      writeFileSync(
        fixtureRoot + "/plugins/probe.js",
        `export const manifest={name:'probe',version:'2.0.0'};export const tools=[{name:'probe_action',description:'test',execute:async()=>({success:true,data:{ready:globalThis.__teletonReloadTest.ready}})}];export async function start({sdk}){sdk.on('tool:before',async()=>{});globalThis.__teletonReloadTest.entered.resolve();await globalThis.__teletonReloadTest.release.promise;if(globalThis.__teletonReloadTest.fail)throw new Error("startup failed");globalThis.__teletonReloadTest.ready=true;}`
      );
      const config = ConfigSchema.parse({
        agent: { api_key: "fake" },
        telegram: { admin_ids: [1], api_id: 1, api_hash: "fake", phone: "+33123456789" },
      });
      const sdkDeps = { bridge: { getMode: () => "user" } } as never;
      const old = adaptPlugin(
        {
          manifest: { name: "probe", version: "1.0.0" },
          tools: [
            {
              name: "probe_action",
              description: "test",
              execute: async (_params, context) => {
                oldEntered.resolve();
                await oldRelease.promise;
                context.db!.prepare("SELECT 1").get();
                return { success: true };
              },
            },
          ],
        },
        "probe.js",
        config,
        [],
        sdkDeps
      );
      old.migrate?.(mainDb);
      await old.start?.({} as never);
      const registry = new ToolRegistry();
      registry.setAdminIds([1]);
      registry.registerPluginTools("probe", old.tools(config));
      modules = [old];
      const context = { db: mainDb, chatId: "1", senderId: 1, isGroup: false, config } as never;
      const active = registry.execute(
        { type: "toolCall", id: "old", name: "probe_action", arguments: {} },
        context
      );
      await oldEntered.promise;
      const hooks = new HookRegistry();
      const watcher = new PluginWatcher({
        config,
        registry,
        sdkDeps,
        modules,
        pluginContext: { db: mainDb, config } as never,
        loadedModuleNames: [],
        hookRegistry: hooks,
      });
      const reload = (
        watcher as unknown as { reloadPlugin(name: string): Promise<boolean> }
      ).reloadPlugin("probe");
      await vi.waitFor(() => expect(old.executionGate?.accepting).toBe(false));
      expect(state.ready).toBe(false);
      oldRelease.resolve();
      await expect(active).resolves.toMatchObject({ success: true });
      await state.entered.promise;
      expect(registry.getAll().some((tool) => tool.name === "probe_action")).toBe(false);
      expect(hooks.hasAnyHooks()).toBe(false);
      state.release.resolve();
      expect(await reload).toBe(!fail);
      expect(modules[0].version).toBe(fail ? "1.0.0" : "2.0.0");
      expect(hooks.hasHooks("tool:before")).toBe(!fail);
      if (fail) {
        await expect(
          registry.execute(
            { type: "toolCall", id: "rollback", name: "probe_action", arguments: {} },
            context
          )
        ).resolves.toMatchObject({ success: true });
        return;
      }
      await expect(
        registry.execute(
          { type: "toolCall", id: "new", name: "probe_action", arguments: {} },
          context
        )
      ).resolves.toMatchObject({ success: true, data: { ready: true } });
    }
  );
});
