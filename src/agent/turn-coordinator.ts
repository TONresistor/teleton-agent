import type { TurnAdmission } from "./execution-types.js";

export interface TurnCoordinatorOptions {
  maxConcurrent: number;
  maxPending: number;
  maxQueueWaitMs?: number;
}

interface QueuedTurn {
  deadline: number;
  signal?: AbortSignal;
  sessionKey: string;
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
  cleanup?: () => void;
}

/** Process-local admission with bounded, independently expiring session waiters. */
export class TurnCoordinator {
  private readonly queues = new Map<string, QueuedTurn[]>();
  private readonly activeSessions = new Set<string>();
  private readonly turns = new Set<Promise<unknown>>();
  private active = 0;
  private pending = 0;
  constructor(private readonly options: TurnCoordinatorOptions) {}

  run<T>(sessionKey: string, task: () => Promise<T>, admission?: TurnAdmission): Promise<T> {
    if (this.pending >= this.options.maxPending) {
      return Promise.reject(new Error("Agent turn capacity reached; try again shortly"));
    }
    const deadline =
      admission?.queueDeadline ?? Date.now() + (this.options.maxQueueWaitMs ?? 60_000);
    if (Date.now() >= deadline || admission?.signal?.aborted) {
      return Promise.reject(new Error("Agent turn expired while waiting in queue"));
    }
    this.pending++;
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
      resolve = yes as (value: unknown) => void;
      reject = no;
    });
    const entry: QueuedTurn = {
      sessionKey,
      task,
      resolve,
      reject,
      deadline,
      signal: admission?.signal,
    };
    const cancel = () => {
      const queue = this.queues.get(sessionKey);
      const index = queue?.indexOf(entry) ?? -1;
      if (!queue || index < 0) return;
      queue.splice(index, 1);
      if (!queue.length) this.queues.delete(sessionKey);
      this.pending--;
      entry.cleanup?.();
      reject(new Error("Agent turn expired while waiting in queue"));
      this.pump();
    };
    entry.timer = setTimeout(cancel, Math.max(1, deadline - Date.now()));
    entry.timer.unref?.();
    admission?.signal?.addEventListener("abort", cancel, { once: true });
    entry.cleanup = () => {
      clearTimeout(entry.timer);
      admission?.signal?.removeEventListener("abort", cancel);
    };
    const queue = this.queues.get(sessionKey) ?? [];
    queue.push(entry);
    this.queues.set(sessionKey, queue);
    this.turns.add(promise);
    void promise.then(
      () => this.turns.delete(promise),
      () => this.turns.delete(promise)
    );
    this.pump();
    return promise;
  }

  private pump(): void {
    for (const [sessionKey, queue] of this.queues) {
      if (this.active >= this.options.maxConcurrent) break;
      if (this.activeSessions.has(sessionKey)) continue;
      const entry = queue.shift();
      if (!queue.length) this.queues.delete(sessionKey);
      if (!entry) continue;
      entry.cleanup?.();
      if (Date.now() >= entry.deadline || entry.signal?.aborted) {
        this.pending--;
        entry.reject(new Error("Agent turn expired while waiting in queue"));
        // Continue pumping this session after removing an expired head.
        this.pump();
        continue;
      }
      this.active++;
      this.activeSessions.add(sessionKey);
      void this.execute(entry);
    }
  }

  private async execute(entry: QueuedTurn): Promise<void> {
    let value: unknown;
    let error: unknown;
    let failed = false;
    try {
      value = await entry.task();
    } catch (caught) {
      failed = true;
      error = caught;
    } finally {
      this.active--;
      this.pending--;
      this.activeSessions.delete(entry.sessionKey);
      this.pump();
    }
    if (failed) entry.reject(error);
    else entry.resolve(value);
  }

  get stats(): { active: number; pending: number; sessions: number } {
    return {
      active: this.active,
      pending: this.pending,
      sessions: new Set([...this.queues.keys(), ...this.activeSessions]).size,
    };
  }
  async drain(): Promise<void> {
    await Promise.allSettled([...this.turns]);
  }
}
