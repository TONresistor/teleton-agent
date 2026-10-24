import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { ConfigSchema } from "../../../config/schema.js";
import type { TurnContext } from "../../turn-types.js";
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../llm-iteration.js", () => ({ runModelIteration: mocks.run, recoverLlmError: vi.fn() }));
import { executeAgentLoop } from "../executor.js";
afterEach(() => vi.useRealTimers());
describe("accepting a model response", () => {
  it("does not complete a late normal response that ignored cancellation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const config = ConfigSchema.parse({
      agent: { api_key: "test", max_turn_duration_ms: 10_000 },
      telegram: { api_id: 1, api_hash: "test", phone: "+33123456789" },
    });
    const userMsg = { role: "user" as const, content: "request", timestamp: 1000 };
    const context = { messages: [userMsg] };
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "late success" }],
      stopReason: "stop",
      timestamp: 11001,
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { total: 0 },
      },
    } as AssistantMessage;
    mocks.run.mockImplementation(async () => {
      vi.setSystemTime(11_001);
      return {
        response: { message, text: "late success", context },
        streamed: false,
        streamAccumulatedText: "",
      };
    });
    const turn = {
      turnId: "late",
      chatId: "1",
      effectiveIsGroup: false,
      processStartTime: 1000,
      systemPrompt: "system",
      userMsg,
      sessionKey: "1",
      session: { sessionId: "session" },
      context,
      provider: "anthropic",
    } as TurnContext;
    const loop = await executeAgentLoop(
      turn,
      {
        chatId: "1",
        userMessage: "request",
        admission: { receivedAt: 1000, queueDeadline: 2000, executionDeadline: 11_000 },
      },
      { progress: vi.fn() } as never,
      { config, toolRegistry: null }
    );
    expect(loop.stopReason).toBe("time_budget");
    expect(loop.forcedContent).toContain("interrupted");
    expect(loop.accumulatedTexts).toEqual([]);
  });
  it("classifies an aborted no-tool response as interrupted instead of completed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const config = ConfigSchema.parse({
      agent: { api_key: "test", max_turn_duration_ms: 10_000 },
      telegram: { api_id: 1, api_hash: "test", phone: "+33123456789" },
    });
    const userMsg = { role: "user" as const, content: "request", timestamp: 1000 };
    const context = { messages: [userMsg] };
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "late success" }],
      stopReason: "aborted",
      timestamp: 11001,
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { total: 0 },
      },
    } as AssistantMessage;
    mocks.run.mockImplementation(async () => {
      vi.setSystemTime(1001);
      return {
        response: { message, text: "late success", context },
        streamed: false,
        streamAccumulatedText: "",
      };
    });
    const turn = {
      turnId: "late",
      chatId: "1",
      effectiveIsGroup: false,
      processStartTime: 1000,
      systemPrompt: "system",
      userMsg,
      sessionKey: "1",
      session: { sessionId: "session" },
      context,
      provider: "anthropic",
    } as TurnContext;
    const loop = await executeAgentLoop(
      turn,
      {
        chatId: "1",
        userMessage: "request",
        admission: { receivedAt: 1000, queueDeadline: 2000, executionDeadline: 11_000 },
      },
      { progress: vi.fn() } as never,
      { config, toolRegistry: null }
    );
    expect(loop.stopReason).toBe("aborted");
    expect(loop.forcedContent).toContain("interrupted");
    expect(loop.accumulatedTexts).toEqual([]);
  });
});
