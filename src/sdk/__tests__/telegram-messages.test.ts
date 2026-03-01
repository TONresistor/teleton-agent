import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTelegramMessagesSDK } from "../telegram-messages.js";
import { PluginSDKError } from "@teleton-agent/sdk";
import { Api } from "telegram";

// ─── GramJS mock ────────────────────────────────────────────────
vi.mock("telegram", () => {
  const cls = (tag: string) =>
    class {
      [key: string]: any;
      constructor(args?: Record<string, any>) {
        Object.assign(this, { _: tag, ...args });
      }
    };
  return {
    Api: {
      channels: {
        DeleteMessages: cls("channels.DeleteMessages"),
      },
      messages: {
        DeleteMessages: cls("messages.DeleteMessages"),
        ForwardMessages: cls("messages.ForwardMessages"),
        UpdatePinnedMessage: cls("messages.UpdatePinnedMessage"),
        Search: cls("messages.Search"),
        GetReplies: cls("messages.GetReplies"),
      },
      Updates: cls("Updates"),
      UpdatesCombined: cls("UpdatesCombined"),
      InputMessagesFilterEmpty: cls("InputMessagesFilterEmpty"),
      DocumentAttributeVideo: cls("DocumentAttributeVideo"),
      DocumentAttributeAudio: cls("DocumentAttributeAudio"),
      DocumentAttributeFilename: cls("DocumentAttributeFilename"),
      DocumentAttributeAnimated: cls("DocumentAttributeAnimated"),
    },
  };
});

vi.mock("big-integer", () => ({
  default: (v: any) => v,
}));

// ─── Mocks ──────────────────────────────────────────────────────
import { createMocks } from "./__fixtures__/mocks.js";
const { mockGramJsClient, mockBridge, mockLog } = createMocks();

describe("createTelegramMessagesSDK", () => {
  let sdk: ReturnType<typeof createTelegramMessagesSDK>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBridge.isAvailable.mockReturnValue(true);
    sdk = createTelegramMessagesSDK(mockBridge, mockLog);
  });

  // ─── BRIDGE_NOT_CONNECTED for all methods ──────────────────
  describe("BRIDGE_NOT_CONNECTED guard", () => {
    beforeEach(() => {
      mockBridge.isAvailable.mockReturnValue(false);
      sdk = createTelegramMessagesSDK(mockBridge, mockLog);
    });

    const methodCalls: [string, () => Promise<any>][] = [
      ["deleteMessage", () => sdk.deleteMessage("chat", 1)],
      ["forwardMessage", () => sdk.forwardMessage("from", "to", 1)],
      ["pinMessage", () => sdk.pinMessage("chat", 1)],
      ["searchMessages", () => sdk.searchMessages("chat", "q")],
      ["scheduleMessage", () => sdk.scheduleMessage("chat", "hi", 1234567890)],
      ["getReplies", () => sdk.getReplies("chat", 1)],
      ["sendPhoto", () => sdk.sendPhoto("chat", Buffer.from(""))],
      ["sendVideo", () => sdk.sendVideo("chat", Buffer.from(""))],
      ["sendVoice", () => sdk.sendVoice("chat", Buffer.from(""))],
      ["sendFile", () => sdk.sendFile("chat", Buffer.from(""))],
      ["sendGif", () => sdk.sendGif("chat", Buffer.from(""))],
      ["sendSticker", () => sdk.sendSticker("chat", Buffer.from(""))],
      ["downloadMedia", () => sdk.downloadMedia("chat", 1)],
      ["setTyping", () => sdk.setTyping("chat")],
    ];

    for (const [name, call] of methodCalls) {
      it(`${name}() throws BRIDGE_NOT_CONNECTED`, async () => {
        await expect(call()).rejects.toMatchObject({ code: "BRIDGE_NOT_CONNECTED" });
      });
    }
  });

  // ─── deleteMessage ──────────────────────────────────────────
  describe("deleteMessage()", () => {
    it("uses channels.DeleteMessages for channel chats (-100 prefix)", async () => {
      const channelEntity = { className: "Channel", id: 123 };
      mockGramJsClient.getEntity.mockResolvedValue(channelEntity);
      mockGramJsClient.invoke.mockResolvedValue({ ptsCount: 1 });

      await sdk.deleteMessage("-100123456", 42);

      expect(mockGramJsClient.getEntity).toHaveBeenCalledWith("-100123456");
      const invokeArg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(invokeArg._).toBe("channels.DeleteMessages");
      expect(invokeArg.channel).toBe(channelEntity);
      expect(invokeArg.id).toEqual([42]);
    });

    it("uses messages.DeleteMessages for non-channel chats", async () => {
      mockGramJsClient.invoke.mockResolvedValue({ ptsCount: 1 });

      await sdk.deleteMessage("12345", 42);

      const invokeArg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(invokeArg._).toBe("messages.DeleteMessages");
      expect(invokeArg.id).toEqual([42]);
      expect(invokeArg.revoke).toBe(true);
    });

    it("respects revoke=false", async () => {
      mockGramJsClient.invoke.mockResolvedValue({ ptsCount: 1 });

      await sdk.deleteMessage("12345", 42, false);

      const invokeArg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(invokeArg.revoke).toBe(false);
    });

    it("wraps errors as OPERATION_FAILED", async () => {
      mockGramJsClient.invoke.mockRejectedValue(new Error("no permission"));

      await expect(sdk.deleteMessage("12345", 1)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── forwardMessage ─────────────────────────────────────────
  describe("forwardMessage()", () => {
    it("extracts forwarded message ID from UpdateNewMessage", async () => {
      mockGramJsClient.invoke.mockResolvedValue(
        new Api.Updates({
          updates: [{ className: "UpdateNewMessage", message: { id: 77 } }],
        })
      );

      const result = await sdk.forwardMessage("from", "to", 10);
      expect(result).toBe(77);
    });

    it("extracts from UpdateNewChannelMessage", async () => {
      mockGramJsClient.invoke.mockResolvedValue(
        new Api.UpdatesCombined({
          updates: [{ className: "UpdateNewChannelMessage", message: { id: 88 } }],
        })
      );

      const result = await sdk.forwardMessage("from", "to", 10);
      expect(result).toBe(88);
    });

    it("returns null when no matching update found", async () => {
      mockGramJsClient.invoke.mockResolvedValue(
        new Api.Updates({
          updates: [{ className: "UpdateReadHistoryOutbox" }],
        })
      );

      const result = await sdk.forwardMessage("from", "to", 10);
      expect(result).toBeNull();
    });

    it("returns null when updates is empty", async () => {
      mockGramJsClient.invoke.mockResolvedValue(new Api.Updates({ updates: [] }));

      const result = await sdk.forwardMessage("from", "to", 10);
      expect(result).toBeNull();
    });

    it("returns null when no updates key", async () => {
      mockGramJsClient.invoke.mockResolvedValue({});

      const result = await sdk.forwardMessage("from", "to", 10);
      expect(result).toBeNull();
    });

    it("wraps errors", async () => {
      mockGramJsClient.invoke.mockRejectedValue(new Error("peer invalid"));

      await expect(sdk.forwardMessage("f", "t", 1)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── pinMessage ─────────────────────────────────────────────
  describe("pinMessage()", () => {
    it("pins a message with defaults", async () => {
      mockGramJsClient.invoke.mockResolvedValue({});

      await sdk.pinMessage("chat1", 42);

      const arg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(arg._).toBe("messages.UpdatePinnedMessage");
      expect(arg.peer).toBe("chat1");
      expect(arg.id).toBe(42);
      expect(arg.unpin).toBeUndefined();
    });

    it("unpins a message", async () => {
      mockGramJsClient.invoke.mockResolvedValue({});

      await sdk.pinMessage("chat1", 42, { unpin: true });

      const arg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(arg.unpin).toBe(true);
    });

    it("supports silent pin", async () => {
      mockGramJsClient.invoke.mockResolvedValue({});

      await sdk.pinMessage("chat1", 42, { silent: true });

      const arg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(arg.silent).toBe(true);
    });

    it("wraps errors", async () => {
      mockGramJsClient.invoke.mockRejectedValue(new Error("no permission"));

      await expect(sdk.pinMessage("chat1", 1)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── searchMessages ─────────────────────────────────────────
  describe("searchMessages()", () => {
    it("returns simplified messages", async () => {
      const entity = { className: "Channel" };
      mockGramJsClient.getEntity.mockResolvedValue(entity);
      mockGramJsClient.invoke.mockResolvedValue({
        messages: [
          { id: 1, message: "hello", fromId: { userId: 100 }, date: 1700000000 },
          { id: 2, message: "world", fromId: { channelId: 200 }, date: 1700000001 },
        ],
      });

      const result = await sdk.searchMessages("chat1", "hello", 10);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[0].text).toBe("hello");
      expect(result[0].senderId).toBe(100);
      expect(result[1].senderId).toBe(200);
    });

    it("uses default limit of 20", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({});
      mockGramJsClient.invoke.mockResolvedValue({ messages: [] });

      await sdk.searchMessages("chat1", "q");

      const arg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(arg.limit).toBe(20);
    });

    it("returns [] on error (query pattern)", async () => {
      mockGramJsClient.getEntity.mockRejectedValue(new Error("not found"));

      const result = await sdk.searchMessages("chat1", "q");

      expect(result).toEqual([]);
      expect(mockLog.error).toHaveBeenCalled();
    });

    it("re-throws PluginSDKError", async () => {
      mockBridge.isAvailable.mockReturnValue(false);
      sdk = createTelegramMessagesSDK(mockBridge, mockLog);

      await expect(sdk.searchMessages("chat1", "q")).rejects.toMatchObject({
        code: "BRIDGE_NOT_CONNECTED",
      });
    });

    it("handles missing messages key", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({});
      mockGramJsClient.invoke.mockResolvedValue({});

      const result = await sdk.searchMessages("chat1", "q");
      expect(result).toEqual([]);
    });
  });

  // ─── scheduleMessage ────────────────────────────────────────
  describe("scheduleMessage()", () => {
    it("passes schedule date to sendMessage", async () => {
      mockGramJsClient.sendMessage.mockResolvedValue({ id: 55 });

      const result = await sdk.scheduleMessage("chat1", "later", 1700000000);

      expect(mockGramJsClient.sendMessage).toHaveBeenCalledWith("chat1", {
        message: "later",
        schedule: 1700000000,
      });
      expect(result).toBe(55);
    });

    it("returns null when result has no id", async () => {
      mockGramJsClient.sendMessage.mockResolvedValue({});

      const result = await sdk.scheduleMessage("chat1", "later", 1700000000);
      expect(result).toBeNull();
    });

    it("wraps errors", async () => {
      mockGramJsClient.sendMessage.mockRejectedValue(new Error("fail"));

      await expect(sdk.scheduleMessage("c", "t", 0)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── getReplies ─────────────────────────────────────────────
  describe("getReplies()", () => {
    it("returns replies sorted oldest first", async () => {
      mockGramJsClient.getInputEntity.mockResolvedValue({ _: "inputPeer" });
      mockGramJsClient.invoke.mockResolvedValue({
        messages: [
          {
            className: "Message",
            id: 2,
            message: "second",
            fromId: { userId: 10 },
            date: 1700000002,
          },
          {
            className: "Message",
            id: 1,
            message: "first",
            fromId: { userId: 20 },
            date: 1700000001,
          },
          { className: "MessageService", id: 3, message: "", fromId: null, date: 1700000003 },
        ],
      });

      const result = await sdk.getReplies("chat1", 100);

      expect(result).toHaveLength(2); // MessageService filtered out
      expect(result[0].id).toBe(1); // older first
      expect(result[1].id).toBe(2);
    });

    it("returns empty when no messages key in result", async () => {
      mockGramJsClient.getInputEntity.mockResolvedValue({});
      mockGramJsClient.invoke.mockResolvedValue({});

      const result = await sdk.getReplies("chat1", 100);
      expect(result).toEqual([]);
    });

    it("wraps errors", async () => {
      mockGramJsClient.getInputEntity.mockRejectedValue(new Error("peer not found"));

      await expect(sdk.getReplies("c", 1)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── sendPhoto ──────────────────────────────────────────────
  describe("sendPhoto()", () => {
    it("calls sendFile with photo params", async () => {
      mockGramJsClient.sendFile.mockResolvedValue({ id: 10 });

      const result = await sdk.sendPhoto("chat1", Buffer.from("img"), {
        caption: "nice pic",
        replyToId: 5,
      });

      expect(mockGramJsClient.sendFile).toHaveBeenCalledWith("chat1", {
        file: expect.any(Buffer),
        caption: "nice pic",
        replyTo: 5,
      });
      expect(result).toBe(10);
    });

    it("works with string path", async () => {
      mockGramJsClient.sendFile.mockResolvedValue({ id: 11 });

      const result = await sdk.sendPhoto("chat1", "/path/to/photo.jpg");

      expect(mockGramJsClient.sendFile).toHaveBeenCalledWith("chat1", {
        file: "/path/to/photo.jpg",
        caption: undefined,
        replyTo: undefined,
      });
      expect(result).toBe(11);
    });
  });

  // ─── sendVideo ──────────────────────────────────────────────
  describe("sendVideo()", () => {
    it("calls sendFile with video attributes", async () => {
      mockGramJsClient.sendFile.mockResolvedValue({ id: 20 });

      const result = await sdk.sendVideo("chat1", Buffer.from("vid"));

      expect(mockGramJsClient.sendFile).toHaveBeenCalledWith("chat1", {
        file: expect.any(Buffer),
        caption: undefined,
        replyTo: undefined,
        forceDocument: false,
        attributes: [
          expect.objectContaining({ _: "DocumentAttributeVideo", supportsStreaming: true }),
        ],
      });
      expect(result).toBe(20);
    });
  });

  // ─── sendVoice ──────────────────────────────────────────────
  describe("sendVoice()", () => {
    it("calls sendFile with voice audio attributes", async () => {
      mockGramJsClient.sendFile.mockResolvedValue({ id: 30 });

      const result = await sdk.sendVoice("chat1", Buffer.from("audio"));

      expect(mockGramJsClient.sendFile).toHaveBeenCalledWith("chat1", {
        file: expect.any(Buffer),
        caption: undefined,
        replyTo: undefined,
        attributes: [expect.objectContaining({ _: "DocumentAttributeAudio", voice: true })],
      });
      expect(result).toBe(30);
    });
  });

  // ─── sendFile ───────────────────────────────────────────────
  describe("sendFile()", () => {
    it("sends with forceDocument=true", async () => {
      mockGramJsClient.sendFile.mockResolvedValue({ id: 40 });

      const result = await sdk.sendFile("chat1", Buffer.from("data"));

      expect(mockGramJsClient.sendFile).toHaveBeenCalledWith("chat1", {
        file: expect.any(Buffer),
        caption: undefined,
        replyTo: undefined,
        forceDocument: true,
        attributes: undefined,
      });
      expect(result).toBe(40);
    });

    it("passes fileName attribute when provided", async () => {
      mockGramJsClient.sendFile.mockResolvedValue({ id: 41 });

      await sdk.sendFile("chat1", Buffer.from("data"), { fileName: "doc.pdf" });

      const callArgs = mockGramJsClient.sendFile.mock.calls[0][1];
      expect(callArgs.forceDocument).toBe(true);
      expect(callArgs.attributes).toHaveLength(1);
      expect(callArgs.attributes[0]).toMatchObject({
        _: "DocumentAttributeFilename",
        fileName: "doc.pdf",
      });
    });
  });

  // ─── sendGif ────────────────────────────────────────────────
  describe("sendGif()", () => {
    it("calls sendFile with animated attribute", async () => {
      mockGramJsClient.sendFile.mockResolvedValue({ id: 50 });

      const result = await sdk.sendGif("chat1", Buffer.from("gif"));

      expect(mockGramJsClient.sendFile).toHaveBeenCalledWith("chat1", {
        file: expect.any(Buffer),
        caption: undefined,
        replyTo: undefined,
        attributes: [expect.objectContaining({ _: "DocumentAttributeAnimated" })],
      });
      expect(result).toBe(50);
    });
  });

  // ─── sendSticker ────────────────────────────────────────────
  describe("sendSticker()", () => {
    it("calls sendFile with just the file", async () => {
      mockGramJsClient.sendFile.mockResolvedValue({ id: 60 });

      const result = await sdk.sendSticker("chat1", Buffer.from("sticker"));

      expect(mockGramJsClient.sendFile).toHaveBeenCalledWith("chat1", {
        file: expect.any(Buffer),
      });
      expect(result).toBe(60);
    });
  });

  // ─── downloadMedia ──────────────────────────────────────────
  describe("downloadMedia()", () => {
    it("returns Buffer when media exists", async () => {
      const mediaBuffer = Buffer.from("media_data");
      mockGramJsClient.getMessages.mockResolvedValue([{ id: 1, media: { _: "photo" } }]);
      mockGramJsClient.downloadMedia.mockResolvedValue(mediaBuffer);

      const result = await sdk.downloadMedia("chat1", 1);

      expect(mockGramJsClient.getMessages).toHaveBeenCalledWith("chat1", { ids: [1] });
      expect(result).toBeInstanceOf(Buffer);
    });

    it("returns null when no messages found", async () => {
      mockGramJsClient.getMessages.mockResolvedValue([]);

      const result = await sdk.downloadMedia("chat1", 1);
      expect(result).toBeNull();
    });

    it("returns null when message has no media", async () => {
      mockGramJsClient.getMessages.mockResolvedValue([{ id: 1, media: null }]);

      const result = await sdk.downloadMedia("chat1", 1);
      expect(result).toBeNull();
    });

    it("returns null when downloadMedia returns falsy", async () => {
      mockGramJsClient.getMessages.mockResolvedValue([{ id: 1, media: { _: "photo" } }]);
      mockGramJsClient.downloadMedia.mockResolvedValue(null);

      const result = await sdk.downloadMedia("chat1", 1);
      expect(result).toBeNull();
    });

    it("wraps errors", async () => {
      mockGramJsClient.getMessages.mockRejectedValue(new Error("fail"));

      await expect(sdk.downloadMedia("c", 1)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── setTyping ──────────────────────────────────────────────
  describe("setTyping()", () => {
    it("calls bridge.setTyping", async () => {
      mockBridge.setTyping.mockResolvedValue(undefined);

      await sdk.setTyping("chat1");

      expect(mockBridge.setTyping).toHaveBeenCalledWith("chat1");
    });

    it("wraps errors", async () => {
      mockBridge.setTyping.mockRejectedValue(new Error("fail"));

      await expect(sdk.setTyping("c")).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });
});
