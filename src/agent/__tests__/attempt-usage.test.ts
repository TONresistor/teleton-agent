import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { AgentConfigSchema } from "../../config/schema.js";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), stream: vi.fn(), refresh: vi.fn() }));
vi.mock("@earendil-works/pi-ai/compat", async () => ({
  ...(await vi.importActual("@earendil-works/pi-ai/compat")),
  complete: mocks.complete,
  stream: mocks.stream,
}));
vi.mock("../../providers/codex-credentials.js", () => ({
  getCodexApiKey: () => "token",
  refreshCodexApiKey: mocks.refresh,
}));
import { chatWithContext, streamWithContext } from "../client.js";
import {
  getInFlightModelRequests,
  completeUtility,
  createUsageCollector,
  runWithUsageCollector,
} from "../attempt-usage.js";
import { getProviderModel } from "../../providers/model-resolver.js";

const config = AgentConfigSchema.parse({ provider: "codex", model: "gpt-5.6-terra", api_key: "" });
function response(
  stopReason: AssistantMessage["stopReason"],
  input = 3,
  output = 2
): AssistantMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: config.model,
    timestamp: 1,
    stopReason,
    errorMessage: stopReason === "error" ? "401 unauthorized" : undefined,
    usage: {
      input,
      output,
      cacheRead: 1,
      cacheWrite: 0,
      totalTokens: input + output + 1,
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
    },
  };
}
beforeEach(() => {
  mocks.complete.mockReset();
  mocks.stream.mockReset();
  mocks.refresh.mockReset();
});
describe("per-attempt usage", () => {
  it("records both sides of a credential refresh and extracts every text block", async () => {
    mocks.complete
      .mockResolvedValueOnce(response("error"))
      .mockResolvedValueOnce(response("stop", 7, 4));
    mocks.refresh.mockResolvedValue("new-token");
    const collector = createUsageCollector();
    const result = await runWithUsageCollector(collector, () =>
      chatWithContext(config, { context: { messages: [] } })
    );
    expect(result.text).toBe("first\nsecond");
    expect(collector.attempts.map((attempt) => attempt.usage?.input)).toEqual([3, 7]);
    expect(collector.attempts.map((attempt) => attempt.stopReason)).toEqual(["error", "stop"]);
    expect(new Set(collector.attempts.map((attempt) => attempt.attemptId)).size).toBe(2);
    expect(
      collector.attempts.every((attempt) => !attempt.incomplete && attempt.durationMs >= 0)
    ).toBe(true);
  });
  it("records terminal failures and marks missing transport counters incomplete", async () => {
    mocks.complete.mockRejectedValueOnce(new Error("connection lost"));
    const collector = createUsageCollector();
    await expect(
      runWithUsageCollector(collector, () => chatWithContext(config, { context: { messages: [] } }))
    ).rejects.toThrow("connection lost");
    expect(collector.attempts).toHaveLength(1);
    expect(collector.attempts[0].incomplete).toBe(true);
    expect(collector.attempts[0].usage).toBeUndefined();
  });
  it("records aborted stream usage and auxiliary requests in the same collector", async () => {
    mocks.stream.mockReturnValue({ result: async () => response("aborted") });
    mocks.complete.mockResolvedValue(response("stop"));
    const collector = createUsageCollector();
    await runWithUsageCollector(collector, async () => {
      await streamWithContext(config, { context: { messages: [] } }).result;
      await completeUtility(
        getProviderModel("codex", config.model),
        { messages: [] },
        { maxTokens: 20 },
        "test-summary"
      );
    });
    expect(collector.attempts.map((attempt) => attempt.purpose)).toEqual(["agent", "test-summary"]);
    expect(collector.attempts[0].stopReason).toBe("aborted");
  });
});

it("bounds auxiliary requests by the enclosing turn deadline", async () => {
  mocks.complete.mockResolvedValue(response("stop"));
  const collector = createUsageCollector();
  collector.deadlineAt = Date.now() + 1000;
  const abort = new AbortController();
  collector.signal = abort.signal;
  await runWithUsageCollector(collector, () =>
    completeUtility(
      getProviderModel("codex", config.model),
      { messages: [] },
      { maxTokens: 20 },
      "deadline"
    )
  );
  expect(mocks.complete.mock.calls[0][2].timeoutMs).toBeLessThanOrEqual(1000);
  expect(mocks.complete.mock.calls[0][2].signal).toBeInstanceOf(AbortSignal);
  collector.deadlineAt = Date.now() - 1;
  await expect(
    runWithUsageCollector(collector, () =>
      completeUtility(
        getProviderModel("codex", config.model),
        { messages: [] },
        { maxTokens: 20 },
        "expired"
      )
    )
  ).rejects.toThrow("time budget");
  expect(mocks.complete).toHaveBeenCalledOnce();
});

it("bounds a noncooperative model wait and updates the same usage receipt when it settles late", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (message: AssistantMessage) => void;
    mocks.complete.mockImplementation(
      () =>
        new Promise<AssistantMessage>((resolve) => {
          finish = resolve;
        })
    );
    const collector = createUsageCollector();
    const before = getInFlightModelRequests();
    const updates: import("../attempt-usage.js").ModelAttemptUsage[] = [];
    collector.onAttempt = (attempt) => {
      updates.push(attempt);
    };
    const pending = runWithUsageCollector(collector, () =>
      chatWithContext(config, { context: { messages: [] }, timeoutMs: 10 })
    );
    const stopped = expect(pending).rejects.toThrow("time budget");
    await vi.advanceTimersByTimeAsync(11);
    await stopped;
    expect(collector.attempts).toHaveLength(1);
    expect(collector.attempts[0]).toMatchObject({ incomplete: true, inFlight: true });
    expect(getInFlightModelRequests()).toBe(before + 1);
    const id = collector.attempts[0].attemptId;
    finish(response("stop", 13, 4));
    await vi.advanceTimersByTimeAsync(0);
    expect(collector.attempts).toHaveLength(1);
    expect(collector.attempts[0]).toMatchObject({
      attemptId: id,
      incomplete: false,
      inFlight: false,
      usage: { input: 13 },
    });
    expect(updates).toHaveLength(2);
    expect(getInFlightModelRequests()).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("does not start another provider attempt when credential refresh finishes after cancellation", async () => {
  let finishRefresh!: (key: string) => void;
  let enteredRefresh!: () => void;
  const entered = new Promise<void>((resolve) => {
    enteredRefresh = resolve;
  });
  mocks.complete.mockResolvedValue(response("error"));
  mocks.refresh.mockImplementation(() => {
    enteredRefresh();
    return new Promise<string>((resolve) => {
      finishRefresh = resolve;
    });
  });
  const controller = new AbortController();
  const result = chatWithContext(config, { context: { messages: [] }, signal: controller.signal });
  const stopped = expect(result).rejects.toThrow("time budget");
  await entered;
  controller.abort();
  finishRefresh("new-token");
  await stopped;
  expect(mocks.complete).toHaveBeenCalledOnce();
});

it("checks cancellation before a 401 refresh and before the first SDK call", async () => {
  const controller = new AbortController();
  mocks.complete.mockImplementation(async () => {
    controller.abort();
    return response("error");
  });
  await expect(
    chatWithContext(config, { context: { messages: [] }, signal: controller.signal })
  ).rejects.toThrow("time budget");
  expect(mocks.refresh).not.toHaveBeenCalled();
  mocks.complete.mockClear();
  await expect(
    chatWithContext(config, { context: { messages: [] }, signal: controller.signal })
  ).rejects.toThrow("time budget");
  expect(mocks.complete).not.toHaveBeenCalled();
});

it("bounds a noncooperative utility request with the enclosing deadline", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (message: AssistantMessage) => void;
    mocks.complete.mockImplementation(
      () =>
        new Promise<AssistantMessage>((resolve) => {
          finish = resolve;
        })
    );
    const collector = createUsageCollector();
    collector.deadlineAt = Date.now() + 10;
    const result = runWithUsageCollector(collector, () =>
      completeUtility(getProviderModel("codex", config.model), { messages: [] }, {}, "summary")
    );
    const stopped = expect(result).rejects.toThrow("time budget");
    await vi.advanceTimersByTimeAsync(11);
    await stopped;
    expect(collector.attempts[0].incomplete).toBe(true);
    finish(response("stop"));
    await vi.advanceTimersByTimeAsync(0);
    expect(collector.attempts[0].incomplete).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it("bounds both a noncooperative stream result and its pending text iterator", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (message: AssistantMessage) => void;
    mocks.stream.mockReturnValue({
      result: () =>
        new Promise<AssistantMessage>((resolve) => {
          finish = resolve;
        }),
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    });
    const output = streamWithContext(config, { context: { messages: [] }, timeoutMs: 10 });
    const stoppedResult = expect(output.result).rejects.toThrow("time budget");
    const stoppedText = expect(output.textStream[Symbol.asyncIterator]().next()).rejects.toThrow(
      "time budget"
    );
    await vi.advanceTimersByTimeAsync(11);
    await stoppedResult;
    await stoppedText;
    finish(response("stop"));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
