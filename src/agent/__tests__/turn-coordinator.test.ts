import { describe, expect, it, vi } from "vitest";
import { TurnCoordinator } from "../turn-coordinator.js";

describe("TurnCoordinator", () => {
  it("checks absolute expiry even before delayed timer callbacks run", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new TurnCoordinator({
        maxConcurrent: 1,
        maxPending: 2,
        maxQueueWaitMs: 10,
      });
      let release!: () => void;
      const first = coordinator.run(
        "one",
        () =>
          new Promise<void>((yes) => {
            release = yes;
          })
      );
      const task = vi.fn(async () => {});
      const second = coordinator.run("two", task);
      const rejected = expect(second).rejects.toThrow(/expired/);
      vi.setSystemTime(Date.now() + 20);
      release();
      await first;
      await rejected;
      expect(task).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("expires a same-session waiter immediately without freeing its predecessor", async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new TurnCoordinator({
        maxConcurrent: 1,
        maxPending: 2,
        maxQueueWaitMs: 100,
      });
      let release!: () => void;
      const active = coordinator.run(
        "chat",
        () =>
          new Promise<void>((yes) => {
            release = yes;
          })
      );
      const callback = vi.fn(async () => "must not execute");
      const expired = coordinator.run("chat", callback);
      const observed = expect(expired).rejects.toThrow(/expired/);
      await vi.advanceTimersByTimeAsync(101);
      await observed;
      expect(coordinator.stats.pending).toBe(1);
      expect(coordinator.stats.active).toBe(1);
      expect(callback).not.toHaveBeenCalled();
      release();
      await active;
      expect(coordinator.stats).toEqual({ active: 0, pending: 0, sessions: 0 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("serializes turns for the same session without cancelling either turn", async () => {
    const coordinator = new TurnCoordinator({ maxConcurrent: 4, maxPending: 10 });
    const order: string[] = [];
    let release!: () => void;

    const first = coordinator.run("session", async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => (release = resolve));
      order.push("first:end");
      return 1;
    });
    const second = coordinator.run("session", async () => {
      order.push("second:start");
      return 2;
    });

    await expect.poll(() => order).toEqual(["first:start"]);
    expect(order).toEqual(["first:start"]);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("limits global concurrency across independent sessions", async () => {
    const coordinator = new TurnCoordinator({ maxConcurrent: 2, maxPending: 10 });
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    };

    await Promise.all(["a", "b", "c", "d"].map((key) => coordinator.run(key, task)));
    expect(maxActive).toBe(2);
  });

  it("rejects excess work instead of growing an unbounded queue", async () => {
    const coordinator = new TurnCoordinator({ maxConcurrent: 1, maxPending: 1 });
    let release!: () => void;
    const first = coordinator.run("a", () => new Promise<void>((resolve) => (release = resolve)));

    await expect(coordinator.run("b", async () => {})).rejects.toThrow(/capacity/i);
    release();
    await first;
  });
});
