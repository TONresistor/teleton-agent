import { describe, it, expect, vi, beforeEach } from "vitest";
import { telegramSetChannelUsernameExecutor } from "../set-channel-username.js";
import type { ToolContext } from "../../../types.js";

const mockInvoke = vi.fn();
const mockGetEntity = vi.fn();

const mockContext = {
  bridge: {
    getClient: () => ({
      getClient: () => ({
        invoke: mockInvoke,
        getEntity: mockGetEntity,
      }),
    }),
  },
  chatId: "123",
  senderId: 456,
  isGroup: false,
} as unknown as ToolContext;

describe("telegram_set_channel_username", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets username successfully", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockResolvedValue(true);

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "my_channel" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).username).toBe("my_channel");
    expect((result.data as any).link).toBe("https://t.me/my_channel");
  });

  it("strips @ prefix", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockResolvedValue(true);

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "@my_channel" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).username).toBe("my_channel");
  });

  it("removes username with empty string", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockResolvedValue(true);

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).username).toBeNull();
    expect((result.data as any).link).toBeNull();
  });

  it("rejects invalid username format", async () => {
    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "ab" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid username format");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("rejects non-channel entity", async () => {
    mockGetEntity.mockResolvedValue({ className: "User", id: 100n });

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "valid_name" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not a channel/group");
  });

  it("handles USERNAME_OCCUPIED", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockRejectedValue(new Error("USERNAME_OCCUPIED"));

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "taken_name" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("already taken");
  });

  it("treats USERNAME_NOT_MODIFIED as success", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockRejectedValue(new Error("USERNAME_NOT_MODIFIED"));

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "same_name" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).message).toContain("No changes");
  });

  it("handles CHAT_ADMIN_REQUIRED", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockRejectedValue(new Error("CHAT_ADMIN_REQUIRED"));

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "valid_name" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("admin rights");
  });

  it("handles CHANNELS_ADMIN_PUBLIC_TOO_MUCH", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockRejectedValue(new Error("CHANNELS_ADMIN_PUBLIC_TOO_MUCH"));

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "valid_name" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("too many public channels");
  });

  it("handles USERNAME_PURCHASE_AVAILABLE", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockRejectedValue(new Error("USERNAME_PURCHASE_AVAILABLE"));

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "premium_name" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("fragment.com");
  });
});
