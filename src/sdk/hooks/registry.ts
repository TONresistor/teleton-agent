import type { HookName, HookRegistration } from "./types.js";

/** Maximum hook registrations per plugin (13 hooks × ~7 handlers ≈ 91, so 100 is generous) */
export const MAX_HOOKS_PER_PLUGIN = 100;

export class HookRegistry {
  private hooks: HookRegistration[] = [];
  private hookMap = new Map<HookName, HookRegistration[]>();

  private rebuildMap(): void {
    this.hookMap.clear();
    for (const h of this.hooks) {
      let arr = this.hookMap.get(h.hookName);
      if (!arr) {
        arr = [];
        this.hookMap.set(h.hookName, arr);
      }
      arr.push(h);
    }
    for (const arr of this.hookMap.values()) {
      arr.sort((a, b) => {
        const aPrio = a.globalPriority + a.priority;
        const bPrio = b.globalPriority + b.priority;
        return aPrio - bPrio; // stable sort preserves registration order for ties
      });
    }
  }

  register<K extends HookName>(
    reg: Omit<HookRegistration<K>, "globalPriority"> & { globalPriority?: number }
  ): boolean {
    const pluginHookCount = this.hooks.filter((h) => h.pluginId === reg.pluginId).length;
    if (pluginHookCount >= MAX_HOOKS_PER_PLUGIN) {
      return false;
    }
    this.hooks.push({ ...reg, globalPriority: reg.globalPriority ?? 0 } as HookRegistration);
    this.rebuildMap();
    return true;
  }

  getHooks<K extends HookName>(name: K): HookRegistration<K>[] {
    return (this.hookMap.get(name) as HookRegistration<K>[] | undefined) ?? [];
  }

  hasHooks(name: HookName): boolean {
    return (this.hookMap.get(name)?.length ?? 0) > 0;
  }

  hasAnyHooks(): boolean {
    return this.hooks.length > 0;
  }

  unregister(pluginId: string): number {
    const before = this.hooks.length;
    this.hooks = this.hooks.filter((h) => h.pluginId !== pluginId);
    this.rebuildMap();
    return before - this.hooks.length;
  }

  getRegistrations(pluginId?: string): HookRegistration[] {
    const registrations = pluginId
      ? this.hooks.filter((hook) => hook.pluginId === pluginId)
      : this.hooks;
    return registrations.map((registration) => ({ ...registration }));
  }

  replacePlugin(pluginId: string, registrations: HookRegistration[]): void {
    this.unregister(pluginId);
    for (const registration of registrations) {
      this.register({ ...registration, pluginId });
    }
  }

  clear(): void {
    this.hooks = [];
    this.hookMap.clear();
  }
}
