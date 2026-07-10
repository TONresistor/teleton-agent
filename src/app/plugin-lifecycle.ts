import type { PluginContext, PluginModule } from "../agent/tools/types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("App");
const PLUGIN_START_TIMEOUT_MS = 30_000;
const PLUGIN_STOP_TIMEOUT_MS = 30_000;

function timeout(message: string, duration: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), duration));
}

async function stopModule(module: PluginModule): Promise<void> {
  await Promise.race([
    module.stop?.(),
    timeout(`Plugin "${module.name}" stop() timed out after 30s`, PLUGIN_STOP_TIMEOUT_MS),
  ]);
}

/** Start plugin jobs transactionally, rolling back those already started on failure. */
export async function startPluginModules(
  modules: PluginModule[],
  context: PluginContext
): Promise<void> {
  const started: PluginModule[] = [];
  try {
    for (const module of modules) {
      await Promise.race([
        module.start?.(context),
        timeout(`Plugin "${module.name}" start() timed out after 30s`, PLUGIN_START_TIMEOUT_MS),
      ]);
      started.push(module);
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
