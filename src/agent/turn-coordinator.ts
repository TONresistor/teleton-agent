export interface TurnCoordinatorOptions {
  maxConcurrent: number;
  maxPending: number;
  maxQueueWaitMs?: number;
}

interface SlotWaiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  cancelled: boolean;
}

/**
 * Single entry point for every agent turn. It serializes conversation state by
 * session while applying a bounded global bulkhead. New messages wait; they do
 * not cancel an active generation.
 */
export class TurnCoordinator {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly slotWaiters: SlotWaiter[] = [];
  private active = 0;
  private pending = 0;
  private readonly maxQueueWaitMs: number;

  constructor(private readonly options: TurnCoordinatorOptions) {
    this.maxQueueWaitMs = options.maxQueueWaitMs ?? 60_000;
  }

  run<T>(sessionKey: string, task: () => Promise<T>): Promise<T> {
    if (this.pending >= this.options.maxPending) {
      return Promise.reject(new Error("Agent turn capacity reached; try again shortly"));
    }

    this.pending++;
    const enqueuedAt = Date.now();
    const previous = this.chains.get(sessionKey) ?? Promise.resolve();
    const execution = previous
      .catch(() => undefined)
      .then(async () => {
        if (Date.now() - enqueuedAt >= this.maxQueueWaitMs) {
          throw new Error("Agent turn expired while waiting in queue");
        }
        const release = await this.acquireSlot(enqueuedAt);
        try {
          return await task();
        } finally {
          release();
        }
      })
      .finally(() => {
        this.pending--;
        if (this.chains.get(sessionKey) === execution) this.chains.delete(sessionKey);
      });

    this.chains.set(sessionKey, execution);
    return execution;
  }

  get stats(): { active: number; pending: number; sessions: number } {
    return { active: this.active, pending: this.pending, sessions: this.chains.size };
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
  }

  private acquireSlot(enqueuedAt: number): Promise<() => void> {
    if (this.active < this.options.maxConcurrent) {
      this.active++;
      return Promise.resolve(() => this.releaseSlot());
    }

    const remaining = Math.max(1, this.maxQueueWaitMs - (Date.now() - enqueuedAt));
    return new Promise<() => void>((resolve, reject) => {
      const waiter: SlotWaiter = {
        resolve,
        reject,
        cancelled: false,
      };
      waiter.timer = setTimeout(() => {
        waiter.cancelled = true;
        reject(new Error("Agent turn expired while waiting for capacity"));
      }, remaining);
      waiter.timer.unref?.();
      this.slotWaiters.push(waiter);
    });
  }

  private releaseSlot(): void {
    this.active--;
    while (this.slotWaiters.length > 0) {
      const waiter = this.slotWaiters.shift();
      if (!waiter || waiter.cancelled) continue;
      if (waiter.timer) clearTimeout(waiter.timer);
      this.active++;
      waiter.resolve(() => this.releaseSlot());
      break;
    }
  }
}
