import { describe, it, expect, vi, beforeEach } from "vitest";
import { botInlineSendExecutor } from "../inline-send.js";

// Mock the gramjs-bigint module
vi.mock("../../../../../utils/gramjs-bigint.js", () => ({
  randomLong: () => BigInt(12345),
}));

describe("bot_inline_send", () => {
  const mockInvoke = vi.fn();
  const mockGetInputEntity = vi.fn();
  const mockGramJsClient = {
    invoke: mockInvoke,
    getInputEntity: mockGetInputEntity,
  };

  const mockBridge = {
    isAvailable: () => true,
    getMode: () => "user",
    getClient: () => ({
      getClient: () => mockGramJsClient,
    }),
  };

  const baseContext: any = {
    bridge: mockBridge,
    chatId: "123456",
    config: {
      telegram: { bot_username: "test_bot" },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInputEntity.mockResolvedValue({ _: "inputPeerUser" });
    mockInvoke.mockResolvedValueOnce({
      results: [
        { id: "result_1", type: "article" },
        { id: "result_2", type: "article" },
      ],
      queryId: BigInt(999),
    });
    mockInvoke.mockResolvedValueOnce(undefined); // SendInlineBotResult
  });

  it("sends inline result successfully", async () => {
    const result = await botInlineSendExecutor({ plugin: "cats", query: "random" }, baseContext);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      plugin: "cats",
      query: "random",
      resultIndex: 0,
      resultId: "result_1",
      totalResults: 2,
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("returns error when bot not configured", async () => {
    const result = await botInlineSendExecutor(
      { plugin: "cats", query: "random" },
      { ...baseContext, config: { telegram: {} } }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Bot not configured");
  });

  it("returns error when bridge not available", async () => {
    const result = await botInlineSendExecutor(
      { plugin: "cats", query: "random" },
      { ...baseContext, bridge: { isAvailable: () => false, getMode: () => "user" } }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not available");
  });

  it("returns error when no results returned", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValueOnce({ results: [] });

    const result = await botInlineSendExecutor({ plugin: "cats", query: "unknown" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No inline results");
  });

  it("supports custom result index", async () => {
    const result = await botInlineSendExecutor(
      { plugin: "cats", query: "random", resultIndex: 1 },
      baseContext
    );
    expect(result.success).toBe(true);
    expect(result).toMatchObject({ data: { resultId: "result_2" } });
  });

  it("returns error for out-of-range result index", async () => {
    const result = await botInlineSendExecutor(
      { plugin: "cats", query: "random", resultIndex: 5 },
      baseContext
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("out of range");
  });
});
