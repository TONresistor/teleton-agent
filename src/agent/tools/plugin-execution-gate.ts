/**
 * Coordinates every execution surface owned by an external plugin.
 *
 * Reloads first block new work, then wait for already-started work to finish
 * before the plugin database and background runtime are stopped.
 */
export class PluginExecutionGate {
  private readonly blockers = new Map<string, number>();
  private readonly active = new Map<string, number>();
  private readonly drainWaiters = new Map<string, Set<() => void>>();

  enter(pluginId: string): (() => void) | null {
    if ((this.blockers.get(pluginId) ?? 0) > 0) return null;

    this.active.set(pluginId, (this.active.get(pluginId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;

      const remaining = (this.active.get(pluginId) ?? 1) - 1;
      if (remaining > 0) {
        this.active.set(pluginId, remaining);
        return;
      }

      this.active.delete(pluginId);
      const waiters = this.drainWaiters.get(pluginId);
      this.drainWaiters.delete(pluginId);
      for (const resolve of waiters ?? []) resolve();
    };
  }

  async quiesce(pluginIds: readonly string[]): Promise<void> {
    const uniqueIds = [...new Set(pluginIds)];
    for (const pluginId of uniqueIds) {
      this.blockers.set(pluginId, (this.blockers.get(pluginId) ?? 0) + 1);
    }
    await Promise.all(uniqueIds.map((pluginId) => this.waitForDrain(pluginId)));
  }

  resume(pluginIds: readonly string[]): void {
    for (const pluginId of new Set(pluginIds)) {
      const remaining = (this.blockers.get(pluginId) ?? 0) - 1;
      if (remaining > 0) this.blockers.set(pluginId, remaining);
      else this.blockers.delete(pluginId);
    }
  }

  isQuiesced(pluginId: string): boolean {
    return (this.blockers.get(pluginId) ?? 0) > 0;
  }

  getActiveCount(pluginId: string): number {
    return this.active.get(pluginId) ?? 0;
  }

  private waitForDrain(pluginId: string): Promise<void> {
    if ((this.active.get(pluginId) ?? 0) === 0) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let waiters = this.drainWaiters.get(pluginId);
      if (!waiters) {
        waiters = new Set();
        this.drainWaiters.set(pluginId, waiters);
      }
      waiters.add(resolve);
    });
  }
}
