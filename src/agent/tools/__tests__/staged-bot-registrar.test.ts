import { describe, expect, it, vi } from "vitest";
import { InlineRouter } from "../../../bot/inline-router.js";
import { StagedBotRegistrar } from "../staged-bot-registrar.js";

describe("StagedBotRegistrar", () => {
  it("keeps candidate handlers offline until activation", () => {
    const live = new InlineRouter();
    const oldHandler = vi.fn(async () => []);
    const candidateHandler = vi.fn(async () => []);
    live.registerPlugin("plugin-a", { onInlineQuery: oldHandler });

    const staged = new StagedBotRegistrar();
    staged.registerPlugin("plugin-a", { onInlineQuery: candidateHandler });

    expect(live.getPluginHandlers("plugin-a")?.onInlineQuery).toBe(oldHandler);

    staged.activate(live, "plugin-a", "plugin-a");
    expect(live.getPluginHandlers("plugin-a")?.onInlineQuery).toBe(candidateHandler);
  });

  it("forwards later registrations only while the candidate is active", () => {
    const live = new InlineRouter();
    const staged = new StagedBotRegistrar();
    const firstHandler = vi.fn(async () => []);
    const secondHandler = vi.fn(async () => []);
    const detachedHandler = vi.fn(async () => []);

    staged.registerPlugin("plugin-a", { onInlineQuery: firstHandler });
    staged.activate(live, "plugin-a", "plugin-a");
    staged.registerPlugin("plugin-a", { onInlineQuery: secondHandler });
    expect(live.getPluginHandlers("plugin-a")?.onInlineQuery).toBe(secondHandler);

    staged.deactivate();
    staged.registerPlugin("plugin-a", { onInlineQuery: detachedHandler });
    expect(live.getPluginHandlers("plugin-a")?.onInlineQuery).toBe(secondHandler);
  });
});
