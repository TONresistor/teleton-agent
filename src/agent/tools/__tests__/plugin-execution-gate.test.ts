import { describe, expect, it, vi } from "vitest";
import { PluginExecutionGate } from "../plugin-execution-gate.js";

describe("PluginExecutionGate", () => {
  it("blocks new work and waits for in-flight work to drain", async () => {
    const gate = new PluginExecutionGate();
    const release = gate.enter("plugin-a");
    expect(release).not.toBeNull();

    const drained = vi.fn();
    const quiescing = gate.quiesce(["plugin-a"]).then(drained);
    await Promise.resolve();

    expect(gate.isQuiesced("plugin-a")).toBe(true);
    expect(gate.enter("plugin-a")).toBeNull();
    expect(drained).not.toHaveBeenCalled();

    release?.();
    await quiescing;

    expect(drained).toHaveBeenCalledOnce();
    expect(gate.getActiveCount("plugin-a")).toBe(0);
  });

  it("resumes work after activation or rollback", async () => {
    const gate = new PluginExecutionGate();
    await gate.quiesce(["plugin-a", "plugin-a"]);
    gate.resume(["plugin-a"]);

    const release = gate.enter("plugin-a");
    expect(release).toBeTypeOf("function");
    release?.();
  });

  it("makes execution leases idempotent", () => {
    const gate = new PluginExecutionGate();
    const release = gate.enter("plugin-a");

    release?.();
    release?.();

    expect(gate.getActiveCount("plugin-a")).toBe(0);
  });

  it("keeps overlapping reload blockers isolated", async () => {
    const gate = new PluginExecutionGate();
    await gate.quiesce(["plugin-a"]);
    await gate.quiesce(["plugin-a"]);

    gate.resume(["plugin-a"]);
    expect(gate.isQuiesced("plugin-a")).toBe(true);
    expect(gate.enter("plugin-a")).toBeNull();

    gate.resume(["plugin-a"]);
    expect(gate.isQuiesced("plugin-a")).toBe(false);
  });
});
