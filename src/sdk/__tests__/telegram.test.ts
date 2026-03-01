import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTelegramSDK } from "../telegram.js";
import { PluginSDKError } from "@teleton-agent/sdk";
import { Api } from "telegram";

// ─── GramJS mock ────────────────────────────────────────────────
vi.mock("telegram", () => {
  /** Creates a class whose constructor stores all args as own properties */
  const cls = (tag: string) =>
    class {
      [key: string]: any;
      constructor(args?: Record<string, any>) {
        Object.assign(this, { _: tag, ...args });
      }
    };
  return {
    Api: {
      messages: {
        SendMedia: cls("messages.SendMedia"),
      },
      InputMediaDice: cls("InputMediaDice"),
      InputReplyToMessage: cls("InputReplyToMessage"),
      Updates: cls("Updates"),
      UpdatesCombined: cls("UpdatesCombined"),
      Message: cls("Message"),
      MessageMediaDice: cls("MessageMediaDice"),
    },
  };
});

// ─── Mocks ──────────────────────────────────────────────────────
import { createMocks } from "./__fixtures__/mocks.js";
const { mockGramJsClient, mockBridgeClient, mockBridge, mockLog } = createMocks();

describe("createTelegramSDK — core", () => {
  let sdk: ReturnType<typeof createTelegramSDK>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBridge.isAvailable.mockReturnValue(true);
    sdk = createTelegramSDK(mockBridge, mockLog);
  });

  // ─── sendMessage ────────────────────────────────────────────
  describe("sendMessage()", () => {
    it("calls bridge.sendMessage and returns message ID", async () => {
      mockBridge.sendMessage.mockResolvedValue({ id: 42 });

      const result = await sdk.sendMessage("12345", "hello");

      expect(mockBridge.sendMessage).toHaveBeenCalledWith({
        chatId: "12345",
        text: "hello",
        replyToId: undefined,
        inlineKeyboard: undefined,
      });
      expect(result).toBe(42);
    });

    it("passes options (replyToId, inlineKeyboard)", async () => {
      mockBridge.sendMessage.mockResolvedValue({ id: 99 });
      const kb = [[{ text: "OK", callback_data: "ok" }]];

      await sdk.sendMessage("12345", "hi", { replyToId: 10, inlineKeyboard: kb });

      expect(mockBridge.sendMessage).toHaveBeenCalledWith({
        chatId: "12345",
        text: "hi",
        replyToId: 10,
        inlineKeyboard: kb,
      });
    });

    it("wraps non-SDK errors as OPERATION_FAILED", async () => {
      mockBridge.sendMessage.mockRejectedValue(new Error("network fail"));

      await expect(sdk.sendMessage("12345", "hi")).rejects.toThrow(PluginSDKError);
      await expect(sdk.sendMessage("12345", "hi")).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });

    it("re-throws PluginSDKError as-is", async () => {
      const sdkErr = new PluginSDKError("custom", "BRIDGE_NOT_CONNECTED");
      mockBridge.sendMessage.mockRejectedValue(sdkErr);

      await expect(sdk.sendMessage("12345", "hi")).rejects.toBe(sdkErr);
    });

    it("throws BRIDGE_NOT_CONNECTED when bridge unavailable", async () => {
      mockBridge.isAvailable.mockReturnValue(false);
      sdk = createTelegramSDK(mockBridge, mockLog);

      await expect(sdk.sendMessage("12345", "hello")).rejects.toMatchObject({
        code: "BRIDGE_NOT_CONNECTED",
      });
    });
  });

  // ─── editMessage ────────────────────────────────────────────
  describe("editMessage()", () => {
    it("calls bridge.editMessage and returns msg.id when present", async () => {
      mockBridge.editMessage.mockResolvedValue({ id: 77 });

      const result = await sdk.editMessage("12345", 10, "updated");

      expect(mockBridge.editMessage).toHaveBeenCalledWith({
        chatId: "12345",
        messageId: 10,
        text: "updated",
        inlineKeyboard: undefined,
      });
      expect(result).toBe(77);
    });

    it("falls back to input messageId when result has no id", async () => {
      mockBridge.editMessage.mockResolvedValue({});

      const result = await sdk.editMessage("12345", 10, "updated");
      expect(result).toBe(10);
    });

    it("falls back when result is null/undefined", async () => {
      mockBridge.editMessage.mockResolvedValue(null);

      const result = await sdk.editMessage("12345", 10, "updated");
      expect(result).toBe(10);
    });

    it("throws BRIDGE_NOT_CONNECTED when bridge unavailable", async () => {
      mockBridge.isAvailable.mockReturnValue(false);
      sdk = createTelegramSDK(mockBridge, mockLog);

      await expect(sdk.editMessage("12345", 1, "hi")).rejects.toMatchObject({
        code: "BRIDGE_NOT_CONNECTED",
      });
    });

    it("wraps non-SDK errors", async () => {
      mockBridge.editMessage.mockRejectedValue(new Error("boom"));

      await expect(sdk.editMessage("12345", 1, "hi")).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── sendDice ───────────────────────────────────────────────
  describe("sendDice()", () => {
    it("invokes API and extracts value from Updates", async () => {
      mockGramJsClient.invoke.mockResolvedValue(
        new Api.Updates({
          updates: [
            {
              className: "UpdateNewMessage",
              message: new Api.Message({
                id: 55,
                media: { className: "MessageMediaDice", value: 4 },
              }),
            },
          ],
        })
      );

      const result = await sdk.sendDice("12345", "dice");

      expect(mockGramJsClient.invoke).toHaveBeenCalledOnce();
      expect(result).toEqual({ value: 4, messageId: 55 });
    });

    it("extracts from UpdateNewChannelMessage", async () => {
      mockGramJsClient.invoke.mockResolvedValue(
        new Api.UpdatesCombined({
          updates: [
            {
              className: "UpdateNewChannelMessage",
              message: new Api.Message({
                id: 88,
                media: { className: "MessageMediaDice", value: 6 },
              }),
            },
          ],
        })
      );

      const result = await sdk.sendDice("-10012345", "dice");
      expect(result).toEqual({ value: 6, messageId: 88 });
    });

    it("passes replyToId when provided", async () => {
      mockGramJsClient.invoke.mockResolvedValue(
        new Api.Updates({
          updates: [
            {
              className: "UpdateNewMessage",
              message: new Api.Message({
                id: 1,
                media: { className: "MessageMediaDice", value: 1 },
              }),
            },
          ],
        })
      );

      await sdk.sendDice("12345", "dice", 99);
      const invocationArg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(invocationArg.replyTo).toBeDefined();
    });

    it("throws when dice value cannot be extracted", async () => {
      mockGramJsClient.invoke.mockResolvedValue(new Api.Updates({ updates: [] }));

      await expect(sdk.sendDice("12345", "dice")).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });

    it("throws when result className is unexpected", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        className: "UpdateShort",
      });

      await expect(sdk.sendDice("12345", "dice")).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });

    it("throws BRIDGE_NOT_CONNECTED when bridge unavailable", async () => {
      mockBridge.isAvailable.mockReturnValue(false);
      sdk = createTelegramSDK(mockBridge, mockLog);

      await expect(sdk.sendDice("12345", "dice")).rejects.toMatchObject({
        code: "BRIDGE_NOT_CONNECTED",
      });
    });
  });

  // ─── sendReaction ───────────────────────────────────────────
  describe("sendReaction()", () => {
    it("calls bridge.sendReaction", async () => {
      mockBridge.sendReaction.mockResolvedValue(undefined);

      await sdk.sendReaction("12345", 10, "thumbs_up");

      expect(mockBridge.sendReaction).toHaveBeenCalledWith("12345", 10, "thumbs_up");
    });

    it("wraps errors", async () => {
      mockBridge.sendReaction.mockRejectedValue(new Error("fail"));

      await expect(sdk.sendReaction("12345", 10, "ok")).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });

    it("throws BRIDGE_NOT_CONNECTED when bridge unavailable", async () => {
      mockBridge.isAvailable.mockReturnValue(false);
      sdk = createTelegramSDK(mockBridge, mockLog);

      await expect(sdk.sendReaction("12345", 10, "ok")).rejects.toMatchObject({
        code: "BRIDGE_NOT_CONNECTED",
      });
    });
  });

  // ─── getMessages ────────────────────────────────────────────
  describe("getMessages()", () => {
    it("returns simplified messages array", async () => {
      const ts = new Date("2024-01-01");
      mockBridge.getMessages.mockResolvedValue([
        { id: 1, text: "hello", senderId: 100, senderUsername: "alice", timestamp: ts },
        { id: 2, text: "world", senderId: 200, senderUsername: undefined, timestamp: ts },
      ]);

      const result = await sdk.getMessages("12345", 10);

      expect(mockBridge.getMessages).toHaveBeenCalledWith("12345", 10);
      expect(result).toEqual([
        { id: 1, text: "hello", senderId: 100, senderUsername: "alice", timestamp: ts },
        { id: 2, text: "world", senderId: 200, senderUsername: undefined, timestamp: ts },
      ]);
    });

    it("defaults limit to 50", async () => {
      mockBridge.getMessages.mockResolvedValue([]);

      await sdk.getMessages("12345");

      expect(mockBridge.getMessages).toHaveBeenCalledWith("12345", 50);
    });

    it("returns [] on error (query method pattern)", async () => {
      mockBridge.getMessages.mockRejectedValue(new Error("fail"));

      const result = await sdk.getMessages("12345");

      expect(result).toEqual([]);
      expect(mockLog.error).toHaveBeenCalled();
    });

    it("throws BRIDGE_NOT_CONNECTED when bridge unavailable", async () => {
      mockBridge.isAvailable.mockReturnValue(false);
      sdk = createTelegramSDK(mockBridge, mockLog);

      await expect(sdk.getMessages("12345")).rejects.toMatchObject({
        code: "BRIDGE_NOT_CONNECTED",
      });
    });
  });

  // ─── getMe ──────────────────────────────────────────────────
  describe("getMe()", () => {
    it("returns user info", () => {
      mockBridgeClient.getMe.mockReturnValue({
        id: BigInt(123),
        username: "bot",
        firstName: "Bot",
        isBot: true,
      });

      const result = sdk.getMe();

      expect(result).toEqual({
        id: 123,
        username: "bot",
        firstName: "Bot",
        isBot: true,
      });
    });

    it("returns null when getMe returns falsy", () => {
      mockBridgeClient.getMe.mockReturnValue(null);

      expect(sdk.getMe()).toBeNull();
    });

    it("returns null on error", () => {
      mockBridgeClient.getMe.mockImplementation(() => {
        throw new Error("disconnected");
      });

      expect(sdk.getMe()).toBeNull();
    });
  });

  // ─── isAvailable ────────────────────────────────────────────
  describe("isAvailable()", () => {
    it("returns true when bridge is available", () => {
      mockBridge.isAvailable.mockReturnValue(true);
      expect(sdk.isAvailable()).toBe(true);
    });

    it("returns false when bridge is unavailable", () => {
      mockBridge.isAvailable.mockReturnValue(false);
      expect(sdk.isAvailable()).toBe(false);
    });
  });

  // ─── getRawClient ───────────────────────────────────────────
  describe("getRawClient()", () => {
    it("returns GramJS client when bridge is available", () => {
      const result = sdk.getRawClient();
      expect(result).toBe(mockGramJsClient);
    });

    it("returns null when bridge is unavailable", () => {
      mockBridge.isAvailable.mockReturnValue(false);
      expect(sdk.getRawClient()).toBeNull();
    });
  });
});
