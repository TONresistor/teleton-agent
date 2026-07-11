import { describe, it, expect, vi, beforeEach } from "vitest";
import { InlineRouter, compileGlob } from "../inline-router.js";

// Minimal Grammy context mock
function createInlineQueryCtx(query: string, userId = 123) {
  const answered = { called: false, results: [] as any[], opts: {} as any };
  return {
    inlineQuery: { query, id: "q123", offset: "", from: { id: userId } },
    from: { id: userId, username: "testuser" },
    callbackQuery: undefined,
    chosenInlineResult: undefined,
    chat: undefined,
    answerInlineQuery: vi.fn(async (results: any[], opts?: any) => {
      answered.called = true;
      answered.results = results;
      answered.opts = opts;
    }),
    _answered: answered,
  } as any;
}

function createCallbackCtx(data: string, userId = 123) {
  const answered = { called: false };
  return {
    inlineQuery: undefined,
    callbackQuery: {
      data,
      inline_message_id: "inline_msg_1",
      message: undefined,
      from: { id: userId, username: "testuser" },
    },
    chosenInlineResult: undefined,
    from: { id: userId, username: "testuser" },
    chat: undefined,
    answerCallbackQuery: vi.fn(async (opts?: any) => {
      answered.called = true;
    }),
    editMessageText: vi.fn(),
    _answered: answered,
  } as any;
}

function createChosenResultCtx(resultId: string, query = "test") {
  return {
    inlineQuery: undefined,
    callbackQuery: undefined,
    chosenInlineResult: {
      result_id: resultId,
      inline_message_id: "inline_msg_1",
      query,
    },
    from: { id: 123, username: "testuser" },
  } as any;
}

describe("InlineRouter", () => {
  let router: InlineRouter;

  beforeEach(() => {
    router = new InlineRouter();
  });

  describe("inline_query routing", () => {
    it("routes query with known prefix to plugin", async () => {
      const handler = vi.fn(async () => [
        {
          id: "1",
          type: "article" as const,
          title: "Test",
          content: { text: "hello" },
        },
      ]);
      router.registerPlugin("cats", { onInlineQuery: handler });

      const ctx = createInlineQueryCtx("cats:random");
      const next = vi.fn();
      await router.middleware()(ctx, next);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ query: "random", queryId: "q123" })
      );
      expect(ctx.answerInlineQuery).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it("falls through to next() when no prefix match", async () => {
      router.registerPlugin("cats", {
        onInlineQuery: vi.fn(async () => []),
      });

      const ctx = createInlineQueryCtx("item123"); // no colon, no prefix
      const next = vi.fn();
      await router.middleware()(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it("falls through for unknown prefix", async () => {
      router.registerPlugin("cats", {
        onInlineQuery: vi.fn(async () => []),
      });

      const ctx = createInlineQueryCtx("dogs:fetch");
      const next = vi.fn();
      await router.middleware()(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it("handles multiple plugins independently", async () => {
      const catsHandler = vi.fn(async () => [
        { id: "c1", type: "article" as const, title: "Cat", content: { text: "meow" } },
      ]);
      const dogsHandler = vi.fn(async () => [
        { id: "d1", type: "article" as const, title: "Dog", content: { text: "woof" } },
      ]);
      router.registerPlugin("cats", { onInlineQuery: catsHandler });
      router.registerPlugin("dogs", { onInlineQuery: dogsHandler });

      const ctx1 = createInlineQueryCtx("cats:meow");
      await router.middleware()(ctx1, vi.fn());
      expect(catsHandler).toHaveBeenCalled();
      expect(dogsHandler).not.toHaveBeenCalled();

      const ctx2 = createInlineQueryCtx("dogs:woof");
      await router.middleware()(ctx2, vi.fn());
      expect(dogsHandler).toHaveBeenCalled();
    });

    it("answers with empty results on handler error", async () => {
      router.registerPlugin("fail", {
        onInlineQuery: vi.fn(async () => {
          throw new Error("plugin crash");
        }),
      });

      const ctx = createInlineQueryCtx("fail:test");
      const next = vi.fn();
      await router.middleware()(ctx, next);

      // Should still answer (empty) to avoid Telegram timeout
      expect(ctx.answerInlineQuery).toHaveBeenCalledWith([], expect.any(Object));
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("callback_query routing", () => {
    it("dispatches the legacy callback observer and answers only once", async () => {
      const observer = vi.fn(async (event: any) => {
        await event.answer("observed");
      });
      const handler = vi.fn(async (ctx: any) => {
        await ctx.answer("plugin");
      });
      router.setCallbackObserver(observer);
      router.registerPlugin("cats", {
        onCallback: [{ pattern: "like:*", regex: compileGlob("like:*"), handler }],
      });

      const ctx = createCallbackCtx("cats:like:42");
      await router.middleware()(ctx, vi.fn());

      expect(observer).toHaveBeenCalledWith(
        expect.objectContaining({ data: "cats:like:42", action: "cats", params: ["like", "42"] })
      );
      expect(handler).toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    });

    it("routes callback with known prefix to plugin", async () => {
      const handler = vi.fn(async (ctx: any) => {
        await ctx.answer("liked!");
      });
      router.registerPlugin("cats", {
        onCallback: [{ pattern: "like:*", regex: compileGlob("like:*"), handler }],
      });

      const ctx = createCallbackCtx("cats:like:42");
      const next = vi.fn();
      await router.middleware()(ctx, next);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ data: "like:42", match: ["42"] })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("falls through for unknown prefix", async () => {
      router.registerPlugin("cats", {
        onCallback: [{ pattern: "like:*", regex: compileGlob("like:*"), handler: vi.fn() }],
      });

      const ctx = createCallbackCtx("quiz:accept:123");
      const next = vi.fn();
      await router.middleware()(ctx, next);

      expect(next).toHaveBeenCalled();
    });

    it("auto-answers callback if handler doesn't", async () => {
      router.registerPlugin("cats", {
        onCallback: [
          { pattern: "noop", regex: compileGlob("noop"), handler: vi.fn(async () => {}) },
        ],
      });

      const ctx = createCallbackCtx("cats:noop");
      await router.middleware()(ctx, vi.fn());

      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });

    it("matches glob patterns correctly", async () => {
      const handler = vi.fn(async () => {});
      router.registerPlugin("quiz", {
        onCallback: [{ pattern: "vote:*:confirm", regex: compileGlob("vote:*:confirm"), handler }],
      });

      const ctx = createCallbackCtx("quiz:vote:42:confirm");
      await router.middleware()(ctx, vi.fn());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ data: "vote:42:confirm", match: ["42"] })
      );
    });

    it("answers with empty when no pattern matches", async () => {
      router.registerPlugin("cats", {
        onCallback: [{ pattern: "like:*", regex: compileGlob("like:*"), handler: vi.fn() }],
      });

      const ctx = createCallbackCtx("cats:dislike:42");
      await router.middleware()(ctx, vi.fn());

      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    });
  });

  describe("chosen_inline_result routing", () => {
    it("routes chosen result with prefix to plugin", async () => {
      const handler = vi.fn(async () => {});
      router.registerPlugin("cats", { onChosenResult: handler });

      const ctx = createChosenResultCtx("cats:42");
      const next = vi.fn();
      await router.middleware()(ctx, next);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ resultId: "42", inlineMessageId: "inline_msg_1" })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("falls through for unprefixed result ID", async () => {
      router.registerPlugin("cats", { onChosenResult: vi.fn() });

      const ctx = createChosenResultCtx("dealid123"); // no colon
      const next = vi.fn();
      await router.middleware()(ctx, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("error isolation", () => {
    it("plugin crash doesn't affect DealBot", async () => {
      router.registerPlugin("buggy", {
        onInlineQuery: vi.fn(async () => {
          throw new Error("segfault");
        }),
      });

      const ctx = createInlineQueryCtx("buggy:crash");
      const next = vi.fn();

      // Should not throw
      await router.middleware()(ctx, next);
      // Should answer empty
      expect(ctx.answerInlineQuery).toHaveBeenCalledWith([], expect.any(Object));
    });
  });

  describe("plugin management", () => {
    it("unregisters plugins", () => {
      router.registerPlugin("cats", { onInlineQuery: vi.fn(async () => []) });
      expect(router.hasPlugin("cats")).toBe(true);
      router.unregisterPlugin("cats");
      expect(router.hasPlugin("cats")).toBe(false);
    });

    it("clears stale plugin handlers before a runtime reload", () => {
      router.registerPlugin("cats", { onInlineQuery: vi.fn(async () => []) });

      router.clearPlugins();

      expect(router.hasPlugin("cats")).toBe(false);
    });
  });
});
