/** One gate per plugin generation, shared by tools, hooks and event callbacks. */
export class PluginUnavailableError extends Error {
  constructor() {
    super("Plugin is unavailable during initialization or maintenance");
    this.name = "PluginUnavailableError";
  }
}

export class PluginExecutionGate {
  private open = false;
  private active = 0;
  private waiters = new Set<() => void>();
  get accepting(): boolean {
    return this.open;
  }
  get inFlight(): number {
    return this.active;
  }
  activate(): void {
    this.open = true;
  }
  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    if (!this.open) throw new PluginUnavailableError();
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.active === 0) {
        for (const resolve of this.waiters) resolve();
        this.waiters.clear();
      }
    }
  }
  async pauseAndDrain(): Promise<void> {
    this.open = false;
    if (this.active === 0) return;
    await new Promise<void>((resolve) => this.waiters.add(resolve));
  }
}
