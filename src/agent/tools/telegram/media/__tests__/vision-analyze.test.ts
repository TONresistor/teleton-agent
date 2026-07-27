import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfigSchema, type AgentConfig } from "../../../../../config/schema.js";
import type { ToolContext } from "../../../types.js";

const mocks = vi.hoisted(() => ({
  chatWithContext: vi.fn(),
  getProviderModel: vi.fn(),
  getMessages: vi.fn(),
  downloadMedia: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../../../client.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../client.js")>("../../../../client.js");
  return {
    ...actual,
    chatWithContext: mocks.chatWithContext,
    getProviderModel: mocks.getProviderModel,
  };
});

vi.mock("../../../../../sdk/telegram-utils.js", () => ({
  getClient: () => ({
    getMessages: mocks.getMessages,
    downloadMedia: mocks.downloadMedia,
  }),
}));

vi.mock("../../../../../utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: mocks.logError,
  }),
}));

import { visionAnalyzeExecutor } from "../vision-analyze.js";

const codexConfig = AgentConfigSchema.parse({
  provider: "codex",
  model: "gpt-5.6-terra",
  api_key: "",
});

function makeContext(agent: AgentConfig = codexConfig): ToolContext {
  return {
    bridge: {},
    db: {},
    chatId: "100",
    senderId: 1,
    isGroup: false,
    config: { agent },
  } as unknown as ToolContext;
}

function successfulVisionResponse(text = "The image says hello.") {
  return {
    text,
    message: {
      stopReason: "stop",
      usage: { input: 10, output: 5 },
    },
    context: { messages: [] },
  };
}

describe("vision_analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderModel.mockReturnValue({ input: ["text", "image"] });
    mocks.getMessages.mockResolvedValue([{ photo: {}, media: {} }]);
    mocks.downloadMedia.mockResolvedValue(Buffer.from("image-bytes"));
    mocks.chatWithContext.mockResolvedValue(successfulVisionResponse());
  });

  it("uses Codex CLI credentials when the configured API key is empty", async () => {
    const result = await visionAnalyzeExecutor(
      {
        chatId: "100",
        messageId: 42,
        prompt: "Read the text.",
      },
      makeContext()
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        analysis: "The image says hello.",
        source: "telegram:100/42",
        mimeType: "image/jpeg",
      },
    });
    expect(mocks.chatWithContext).toHaveBeenCalledOnce();
    expect(mocks.chatWithContext).toHaveBeenCalledWith(
      codexConfig,
      expect.objectContaining({
        maxTokens: 1024,
        context: expect.objectContaining({
          messages: [
            expect.objectContaining({
              role: "user",
              content: [
                expect.objectContaining({
                  type: "image",
                  data: Buffer.from("image-bytes").toString("base64"),
                  mimeType: "image/jpeg",
                }),
                { type: "text", text: "Read the text." },
              ],
            }),
          ],
        }),
      })
    );
  });

  it.each([
    [
      "Grok Build CLI",
      AgentConfigSchema.parse({
        provider: "grok-build",
        model: "grok-build",
        api_key: "",
      }),
    ],
    [
      "an API-key provider",
      AgentConfigSchema.parse({
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        api_key: "test-key",
      }),
    ],
  ])("uses the shared request path for %s", async (_name, agentConfig) => {
    const result = await visionAnalyzeExecutor(
      { chatId: "100", messageId: 42 },
      makeContext(agentConfig)
    );

    expect(result.success).toBe(true);
    expect(mocks.chatWithContext).toHaveBeenCalledWith(
      agentConfig,
      expect.objectContaining({ maxTokens: 1024 })
    );
  });

  it("rejects models that do not advertise image input before downloading media", async () => {
    mocks.getProviderModel.mockReturnValue({ input: ["text"] });

    const result = await visionAnalyzeExecutor({ chatId: "100", messageId: 42 }, makeContext());

    expect(result).toEqual({
      success: false,
      error:
        "Model gpt-5.6-terra (codex) does not support image analysis. Use a vision-capable model.",
    });
    expect(mocks.getMessages).not.toHaveBeenCalled();
    expect(mocks.chatWithContext).not.toHaveBeenCalled();
  });

  it.each([
    ["missing source", {}],
    ["an incomplete Telegram source", { chatId: "100" }],
    ["multiple sources", { filePath: "uploads/image.jpg", chatId: "100", messageId: 42 }],
  ])("rejects %s", async (_name, params) => {
    const result = await visionAnalyzeExecutor(params, makeContext());

    expect(result).toEqual({
      success: false,
      error: "Provide exactly one image source: either 'filePath' OR both 'chatId' and 'messageId'",
    });
    expect(mocks.getProviderModel).not.toHaveBeenCalled();
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });

  it("returns a safe authentication error after the shared retry path is exhausted", async () => {
    mocks.chatWithContext.mockResolvedValue({
      text: "",
      message: {
        stopReason: "error",
        errorMessage: "OpenAI API error (401): Unauthorized secret-token-value",
      },
      context: { messages: [] },
    });

    const result = await visionAnalyzeExecutor({ chatId: "100", messageId: 42 }, makeContext());

    expect(result).toEqual({
      success: false,
      error: "Vision authentication failed for codex. Check the configured credentials.",
    });
    expect(result.error).not.toContain("secret-token-value");
  });

  it("returns a safe rate-limit error without exposing provider details", async () => {
    mocks.chatWithContext.mockResolvedValue({
      text: "",
      message: {
        stopReason: "error",
        errorMessage: "429 rate limit exceeded for account secret-account-id",
      },
      context: { messages: [] },
    });

    const result = await visionAnalyzeExecutor({ chatId: "100", messageId: 42 }, makeContext());

    expect(result).toEqual({
      success: false,
      error: "Vision request was rate-limited by codex. Try again later.",
    });
    expect(result.error).not.toContain("secret-account-id");
  });

  it("reports missing CLI credentials clearly", async () => {
    mocks.chatWithContext.mockRejectedValue(
      new Error("No Codex credentials found. Run 'codex' to authenticate or set api_key in config.")
    );

    const result = await visionAnalyzeExecutor({ chatId: "100", messageId: 42 }, makeContext());

    expect(result).toEqual({
      success: false,
      error: "No Codex credentials found. Run 'codex' to authenticate.",
    });
  });

  it("does not expose or log raw provider exceptions", async () => {
    mocks.chatWithContext.mockRejectedValue(
      new Error("transport failed with Authorization: Bearer secret-provider-token")
    );

    const result = await visionAnalyzeExecutor({ chatId: "100", messageId: 42 }, makeContext());

    expect(result).toEqual({
      success: false,
      error: "Vision request failed for codex/gpt-5.6-terra. Check the service logs for details.",
    });
    expect(JSON.stringify(result)).not.toContain("secret-provider-token");
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain("secret-provider-token");
  });

  it("returns a clear error when the agent configuration is missing", async () => {
    const result = await visionAnalyzeExecutor(
      { chatId: "100", messageId: 42 },
      {
        ...makeContext(),
        config: undefined,
      }
    );

    expect(result).toEqual({
      success: false,
      error: "Agent configuration is unavailable for vision analysis",
    });
    expect(mocks.getProviderModel).not.toHaveBeenCalled();
  });

  it("rejects local paths outside the workspace", async () => {
    const result = await visionAnalyzeExecutor({ filePath: "../../etc/passwd" }, makeContext());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Security Error");
    expect(result.error).toContain("Can only read files from workspace");
    expect(mocks.chatWithContext).not.toHaveBeenCalled();
  });

  it("rejects unsupported Telegram document MIME types before download", async () => {
    mocks.getMessages.mockResolvedValue([
      {
        media: {},
        document: { mimeType: "application/pdf" },
      },
    ]);

    const result = await visionAnalyzeExecutor({ chatId: "100", messageId: 42 }, makeContext());

    expect(result).toEqual({
      success: false,
      error:
        "Unsupported media type: application/pdf. Vision only supports: image/jpeg, image/png, image/gif, image/webp",
    });
    expect(mocks.downloadMedia).not.toHaveBeenCalled();
    expect(mocks.chatWithContext).not.toHaveBeenCalled();
  });

  it("rejects images larger than 5 MB before calling the model", async () => {
    mocks.downloadMedia.mockResolvedValue(Buffer.alloc(5 * 1024 * 1024 + 1));

    const result = await visionAnalyzeExecutor({ chatId: "100", messageId: 42 }, makeContext());

    expect(result).toEqual({
      success: false,
      error: "Image too large: 5.00MB exceeds 5MB limit",
    });
    expect(mocks.chatWithContext).not.toHaveBeenCalled();
  });

  it("rejects an empty successful model response", async () => {
    mocks.chatWithContext.mockResolvedValue(successfulVisionResponse(""));

    const result = await visionAnalyzeExecutor({ chatId: "100", messageId: 42 }, makeContext());

    expect(result).toEqual({
      success: false,
      error: "Model did not return any analysis",
    });
  });
});
