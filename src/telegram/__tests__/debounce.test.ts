import { describe, expect, it, vi } from "vitest";
import { MessageDebouncer } from "../debounce.js";
import type { TelegramMessage } from "../bridge.js";

function message(overrides: Partial<TelegramMessage>): TelegramMessage {
  return {
    id: 1,
    chatId: "123",
    senderId: 456,
    text: "hello",
    isGroup: false,
    isChannel: false,
    isBot: false,
    mentionsMe: false,
    timestamp: new Date(),
    hasMedia: false,
    ...overrides,
  };
}

describe("MessageDebouncer", () => {
  it("merges rapid direct messages into a single flush", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const debouncer = new MessageDebouncer(
      { debounceMs: 1500, dmDebounceMs: 200 },
      () => true,
      onFlush
    );

    await debouncer.enqueue(message({ id: 1, text: "first" }));
    await debouncer.enqueue(message({ id: 2, text: "second" }));
    await debouncer.flushAll();

    expect(onFlush).toHaveBeenCalledTimes(1);
    const batch = onFlush.mock.calls[0][0] as TelegramMessage[];
    expect(batch.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("uses the dm window when it differs from the group window", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const debouncer = new MessageDebouncer(
      { debounceMs: 5000, dmDebounceMs: 50 },
      () => true,
      onFlush
    );

    const startedAt = Date.now();
    await debouncer.enqueue(message({ id: 1 }));
    await vi.waitFor(() => expect(onFlush).toHaveBeenCalledOnce(), { timeout: 2000 });
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});
