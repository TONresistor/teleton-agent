import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../client.js", () => ({
  TelegramUserClient: class {
    getClient() {
      return { sendMessage: mocks.send };
    }
  },
}));
import { GramJSUserBridge } from "../bridges/user.js";
import { floodGate } from "../flood-retry.js";
function bridge() {
  return new GramJSUserBridge({
    apiId: 1,
    apiHash: "test",
    phone: "+10000000000",
    sessionPath: "/tmp/teleton-delivery-budget-test",
  });
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("user formatted delivery cancellation", () => {
  it("does not invoke the RPC after cancellation during the proactive cooldown", async () => {
    vi.useFakeTimers();
    floodGate.recordFlood("cancel-cooldown", 5);
    const controller = new AbortController();
    const sending = bridge().sendMessage({
      chatId: "cancel-cooldown",
      text: "hello",
      formattedText: { text: "hello", entities: [] },
      signal: controller.signal,
      deadline: Date.now() + 10000,
    });
    const rejected = expect(sending).rejects.toThrow(/cancelled/);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not wait or invoke the RPC when cooldown exceeds the remaining delivery budget", async () => {
    vi.useFakeTimers();
    floodGate.recordFlood("budget-cooldown", 5);
    await expect(
      bridge().sendMessage({
        chatId: "budget-cooldown",
        text: "hello",
        formattedText: { text: "hello", entities: [] },
        deadline: Date.now() + 100,
      })
    ).rejects.toThrow(/deadline/);
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not retry a rejected RPC after cancellation during flood retry sleep", async () => {
    vi.useFakeTimers();
    mocks.send.mockRejectedValueOnce(Object.assign(new Error("flood"), { seconds: 2 }));
    const controller = new AbortController();
    const sending = bridge().sendMessage({
      chatId: "retry-cancel",
      text: "hello",
      formattedText: { text: "hello", entities: [] },
      signal: controller.signal,
      deadline: Date.now() + 10000,
    });
    const rejected = expect(sending).rejects.toThrow(/cancelled/);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
