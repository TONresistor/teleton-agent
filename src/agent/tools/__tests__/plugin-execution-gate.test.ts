import { describe, expect, it } from "vitest";
import { PluginExecutionGate, PluginUnavailableError } from "../plugin-execution-gate.js";

describe("plugin execution generation gate", () => {
  it("keeps the actual operation leased after caller timeout and blocks admission while draining", async () => {
    const gate = new PluginExecutionGate();
    gate.activate();
    let release!: () => void;
    const active = gate.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await Promise.race([active, Promise.resolve("local timeout")]);
    let drained = false;
    const drain = gate.pauseAndDrain().then(() => {
      drained = true;
    });
    expect(gate.inFlight).toBe(1);
    await expect(gate.run(() => "new call")).rejects.toBeInstanceOf(PluginUnavailableError);
    expect(drained).toBe(false);
    release();
    await active;
    await drain;
    expect(drained).toBe(true);
    expect(gate.inFlight).toBe(0);
  });
});
