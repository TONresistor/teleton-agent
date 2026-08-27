import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../types.js";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  validateReadPath: vi.fn(),
  validateFileSize: vi.fn(),
}));

vi.mock("../../../../../workspace/index.js", () => ({
  ALLOWED_EXTENSIONS: {
    images: [".jpg", ".jpeg", ".png", ".webp"],
    video: [".mp4"],
    audio: [".mp3"],
    documents: [".pdf", ".txt"],
  },
  WorkspaceSecurityError: class WorkspaceSecurityError extends Error {},
  validateReadPath: mocks.validateReadPath,
  validateFileSize: mocks.validateFileSize,
}));

import { telegramSendMessageExecutor, telegramSendMessageTool } from "../send-message.js";

function context(mode: "user" | "bot" = "user", admin = true): ToolContext {
  return {
    bridge: {
      getMode: () => mode,
      sendMessage: mocks.sendMessage,
    },
    db: {},
    chatId: "current",
    senderId: 7,
    isGroup: false,
    config: { telegram: { admin_ids: admin ? [7] : [] } },
  } as unknown as ToolContext;
}

describe("telegram_send_message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendMessage.mockResolvedValue({ id: 321, date: 1_750_000_000, chatId: "current" });
    mocks.validateReadPath.mockImplementation((path: string) => ({
      absolutePath: `/workspace/${path}`,
      relativePath: path,
      exists: true,
      isDirectory: false,
      extension: path.slice(path.lastIndexOf(".")),
      filename: path.split("/").at(-1),
    }));
  });

  it("keeps text sending backward compatible and defaults to the current chat", async () => {
    const result = await telegramSendMessageExecutor({ text: "hello" }, context());

    expect(result).toEqual({
      success: true,
      data: {
        messageId: 321,
        date: 1_750_000_000,
        chatId: "current",
        deliveryKind: "text",
        renderedText: "hello",
        hasMedia: false,
        mediaType: undefined,
      },
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      chatId: "current",
      text: "hello",
      replyToId: undefined,
      rich: undefined,
    });
  });

  it("sends one structured message with URL and copy buttons", async () => {
    const rich = {
      buttonRows: [
        {
          align: "center" as const,
          buttons: [
            {
              label: "Open",
              action: { type: "url" as const, url: "https://example.com" },
              style: "primary" as const,
            },
            { label: "Copy", action: { type: "copy" as const, text: "TON" } },
          ],
        },
      ],
    };

    const result = await telegramSendMessageExecutor({ text: "Choose", rich }, context());

    expect(result).toMatchObject({
      success: true,
      data: {
        deliveryKind: "rich",
        chatId: "current",
        hasMedia: false,
      },
    });
    expect((result.data as { renderedText: string }).renderedText).toContain(
      '<tg-button type="copy_text" text="TON">Copy</tg-button>'
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      chatId: "current",
      text: "Choose",
      replyToId: undefined,
      rich,
    });
  });

  it("resolves admin attachment paths before sending", async () => {
    const result = await telegramSendMessageExecutor(
      {
        rich: {
          attachments: [{ id: "report", type: "document", path: "uploads/report.pdf" }],
        },
      },
      context()
    );

    expect(result).toMatchObject({
      success: true,
      data: { deliveryKind: "rich", hasMedia: true, mediaType: "document" },
    });
    expect(mocks.validateReadPath).toHaveBeenCalledWith("uploads/report.pdf");
    expect(mocks.validateFileSize).toHaveBeenCalledWith(
      "/workspace/uploads/report.pdf",
      "document"
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        rich: {
          attachments: [
            {
              id: "report",
              type: "document",
              path: "/workspace/uploads/report.pdf",
            },
          ],
        },
      })
    );
  });

  it("rejects local attachment access before revealing path information to non-admins", async () => {
    const result = await telegramSendMessageExecutor(
      {
        rich: {
          attachments: [{ id: "secret", type: "document", path: "/etc/passwd.pdf" }],
        },
      },
      context("user", false)
    );

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain("administrators");
    expect(mocks.validateReadPath).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects structured fields in bot mode", async () => {
    const result = await telegramSendMessageExecutor(
      {
        text: "Choose",
        rich: {
          buttonRows: [{ buttons: [{ label: "Copy", action: { type: "copy", text: "x" } }] }],
        },
      },
      context("bot")
    );

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain("user mode");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("exposes one canonical tool with optional rich structure", () => {
    expect(telegramSendMessageTool.description).toContain("native user-mode Rich Message");
    expect(telegramSendMessageTool.description).not.toContain("telegram_send_rich_message");
  });
});
