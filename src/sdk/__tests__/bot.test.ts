import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBotSDK } from "../bot.js";
import type { InlineRouter, PluginBotHandlers } from "../../bot/inline-router.js";
import type { PluginRateLimiter } from "../../bot/rate-limiter.js";
import type { PluginLogger, BotManifest } from "@teleton-agent/sdk";

function createMockRouter(): InlineRouter & { _plugins: Map<string, PluginBotHandlers> } {
  const plugins = new Map<string, PluginBotHandlers>();
  return {
    _plugins: plugins,
    registerPlugin: vi.fn((name: string, handlers: PluginBotHandlers) => {
      plugins.set(name, handlers);
    }),
    unregisterPlugin: vi.fn((name: string) => {
      plugins.delete(name);
    }),
    hasPlugin: (name: string) => plugins.has(name),
    middleware: vi.fn(() => async () => {}),
  } as any;
}

function createMockLog(): PluginLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe("createBotSDK", () => {
  let router: ReturnType<typeof createMockRouter>;
  let log: PluginLogger;
  const manifest: BotManifest = { inline: true, callbacks: true };

  beforeEach(() => {
    router = createMockRouter();
    log = createMockLog();
  });

  it("returns null when router is null", () => {
    const sdk = createBotSDK(null, null, null, "cats", manifest, null, log);
    expect(sdk).toBeNull();
  });

  it("returns null when manifest is undefined", () => {
    const sdk = createBotSDK(router, null, null, "cats", undefined, null, log);
    expect(sdk).toBeNull();
  });

  it("returns null when manifest has neither inline nor callbacks", () => {
    const sdk = createBotSDK(router, null, null, "cats", {}, null, log);
    expect(sdk).toBeNull();
  });

  it("returns frozen BotSDK when manifest has inline", () => {
    const sdk = createBotSDK(router, null, null, "cats", { inline: true }, null, log);
    expect(sdk).not.toBeNull();
    expect(sdk!.isAvailable).toBe(true);
    expect(Object.isFrozen(sdk)).toBe(true);
  });

  it("registers inline query handler with router", () => {
    const sdk = createBotSDK(router, null, null, "cats", manifest, null, log)!;
    const handler = vi.fn(async () => []);
    sdk.onInlineQuery(handler);

    expect(router.registerPlugin).toHaveBeenCalledWith("cats", expect.any(Object));
    expect(router._plugins.get("cats")!.onInlineQuery).toBeDefined();
  });

  it("registers callback handler with router", () => {
    const sdk = createBotSDK(router, null, null, "cats", manifest, null, log)!;
    sdk.onCallback(
      "like:*",
      vi.fn(async () => {})
    );

    const handlers = router._plugins.get("cats")!;
    expect(handlers.onCallback).toHaveLength(1);
    expect(handlers.onCallback![0].pattern).toBe("like:*");
  });

  it("accumulates multiple callback handlers", () => {
    const sdk = createBotSDK(router, null, null, "cats", manifest, null, log)!;
    sdk.onCallback(
      "like:*",
      vi.fn(async () => {})
    );
    sdk.onCallback(
      "dislike:*",
      vi.fn(async () => {})
    );

    const handlers = router._plugins.get("cats")!;
    expect(handlers.onCallback).toHaveLength(2);
  });

  it("preserves inline handler when adding callback", () => {
    const sdk = createBotSDK(router, null, null, "cats", manifest, null, log)!;
    const inlineHandler = vi.fn(async () => []);
    sdk.onInlineQuery(inlineHandler);
    sdk.onCallback(
      "like:*",
      vi.fn(async () => {})
    );

    const handlers = router._plugins.get("cats")!;
    expect(handlers.onInlineQuery).toBeDefined();
    expect(handlers.onCallback).toHaveLength(1);
  });

  it("auto-prefixes keyboard callbacks", () => {
    const sdk = createBotSDK(router, null, null, "cats", manifest, null, log)!;
    const kb = sdk.keyboard([
      [
        { text: "Like", callback: "like:42" },
        { text: "Share", copy: "https://example.com" },
      ],
    ]);

    // Rows should have prefixed callbacks
    expect(kb.rows[0][0].callback).toBe("cats:like:42");
    // Copy buttons should keep callback undefined
    expect(kb.rows[0][1].copy).toBe("https://example.com");
    // Keyboard methods should exist
    expect(typeof kb.toGrammy).toBe("function");
    expect(typeof kb.toTL).toBe("function");
  });

  it("checks rate limit on inline handler", async () => {
    const limiter = { check: vi.fn(), clear: vi.fn() } as unknown as PluginRateLimiter;
    const sdk = createBotSDK(router, null, null, "cats", manifest, limiter, log)!;

    const handler = vi.fn(async () => []);
    sdk.onInlineQuery(handler);

    const registeredHandler = router._plugins.get("cats")!.onInlineQuery!;
    await registeredHandler({ query: "test", queryId: "q1", userId: 1, offset: "" });

    expect(limiter.check).toHaveBeenCalledWith("cats", "inline", 30);
    expect(handler).toHaveBeenCalled();
  });

  it("checks rate limit on callback handler", async () => {
    const limiter = { check: vi.fn(), clear: vi.fn() } as unknown as PluginRateLimiter;
    const sdk = createBotSDK(router, null, null, "cats", manifest, limiter, log)!;

    const handler = vi.fn(async () => {});
    sdk.onCallback("like:*", handler);

    const registeredCallback = router._plugins.get("cats")!.onCallback![0].handler;
    await registeredCallback({
      data: "like:42",
      match: ["42"],
      userId: 1,
      answer: vi.fn(),
      editMessage: vi.fn(),
    });

    expect(limiter.check).toHaveBeenCalledWith("cats", "callback", 60);
  });

  it("uses custom rate limits from manifest", async () => {
    const limiter = { check: vi.fn(), clear: vi.fn() } as unknown as PluginRateLimiter;
    const customManifest: BotManifest = {
      inline: true,
      callbacks: true,
      rateLimits: { inlinePerMinute: 10, callbackPerMinute: 20 },
    };
    const sdk = createBotSDK(router, null, null, "cats", customManifest, limiter, log)!;

    sdk.onInlineQuery(vi.fn(async () => []));
    const registeredHandler = router._plugins.get("cats")!.onInlineQuery!;
    await registeredHandler({ query: "test", queryId: "q1", userId: 1, offset: "" });

    expect(limiter.check).toHaveBeenCalledWith("cats", "inline", 10);
  });

  it("username returns empty when bot is null", () => {
    const sdk = createBotSDK(router, null, null, "cats", manifest, null, log)!;
    expect(sdk.username).toBe("");
  });
});
