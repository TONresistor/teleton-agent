import { describe, it, expect, vi, beforeEach } from "vitest";
import { telegramSetChannelUsernameExecutor } from "../set-channel-username.js";
import type { ToolContext } from "../../../types.js";

const mockInvoke = vi.fn();
const mockGetEntity = vi.fn();

const mockContext = {
  bridge: {
    getMode: () => "user",
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
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockResolvedValue(true);
  });

  it("sets username successfully", async () => {
    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "my_channel" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).username).toBe("my_channel");
    expect((result.data as any).link).toBe("https://t.me/my_channel");
  });

  it("strips @ prefix", async () => {
    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "@my_channel" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).username).toBe("my_channel");
  });

  it("removes username with empty string", async () => {
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

  it("treats USERNAME_NOT_MODIFIED as success", async () => {
    mockInvoke.mockRejectedValue(new Error("USERNAME_NOT_MODIFIED"));

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username: "same_name" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).message).toContain("No changes");
  });

  it.each([
    ["USERNAME_OCCUPIED", "taken_name", "already taken"],
    ["CHAT_ADMIN_REQUIRED", "valid_name", "admin rights"],
    ["CHANNELS_ADMIN_PUBLIC_TOO_MUCH", "valid_name", "too many public channels"],
    ["USERNAME_PURCHASE_AVAILABLE", "premium_name", "fragment.com"],
  ])("maps %s to a useful error", async (telegramError, username, expectedMessage) => {
    mockInvoke.mockRejectedValue(new Error(telegramError));

    const result = await telegramSetChannelUsernameExecutor(
      { channelId: "100", username },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(expectedMessage);
  });
});
