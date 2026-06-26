import type { HookRegistry } from "./registry.js";
import type { HookHandlerMap, HookName, HookRunnerOptions } from "./types.js";
import { getErrorMessage } from "../../utils/errors.js";

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
  let hookDepth = 0;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const catchErrors = opts.catchErrors ?? true;

  /** Skip when no hooks or already inside a hook (reentrancy guard). */
  function canRun(name: HookName): boolean {
    if (hookDepth > 0) {
      opts.logger.debug(`Skipping ${name} hooks (reentrancy depth=${hookDepth})`);
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
      opts.logger.error(
        `Hook error [${label}]: ${getErrorMessage(error)} (after ${Date.now() - t0}ms)`
      );
    }
  }

  // Modifying hooks run sequentially (priority order) and can short-circuit via block=true.
  async function runModifyingHook<K extends HookName>(
    name: K,
    event: Parameters<HookHandlerMap[K]>[0]
  ): Promise<void> {
    if (!canRun(name)) return;
    const hooks = registry.getHooks(name); // pre-sorted by effectivePriority in registry
    hookDepth++;
    try {
      for (const hook of hooks) {
        await runOne(hook, name, event);
        if (BLOCKABLE_HOOKS.has(name) && (event as { block?: boolean }).block) break;
      }
    } finally {
      hookDepth--;
    }
  }

  // Observing hooks run in parallel (no order guarantees).
  async function runObservingHook<K extends HookName>(
    name: K,
    event: Parameters<HookHandlerMap[K]>[0]
  ): Promise<void> {
    if (!canRun(name)) return;
    const hooks = registry.getHooks(name);
    hookDepth++;
    try {
      const results = await Promise.allSettled(hooks.map((hook) => runOne(hook, name, event)));
      // When catchErrors=false, re-throw the first rejection that allSettled absorbed
      if (!catchErrors) {
        const firstRejected = results.find((r) => r.status === "rejected") as
          | PromiseRejectedResult
          | undefined;
        if (firstRejected) throw firstRejected.reason;
      }
    } finally {
      hookDepth--;
    }
  }

  return {
    runModifyingHook,
    runObservingHook,
    get depth() {
      return hookDepth;
    },
  };
}
