import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../../types.js";

const mocks = vi.hoisted(() => ({
  sendRichMessage: vi.fn(),
  validateReadPath: vi.fn(),
  validateFileSize: vi.fn(),
}));

vi.mock("../../../../../workspace/index.js", () => ({
  ALLOWED_EXTENSIONS: {
    images: [".jpg", ".jpeg", ".png", ".webp"],
    video: [".mp4", ".mov", ".avi", ".webm", ".mkv"],
    audio: [".mp3", ".ogg", ".wav", ".m4a", ".opus"],
  },
  WorkspaceSecurityError: class WorkspaceSecurityError extends Error {},
  validateReadPath: mocks.validateReadPath,
  validateFileSize: mocks.validateFileSize,
}));

vi.mock("../../../../../utils/logger.js", () => ({
  createLogger: () => ({
    error: vi.fn(),
  }),
}));

import {
  telegramSendRichMessageExecutor,
  telegramSendRichMessageTool,
} from "../send-rich-message.js";

function context(): ToolContext {
  return {
    bridge: {
      sendRichMessage: mocks.sendRichMessage,
    },
    db: {},
    chatId: "100",
    senderId: 1,
    isGroup: false,
  } as unknown as ToolContext;
}

describe("telegram_send_rich_message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateReadPath.mockImplementation((path: string) => ({
      absolutePath: `/workspace/${path}`,
      relativePath: path,
      exists: true,
      isDirectory: false,
      extension: path.slice(path.lastIndexOf(".")),
      filename: path.split("/").at(-1),
    }));
    mocks.sendRichMessage.mockResolvedValue({
      id: 321,
      date: 1_750_000_000,
      chatId: "100",
    });
  });

  it("advertises native uploaded media inside Rich Markdown", () => {
    expect(telegramSendRichMessageTool.description).toContain("tg://photo?id=");
    expect(telegramSendRichMessageTool.description).toContain("single Rich Message");
  });

  it("validates workspace media and sends one rich message", async () => {
    const result = await telegramSendRichMessageExecutor(
      {
        chatId: "100",
        text: "Before\n\n![Chart](tg://photo?id=chart)\n\nAfter",
        media: [{ id: "chart", type: "photo", path: "uploads/chart.png" }],
        replyToId: 7,
      },
      context()
    );

    expect(result).toEqual({
      success: true,
      data: {
        messageId: 321,
        date: 1_750_000_000,
        mediaCount: 1,
      },
    });
    expect(mocks.validateReadPath).toHaveBeenCalledWith("uploads/chart.png");
    expect(mocks.validateFileSize).toHaveBeenCalledWith("/workspace/uploads/chart.png", "image");
    expect(mocks.sendRichMessage).toHaveBeenCalledWith({
      chatId: "100",
      text: "Before\n\n![Chart](tg://photo?id=chart)\n\nAfter",
      media: [
        {
          id: "chart",
          type: "photo",
          path: "/workspace/uploads/chart.png",
        },
      ],
      replyToId: 7,
    });
  });

  it.each([
    {
      name: "duplicate IDs",
      text: "![One](tg://photo?id=hero)",
      media: [
        { id: "hero", type: "photo", path: "uploads/one.png" },
        { id: "hero", type: "photo", path: "uploads/two.png" },
      ],
      error: "unique",
    },
    {
      name: "missing reference",
      text: "No media reference",
      media: [{ id: "hero", type: "photo", path: "uploads/one.png" }],
      error: "not referenced",
    },
    {
      name: "unknown reference",
      text: "![Unknown](tg://photo?id=missing)",
      media: [{ id: "hero", type: "photo", path: "uploads/one.png" }],
      error: "no matching upload",
    },
    {
      name: "type mismatch",
      text: "![Clip](tg://photo?id=clip)",
      media: [{ id: "clip", type: "video", path: "uploads/clip.mp4" }],
      error: "type",
    },
    {
      name: "invalid ID",
      text: "![Bad](tg://photo?id=bad$id)",
      media: [{ id: "bad$id", type: "photo", path: "uploads/one.png" }],
      error: "ID",
    },
    {
      name: "truncated long reference ID",
      text: `![Bad](tg://photo?id=${"a".repeat(65)})`,
      media: [{ id: "a".repeat(64), type: "photo", path: "uploads/one.png" }],
      error: "complete",
    },
    {
      name: "reference inside fenced code",
      text: "```\n![Not media](tg://photo?id=hero)\n```",
      media: [{ id: "hero", type: "photo", path: "uploads/one.png" }],
      error: "not referenced",
    },
    {
      name: "reference inside inline code",
      text: "`![Not media](tg://photo?id=hero)`",
      media: [{ id: "hero", type: "photo", path: "uploads/one.png" }],
      error: "not referenced",
    },
    {
      name: "reference inside multiline inline code",
      text: "`code starts\n![Not media](tg://photo?id=hero)\nends here`",
      media: [{ id: "hero", type: "photo", path: "uploads/one.png" }],
      error: "not referenced",
    },
    {
      name: "escaped image marker",
      text: "\\![Not media](tg://photo?id=hero)",
      media: [{ id: "hero", type: "photo", path: "uploads/one.png" }],
      error: "Invalid Rich Markdown",
    },
    {
      name: "non-image Markdown link",
      text: "[Not media](tg://photo?id=hero)",
      media: [{ id: "hero", type: "photo", path: "uploads/one.png" }],
      error: "Invalid Rich Markdown",
    },
    {
      name: "extension mismatch",
      text: "![Bad](tg://photo?id=clip)",
      media: [{ id: "clip", type: "photo", path: "uploads/clip.mp4" }],
      error: "extension",
    },
  ])("rejects $name before uploading", async ({ text, media, error }) => {
    const result = await telegramSendRichMessageExecutor(
      {
        chatId: "100",
        text,
        media,
      },
      context()
    );

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain(error);
    expect(mocks.sendRichMessage).not.toHaveBeenCalled();
  });

  it("returns a workspace security error without uploading", async () => {
    mocks.validateReadPath.mockImplementation(() => {
      const error = new Error("outside workspace");
      error.name = "WorkspaceSecurityError";
      throw error;
    });

    const result = await telegramSendRichMessageExecutor(
      {
        chatId: "100",
        text: "![Secret](tg://photo?id=secret)",
        media: [{ id: "secret", type: "photo", path: "/etc/secret.png" }],
      },
      context()
    );

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain("workspace");
    expect(mocks.sendRichMessage).not.toHaveBeenCalled();
  });
});
