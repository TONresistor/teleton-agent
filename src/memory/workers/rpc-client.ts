import type { Worker } from "node:worker_threads";
import type { RpcRequest, RpcResponse } from "./protocol.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class WorkerRpcClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private closing = false;

  constructor(
    private readonly label: string,
    private readonly createWorker: () => Worker,
    private readonly hardTimeoutMs: number
  ) {}

  async request<TResult>(payload: { type: string }): Promise<TResult> {
    if (this.closing) throw new Error(`${this.label} worker is shutting down`);
    const worker = this.ensureWorker();
    const id = this.nextId++;

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} worker timed out after ${this.hardTimeoutMs}ms`));
        void this.resetWorker(new Error(`${this.label} worker watchdog expired`), worker);
      }, this.hardTimeoutMs);
      timer.unref();

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        worker.postMessage({ id, type: payload.type, payload } satisfies RpcRequest);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
        void this.resetWorker(new Error(`${this.label} worker message delivery failed`), worker);
      }
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.resetWorker(new Error(`${this.label} worker closed`));
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.on("message", (message: RpcResponse) => this.handleMessage(message));
    worker.on("error", (error) => void this.resetWorker(error, worker));
    worker.on("exit", (code) => {
      if (!this.closing && this.worker === worker) {
        void this.resetWorker(new Error(`${this.label} worker exited with code ${code}`), worker);
      }
    });
    this.worker = worker;
    return worker;
  }

  private handleMessage(message: RpcResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error));
  }

  private async resetWorker(reason: Error, expectedWorker?: Worker): Promise<void> {
    if (expectedWorker && this.worker !== expectedWorker) return;
    const worker = this.worker;
    this.worker = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
    if (worker) await worker.terminate();
  }
}
