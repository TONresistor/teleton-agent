import { describe, expect, it } from "vitest";
import { MessageDebouncer } from "../debounce.js";
import type { TelegramMessage } from "../bridge-interface.js";
function message(id: number): TelegramMessage {
  return {
    id,
    chatId: "1",
    senderId: 1,
    text: String(id),
    isGroup: true,
    isChannel: false,
    isBot: false,
    mentionsMe: true,
    timestamp: new Date(0),
    hasMedia: false,
  };
}
describe("debounce ingress", () => {
  it("keeps arrivals made while a full buffer flush waits", async () => {
    let release!: () => void;
    const seen: number[][] = [];
    const debouncer = new MessageDebouncer(
      { debounceMs: 10000, maxBufferSize: 1 },
      () => true,
      async (messages) => {
        seen.push(messages.map((item) => item.id));
        if (messages[0].id === 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      }
    );
    await debouncer.enqueue(message(1));
    const flushing = debouncer.enqueue(message(2));
    await Promise.resolve();
    await debouncer.enqueue(message(3));
    release();
    await flushing;
    await debouncer.flushAll();
    expect(seen.flat().sort()).toEqual([1, 2, 3]);
  });
});
