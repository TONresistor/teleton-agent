import type { HookRegistry } from "./registry.js";
import type { HookHandlerMap, HookName, HookRunnerOptions } from "./types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { AsyncLocalStorage } from "async_hooks";

const DEFAULT_TIMEOUT_MS = 5000;

async function withTimeout(
  fn: () => void | Promise<void>,
  ms: number,
  label: string
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(fn()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Hook timeout: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Hooks that support short-circuit via block=true */
const BLOCKABLE_HOOKS: ReadonlySet<HookName> = new Set([
  "tool:before",
  "message:receive",
  "response:before",
]);

export function createHookRunner(registry: HookRegistry, opts: HookRunnerOptions) {
  const hookExecution = new AsyncLocalStorage<number>();
  let activeRuns = 0;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const catchErrors = opts.catchErrors ?? true;

  /** Skip when no hooks or already inside a hook (reentrancy guard). */
  function canRun(name: HookName): boolean {
    const depth = hookExecution.getStore() ?? 0;
    if (depth > 0) {
      opts.logger.debug(`Skipping ${name} hooks (reentrancy depth=${depth})`);
      return false;
    }
    return registry.hasHooks(name);
  }

  /** Run one hook with timeout; absorb or rethrow per catchErrors. */
  async function runOne<K extends HookName>(
    hook: ReturnType<HookRegistry["getHooks"]>[number],
    name: K,
    event: Parameters<HookHandlerMap[K]>[0]
  ): Promise<void> {
    const label = `${hook.pluginId}:${name}`;
    const t0 = Date.now();
    try {
      await withTimeout(
        () => (hook.handler as (e: typeof event) => void | Promise<void>)(event),
        timeoutMs,
        label
      );
    } catch (error) {
      if (!catchErrors) throw error;
      const message = getErrorMessage(error);
      opts.logger.error(`Hook error [${label}]: ${message} (after ${Date.now() - t0}ms)`);
      if (BLOCKABLE_HOOKS.has(name)) {
        const blockable = event as { block?: boolean; blockReason?: string };
        blockable.block = true;
        blockable.blockReason = `Hook enforcement failed [${label}]: ${message}`;
      }
    }
  }

  // Modifying hooks run sequentially (priority order) and can short-circuit via block=true.
  async function runModifyingHook<K extends HookName>(
    name: K,
    event: Parameters<HookHandlerMap[K]>[0]
  ): Promise<void> {
    if (!canRun(name)) return;
    const hooks = registry.getHooks(name); // pre-sorted by effectivePriority in registry
    activeRuns++;
    try {
      await hookExecution.run(1, async () => {
        for (const hook of hooks) {
          await runOne(hook, name, event);
          if (BLOCKABLE_HOOKS.has(name) && (event as { block?: boolean }).block) break;
        }
      });
    } finally {
      activeRuns--;
    }
  }

  // Observing hooks run in parallel (no order guarantees).
  async function runObservingHook<K extends HookName>(
    name: K,
    event: Parameters<HookHandlerMap[K]>[0]
  ): Promise<void> {
    if (!canRun(name)) return;
    const hooks = registry.getHooks(name);
    activeRuns++;
    try {
      const results = await hookExecution.run(1, () =>
        Promise.allSettled(hooks.map((hook) => runOne(hook, name, event)))
      );
      // When catchErrors=false, re-throw the first rejection that allSettled absorbed
      if (!catchErrors) {
        const firstRejected = results.find((r) => r.status === "rejected") as
          | PromiseRejectedResult
          | undefined;
        if (firstRejected) throw firstRejected.reason;
      }
    } finally {
      activeRuns--;
    }
  }

  return {
    runModifyingHook,
    runObservingHook,
    get depth() {
      return hookExecution.getStore() ?? activeRuns;
    },
  };
}
