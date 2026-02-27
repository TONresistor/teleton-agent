import { EventEmitter } from "node:events";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Lifecycle");

export type AgentState = "stopped" | "starting" | "running" | "stopping";

export interface StateChangeEvent {
  state: AgentState;
  error?: string;
  timestamp: number;
}

export class AgentLifecycle extends EventEmitter {
  private state: AgentState = "stopped";
  private error: string | undefined;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private runningSince: number | null = null;
  private registeredStartFn: (() => Promise<void>) | null = null;
  private registeredStopFn: (() => Promise<void>) | null = null;

  getState(): AgentState {
    return this.state;
  }

  getError(): string | undefined {
    return this.error;
  }

  getUptime(): number | null {
    if (this.state !== "running" || this.runningSince === null) {
      return null;
    }
    return Math.floor((Date.now() - this.runningSince) / 1000);
  }

  /**
   * Register the start/stop callbacks so start()/stop() can be called without args.
   */
  registerCallbacks(startFn: () => Promise<void>, stopFn: () => Promise<void>): void {
    this.registeredStartFn = startFn;
    this.registeredStopFn = stopFn;
  }

  /**
   * Start the agent. Uses the provided callback or falls back to registered one.
   * - No-op if already running
   * - Returns existing promise if already starting
   * - Throws if currently stopping
   */
  async start(startFn?: () => Promise<void>): Promise<void> {
    const fn = startFn ?? this.registeredStartFn;
    if (!fn) {
      throw new Error("No start function provided or registered");
    }

    if (this.state === "running") {
      return;
    }

    if (this.state === "starting") {
      return this.startPromise!;
    }

    if (this.state === "stopping") {
      throw new Error("Cannot start while agent is stopping");
    }

    this.transition("starting");

    this.startPromise = (async () => {
      try {
        await fn();
        this.error = undefined;
        this.runningSince = Date.now();
        this.transition("running");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.error = message;
        this.runningSince = null;
        this.transition("stopped", message);
        throw err;
      } finally {
        this.startPromise = null;
      }
    })();

    return this.startPromise;
  }

  /**
   * Stop the agent. Uses the provided callback or falls back to registered one.
   * - No-op if already stopped
   * - Returns existing promise if already stopping
   * - If starting, waits for start to complete then stops
   */
  async stop(stopFn?: () => Promise<void>): Promise<void> {
    const fn = stopFn ?? this.registeredStopFn;
    if (!fn) {
      throw new Error("No stop function provided or registered");
    }

    if (this.state === "stopped") {
      return;
    }

    if (this.state === "stopping") {
      return this.stopPromise!;
    }

    // If currently starting, wait for start to finish first
    if (this.state === "starting" && this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // Start failed — agent is already stopped
        return;
      }
    }

    this.transition("stopping");

    this.stopPromise = (async () => {
      try {
        await fn();
      } catch (err) {
        log.error({ err }, "Error during agent stop");
      } finally {
        this.runningSince = null;
        this.transition("stopped");
        this.stopPromise = null;
      }
    })();

    return this.stopPromise;
  }

  private transition(newState: AgentState, error?: string): void {
    this.state = newState;
    const event: StateChangeEvent = {
      state: newState,
      timestamp: Date.now(),
    };
    if (error !== undefined) {
      event.error = error;
    }
    log.info(`Agent state: ${newState}${error ? ` (${error})` : ""}`);
    this.emit("stateChange", event);
  }
}
