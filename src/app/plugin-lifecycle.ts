import type { PluginContext, PluginModule } from "../agent/tools/types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("App");
const PLUGIN_START_TIMEOUT_MS = 30_000;
const PLUGIN_STOP_TIMEOUT_MS = 30_000;

async function awaitLifecycle(
  operation: () => unknown | Promise<unknown>,
  label: string,
  duration: number
): Promise<void> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    log.warn(`${label} exceeded its deadline; waiting for actual settlement before cleanup`);
  }, duration);
  try {
    await operation();
    if (timedOut) throw new Error(`${label} timed out after 30s`);
  } finally {
    clearTimeout(timer);
  }
}

async function stopModule(module: PluginModule): Promise<void> {
  await awaitLifecycle(
    () => module.stop?.(),
    `Plugin "${module.name}" stop()`,
    PLUGIN_STOP_TIMEOUT_MS
  );
}

/** Start plugin jobs transactionally, rolling back those already started on failure. */
export async function startPluginModules(
  modules: PluginModule[],
  context: PluginContext
): Promise<void> {
  const started: PluginModule[] = [];
  try {
    for (const module of modules) {
      started.push(module);
      await awaitLifecycle(
        () => module.start?.(context),
        `Plugin "${module.name}" start()`,
        PLUGIN_START_TIMEOUT_MS
      );
    }
  } catch (error) {
    log.error({ err: error }, "Module start failed, cleaning up started modules");
    for (const module of started.reverse()) {
      try {
        await stopModule(module);
      } catch (cleanupError: unknown) {
        log.error({ err: cleanupError }, `Module "${module.name}" cleanup failed`);
      }
    }
    throw error;
  }
}

/** Stop every plugin independently so one failure cannot skip the remaining modules. */
export async function stopPluginModules(modules: PluginModule[]): Promise<void> {
  for (const module of modules) {
    try {
      await stopModule(module);
    } catch (error: unknown) {
      log.error({ err: error }, `Module "${module.name}" stop failed`);
    }
  }
}
