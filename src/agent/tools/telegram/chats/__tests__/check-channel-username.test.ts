import { describe, it, expect, vi, beforeEach } from "vitest";
import { telegramCheckChannelUsernameExecutor } from "../check-channel-username.js";
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

describe("telegram_check_channel_username", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns available: true when username is free", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockResolvedValue(true);

    const result = await telegramCheckChannelUsernameExecutor(
      { channelId: "100", username: "my_channel" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).available).toBe(true);
    expect((result.data as any).username).toBe("my_channel");
  });

  it("returns available: false when username is taken", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockResolvedValue(false);

    const result = await telegramCheckChannelUsernameExecutor(
      { channelId: "100", username: "taken_name" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).available).toBe(false);
  });

  it("strips @ prefix from username", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockResolvedValue(true);

    const result = await telegramCheckChannelUsernameExecutor(
      { channelId: "100", username: "@my_channel" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).username).toBe("my_channel");
  });

  it("rejects invalid username format (too short)", async () => {
    const result = await telegramCheckChannelUsernameExecutor(
      { channelId: "100", username: "ab" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid username format");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("rejects username starting with underscore", async () => {
    const result = await telegramCheckChannelUsernameExecutor(
      { channelId: "100", username: "_bad_name" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid username format");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("rejects non-channel entity", async () => {
    mockGetEntity.mockResolvedValue({ className: "User", id: 100n });

    const result = await telegramCheckChannelUsernameExecutor(
      { channelId: "100", username: "valid_name" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not a channel/group");
  });

  it("handles CHANNELS_ADMIN_PUBLIC_TOO_MUCH error", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockRejectedValue(new Error("CHANNELS_ADMIN_PUBLIC_TOO_MUCH"));

    const result = await telegramCheckChannelUsernameExecutor(
      { channelId: "100", username: "valid_name" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("too many public channels");
  });

  it("handles USERNAME_PURCHASE_AVAILABLE error", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockRejectedValue(new Error("USERNAME_PURCHASE_AVAILABLE"));

    const result = await telegramCheckChannelUsernameExecutor(
      { channelId: "100", username: "premium_name" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).purchaseAvailable).toBe(true);
    expect((result.data as any).message).toContain("fragment.com");
  });

  it("handles USERNAME_INVALID error from API", async () => {
    mockGetEntity.mockResolvedValue({ className: "Channel", id: 100n });
    mockInvoke.mockRejectedValue(new Error("USERNAME_INVALID"));

    const result = await telegramCheckChannelUsernameExecutor(
      { channelId: "100", username: "valid_name" },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid username format");
  });
});
