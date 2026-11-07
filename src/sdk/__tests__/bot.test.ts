import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBotSDK } from "../bot.js";
import type { InlineRouter, PluginBotHandlers } from "../../bot/inline-router.js";
import type { PluginRateLimiter } from "../../bot/rate-limiter.js";
import type { PluginLogger, BotManifest } from "@teleton-agent/sdk";
import type { GramJSBotClient } from "../../bot/gramjs-bot.js";
import type { Bot } from "grammy";

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

  function transports() {
    const mtprotoEdit = vi.fn().mockResolvedValue(undefined);
    const apiEdit = vi.fn().mockResolvedValue(undefined);
    return {
      mtprotoEdit,
      apiEdit,
      gramjs: {
        isConnected: () => true,
        editInlineMessageByStringId: mtprotoEdit,
      } as unknown as GramJSBotClient,
      grammy: { api: { editMessageTextInline: apiEdit } } as unknown as Bot,
    };
  }

  it("rejects registrations outside the declared bot capabilities", () => {
    const callbacksOnly = createBotSDK(router, null, null, "cats", { callbacks: true }, null, log)!;
    expect(() => callbacksOnly.onInlineQuery(async () => [])).toThrow(/not declared/);
    expect(() => callbacksOnly.onChosenResult(async () => {})).toThrow(/not declared/);
    const inlineOnly = createBotSDK(router, null, null, "cats", { inline: true }, null, log)!;
    expect(() => inlineOnly.onCallback("*", async () => {})).toThrow(/not declared/);
    expect(router.registerPlugin).not.toHaveBeenCalled();
  });

  it("edits HTML via GramJS even without a keyboard", async () => {
    const t = transports();
    const sdk = createBotSDK(router, t.gramjs, t.grammy, "cats", manifest, null, log)!;
    await sdk.editInlineMessage("inline-id", "<b>Hello</b>");
    expect(t.mtprotoEdit).toHaveBeenCalledWith(
      expect.objectContaining({ inlineMessageId: "inline-id", text: "Hello" })
    );
    expect(t.apiEdit).not.toHaveBeenCalled();
  });

  it("honors Markdown parse mode and URL keyboards through the Bot API", async () => {
    const t = transports();
    const sdk = createBotSDK(router, t.gramjs, t.grammy, "cats", manifest, null, log)!;
    await sdk.editInlineMessage("inline-id", "*Hello*", {
      parseMode: "MarkdownV2",
      keyboard: [[{ text: "Open", url: "https://example.com" }]],
    });
    expect(t.mtprotoEdit).not.toHaveBeenCalled();
    expect(t.apiEdit).toHaveBeenCalledWith(
      "inline-id",
      "*Hello*",
      expect.objectContaining({ parse_mode: "MarkdownV2" })
    );
    expect(t.apiEdit.mock.calls[0][2].reply_markup.inline_keyboard).toEqual([
      [{ text: "Open", url: "https://example.com" }],
    ]);
  });

  it("rejects failed edits and edits without an available transport", async () => {
    const t = transports();
    t.mtprotoEdit.mockRejectedValue(new Error("MTProto failure"));
    t.apiEdit.mockRejectedValue({ description: "Bot API failure" });
    const sdk = createBotSDK(router, t.gramjs, t.grammy, "cats", manifest, null, log)!;
    await expect(sdk.editInlineMessage("id", "text")).rejects.toMatchObject({
      code: "OPERATION_FAILED",
    });
    const missing = createBotSDK(router, null, null, "cats", manifest, null, log)!;
    await expect(missing.editInlineMessage("id", "text")).rejects.toMatchObject({
      code: "NOT_AVAILABLE",
    });
    const noFallback = createBotSDK(router, t.gramjs, null, "cats", manifest, null, log)!;
    await expect(noFallback.editInlineMessage("id", "text")).rejects.toMatchObject({
      code: "OPERATION_FAILED",
    });
  });

  it("keeps an unchanged Bot API edit idempotent", async () => {
    const t = transports();
    t.apiEdit.mockRejectedValue({ description: "Bad Request: message is not modified" });
    const sdk = createBotSDK(router, null, t.grammy, "cats", manifest, null, log)!;
    await expect(sdk.editInlineMessage("id", "text")).resolves.toBeUndefined();
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
