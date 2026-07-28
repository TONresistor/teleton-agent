import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Api } from "telegram";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  uploadFile: vi.fn(),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  readRichDocumentMetadata: vi.fn(),
}));

vi.mock("../client.js", () => ({
  TelegramUserClient: class {
    getClient() {
      return {
        invoke: mocks.invoke,
        uploadFile: mocks.uploadFile,
        editMessage: mocks.editMessage,
      };
    }

    sendMessage = mocks.sendMessage;
  },
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../media-metadata.js", () => ({
  readRichDocumentMetadata: mocks.readRichDocumentMetadata,
}));

import { GramJSUserBridge } from "../bridges/user.js";

function createBridge(): GramJSUserBridge {
  return new GramJSUserBridge({
    apiId: 1,
    apiHash: "test",
    phone: "+10000000000",
    sessionName: "test",
    sessionPath: "/tmp",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue(
    new Api.UpdateShortSentMessage({
      id: 321,
      pts: 1,
      ptsCount: 1,
      date: 1_750_000_000,
    })
  );
  mocks.sendMessage.mockResolvedValue({ id: 654, date: 1_750_000_001 });
  mocks.editMessage.mockResolvedValue({ id: 44, date: 1_750_000_002 });
  mocks.uploadFile.mockResolvedValue(
    new Api.InputFile({
      id: 1n,
      parts: 1,
      name: "chart.png",
      md5Checksum: "",
    })
  );
  mocks.readRichDocumentMetadata.mockImplementation(async (_path, type) =>
    type === "video" ? { duration: 27.052, width: 1920, height: 1080 } : { duration: 181.4 }
  );
});

describe("GramJSUserBridge rich messages", () => {
  it("sends structured user-mode replies as native Rich Markdown", async () => {
    const bridge = createBridge();

    const sent = await bridge.sendMessage({
      chatId: "123",
      text: "# Report\n\n*Natural italic*\n\n| A | B |\n| - | - |",
      replyToId: 7,
    });

    expect(sent).toEqual({ id: 321, date: 1_750_000_000, chatId: "123" });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    const request = mocks.invoke.mock.calls[0][0];
    expect(request).toBeInstanceOf(Api.messages.SendMessage);
    expect(request.message).toBe("");
    expect(request.noWebpage).toBe(true);
    expect(request.richMessage).toBeInstanceOf(Api.InputRichMessageMarkdown);
    expect(request.richMessage.markdown).toContain("*Natural italic*");
    expect(request.replyTo).toBeInstanceOf(Api.InputReplyToMessage);
    expect(request.replyTo.replyToMsgId).toBe(7);
  });

  it("uploads a local photo and embeds it inside one Rich Message", async () => {
    const directory = mkdtempSync(join(tmpdir(), "teleton-rich-media-"));
    const photoPath = join(directory, "chart.png");
    writeFileSync(photoPath, Buffer.from("test-image"));
    const uploadedPhoto = new Api.Photo({
      id: 10n,
      accessHash: 20n,
      fileReference: Buffer.from([1, 2, 3]),
      date: 1_750_000_000,
      sizes: [],
      dcId: 2,
    });
    mocks.invoke.mockImplementation(async (request) => {
      if (request instanceof Api.messages.UploadMedia) {
        return new Api.MessageMediaPhoto({ photo: uploadedPhoto });
      }
      return new Api.UpdateShortSentMessage({
        id: 321,
        pts: 1,
        ptsCount: 1,
        date: 1_750_000_000,
      });
    });
    const bridge = createBridge();

    try {
      const sent = await bridge.sendRichMessage({
        chatId: "123",
        text: "Before\n\n![Chart](tg://photo?id=chart)\n\nAfter",
        media: [{ id: "chart", type: "photo", path: photoPath }],
        replyToId: 7,
      });

      expect(sent).toEqual({ id: 321, date: 1_750_000_000, chatId: "123" });
      expect(mocks.uploadFile).toHaveBeenCalledOnce();
      expect(mocks.invoke).toHaveBeenCalledTimes(2);

      const uploadRequest = mocks.invoke.mock.calls[0][0];
      expect(uploadRequest).toBeInstanceOf(Api.messages.UploadMedia);
      expect(uploadRequest.media).toBeInstanceOf(Api.InputMediaUploadedPhoto);

      const sendRequest = mocks.invoke.mock.calls[1][0];
      expect(sendRequest).toBeInstanceOf(Api.messages.SendMessage);
      expect(sendRequest.richMessage).toBeInstanceOf(Api.InputRichMessageMarkdown);
      expect(sendRequest.richMessage.files).toHaveLength(1);
      expect(sendRequest.richMessage.files[0]).toBeInstanceOf(Api.InputRichFilePhoto);
      expect(sendRequest.richMessage.files[0]).toMatchObject({
        id: "chart",
        photo: {
          id: 10n,
          accessHash: 20n,
          fileReference: Buffer.from([1, 2, 3]),
        },
      });
      expect(sendRequest.replyTo).toMatchObject({ replyToMsgId: 7 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["video", "clip.mp4", Api.DocumentAttributeVideo, "video/mp4"],
    ["audio", "track.mp3", Api.DocumentAttributeAudio, "audio/mpeg"],
  ] as const)(
    "uploads a local %s as an embedded Rich Message document",
    async (type, filename, expectedAttribute, expectedMimeType) => {
      const directory = mkdtempSync(join(tmpdir(), "teleton-rich-media-"));
      const mediaPath = join(directory, filename);
      writeFileSync(mediaPath, Buffer.from("test-media"));
      const uploadedDocument = new Api.Document({
        id: 30n,
        accessHash: 40n,
        fileReference: Buffer.from([4, 5, 6]),
        date: 1_750_000_000,
        mimeType: expectedMimeType,
        size: 10n,
        dcId: 2,
        attributes: [],
      });
      mocks.invoke.mockImplementation(async (request) => {
        if (request instanceof Api.messages.UploadMedia) {
          return new Api.MessageMediaDocument({ document: uploadedDocument });
        }
        return new Api.UpdateShortSentMessage({
          id: 322,
          pts: 1,
          ptsCount: 1,
          date: 1_750_000_000,
        });
      });
      const bridge = createBridge();

      try {
        const sent = await bridge.sendRichMessage({
          chatId: "123",
          text: `Before\n\n![Media](tg://${type}?id=media)\n\nAfter`,
          media: [{ id: "media", type, path: mediaPath }],
        });

        expect(sent.id).toBe(322);
        const uploadRequest = mocks.invoke.mock.calls[0][0];
        expect(uploadRequest.media).toBeInstanceOf(Api.InputMediaUploadedDocument);
        expect(uploadRequest.media.mimeType).toBe(expectedMimeType);
        expect(uploadRequest.media.attributes).toEqual([
          expect.any(Api.DocumentAttributeFilename),
          expect.any(expectedAttribute),
        ]);
        if (type === "video") {
          expect(uploadRequest.media.attributes[1]).toMatchObject({
            duration: 27.052,
            w: 1920,
            h: 1080,
            supportsStreaming: true,
          });
        } else {
          expect(uploadRequest.media.attributes[1]).toMatchObject({
            duration: 181,
          });
        }

        const sendRequest = mocks.invoke.mock.calls[1][0];
        expect(sendRequest.richMessage.files).toHaveLength(1);
        expect(sendRequest.richMessage.files[0]).toBeInstanceOf(Api.InputRichFileDocument);
        expect(sendRequest.richMessage.files[0]).toMatchObject({
          id: "media",
          document: {
            id: 30n,
            accessHash: 40n,
            fileReference: Buffer.from([4, 5, 6]),
          },
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it("keeps plain replies as classic Telegram messages", async () => {
    const bridge = createBridge();

    const sent = await bridge.sendMessage({
      chatId: "123",
      text: "Voir https://example.com, __init__, foo__bar__baz, Range: $5-$10 et $TON/$USDT.",
      replyToId: 7,
    });

    expect(sent).toEqual({ id: 654, date: 1_750_000_001, chatId: "123" });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith("123", {
      message: "Voir https://example.com, __init__, foo__bar__baz, Range: $5-$10 et $TON/$USDT.",
      replyTo: 7,
    });
  });

  it.each([
    ["bold", "**important**"],
    ["underscore bold", "__important words__"],
    ["list", "- first\n- second"],
    ["code", "```ts\nconst ready = true;\n```"],
    ["table", "| A | B |\n| --- | --- |\n| 1 | 2 |"],
    ["LaTeX", String.raw`\[E = mc^2\]`],
    ["inline LaTeX", "$x^2 + y^2$"],
    ["compact quote", ">Quoted text"],
    ["Telegram HTML", "<details><summary>More</summary>Hidden</details>"],
  ])("recognizes %s as structured content", async (_label, text) => {
    const bridge = createBridge();

    await bridge.sendMessage({ chatId: "123", text });

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("falls back to the classic sender only for deterministic rich-format errors", async () => {
    mocks.invoke.mockRejectedValue(
      Object.assign(new Error("RICH_MESSAGE_INVALID"), {
        code: 400,
        errorMessage: "RICH_MESSAGE_INVALID",
      })
    );
    const bridge = createBridge();

    const sent = await bridge.sendMessage({
      chatId: "123",
      text: "**fallback text**",
    });

    expect(sent).toEqual({ id: 654, date: 1_750_000_001, chatId: "123" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith("123", {
      message: "**fallback text**",
      replyTo: undefined,
    });
  });

  it("does not risk a duplicate classic send after an ambiguous transport failure", async () => {
    mocks.invoke.mockRejectedValue(
      Object.assign(new Error("socket response parse timeout"), {
        code: 500,
      })
    );
    const bridge = createBridge();

    await expect(
      bridge.sendMessage({
        chatId: "123",
        text: "**do not duplicate**",
      })
    ).rejects.toThrow("socket response parse timeout");

    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("does not treat a generic code 400 parser failure as an RPC rejection", async () => {
    mocks.invoke.mockRejectedValue(
      Object.assign(new Error("response parse failed after socket write"), {
        code: 400,
      })
    );
    const bridge = createBridge();

    await expect(
      bridge.sendMessage({
        chatId: "123",
        text: "**still do not duplicate**",
      })
    ).rejects.toThrow("response parse failed after socket write");

    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("edits structured user-mode messages as native Rich Markdown", async () => {
    mocks.invoke.mockResolvedValueOnce(
      new Api.UpdateShort({
        update: new Api.UpdateEditMessage({
          message: new Api.Message({
            id: 44,
            peerId: new Api.PeerUser({ userId: 123n }),
            date: 1_750_000_003,
            message: "",
          }),
          pts: 2,
          ptsCount: 1,
        }),
        date: 1_750_000_003,
      })
    );
    const bridge = createBridge();

    const edited = await bridge.editMessage({
      chatId: "123",
      messageId: 44,
      text: "# Updated report\n\n**still rich**",
    });

    expect(edited).toEqual({ id: 44, date: 1_750_000_003, chatId: "123" });
    expect(mocks.editMessage).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    const request = mocks.invoke.mock.calls[0][0];
    expect(request).toBeInstanceOf(Api.messages.EditMessage);
    expect(request.id).toBe(44);
    expect(request.message).toBeUndefined();
    expect(request.noWebpage).toBe(true);
    expect(request.richMessage).toBeInstanceOf(Api.InputRichMessageMarkdown);
    expect(request.richMessage.markdown).toBe("# Updated report\n\n**still rich**");
  });

  it("keeps plain edits as classic Telegram messages", async () => {
    const bridge = createBridge();

    const edited = await bridge.editMessage({
      chatId: "123",
      messageId: 44,
      text: "Simple replacement",
    });

    expect(edited).toEqual({ id: 44, date: 1_750_000_002, chatId: "123" });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.editMessage).toHaveBeenCalledWith("123", {
      message: 44,
      text: "Simple replacement",
      parseMode: "html",
      linkPreview: false,
      buttons: undefined,
    });
  });

  it("falls back to a classic edit for deterministic rich-format errors", async () => {
    mocks.invoke.mockRejectedValue(
      Object.assign(new Error("RICH_MESSAGE_INVALID"), {
        code: 400,
        errorMessage: "RICH_MESSAGE_INVALID",
      })
    );
    const bridge = createBridge();

    const edited = await bridge.editMessage({
      chatId: "123",
      messageId: 44,
      text: "**fallback edit**",
    });

    expect(edited).toEqual({ id: 44, date: 1_750_000_002, chatId: "123" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.editMessage).toHaveBeenCalledWith("123", {
      message: 44,
      text: "<b>fallback edit</b>",
      parseMode: "html",
      linkPreview: false,
      buttons: undefined,
    });
  });

  it("does not silently downgrade a rich edit after an ambiguous failure", async () => {
    mocks.invoke.mockRejectedValue(
      Object.assign(new Error("socket response parse timeout"), {
        code: 500,
      })
    );
    const bridge = createBridge();

    await expect(
      bridge.editMessage({
        chatId: "123",
        messageId: 44,
        text: "**do not downgrade**",
      })
    ).rejects.toThrow("socket response parse timeout");

    expect(mocks.editMessage).not.toHaveBeenCalled();
  });
});
