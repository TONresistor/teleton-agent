import { describe, it, expect, vi, beforeEach } from "vitest";
import { telegramCreateChannelExecutor } from "../create-channel.js";
import type { ToolContext } from "../../../types.js";

const mockInvoke = vi.fn();

const mockContext = {
  bridge: {
    getClient: () => ({
      getClient: () => ({
        invoke: mockInvoke,
      }),
    }),
  },
  chatId: "123",
  senderId: 456,
  isGroup: false,
} as unknown as ToolContext;

const fakeCreateResult = {
  chats: [{ id: 200n, accessHash: 999n }],
};

describe("telegram_create_channel with username", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates channel without username (unchanged behavior)", async () => {
    mockInvoke.mockResolvedValue(fakeCreateResult);

    const result = await telegramCreateChannelExecutor({ title: "Test Channel" }, mockContext);

    expect(result.success).toBe(true);
    expect((result.data as any).title).toBe("Test Channel");
    expect((result.data as any).username).toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("creates channel and sets username successfully", async () => {
    mockInvoke
      .mockResolvedValueOnce(fakeCreateResult) // CreateChannel
      .mockResolvedValueOnce(true); // UpdateUsername

    const result = await telegramCreateChannelExecutor(
      { title: "Test Channel", username: "my_channel" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).username).toBe("my_channel");
    expect((result.data as any).link).toBe("https://t.me/my_channel");
    expect((result.data as any).usernameError).toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("strips @ from username param", async () => {
    mockInvoke.mockResolvedValueOnce(fakeCreateResult).mockResolvedValueOnce(true);

    const result = await telegramCreateChannelExecutor(
      { title: "Test", username: "@my_channel" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).username).toBe("my_channel");
  });

  it("creates channel but reports username error when taken", async () => {
    mockInvoke
      .mockResolvedValueOnce(fakeCreateResult) // CreateChannel succeeds
      .mockRejectedValueOnce(new Error("USERNAME_OCCUPIED")); // UpdateUsername fails

    const result = await telegramCreateChannelExecutor(
      { title: "Test Channel", username: "taken_name" },
      mockContext
    );

    expect(result.success).toBe(true); // Channel still created
    expect((result.data as any).channelId).toBe("200");
    expect((result.data as any).usernameError).toContain("already taken");
    expect((result.data as any).username).toBeUndefined();
  });

  it("creates channel but reports validation error for bad username", async () => {
    mockInvoke.mockResolvedValueOnce(fakeCreateResult);

    const result = await telegramCreateChannelExecutor(
      { title: "Test Channel", username: "ab" },
      mockContext
    );

    expect(result.success).toBe(true); // Channel still created
    expect((result.data as any).usernameError).toContain("Invalid username format");
    expect(mockInvoke).toHaveBeenCalledTimes(1); // Only CreateChannel, no UpdateUsername
  });

  it("creates channel but reports CHANNELS_ADMIN_PUBLIC_TOO_MUCH", async () => {
    mockInvoke
      .mockResolvedValueOnce(fakeCreateResult)
      .mockRejectedValueOnce(new Error("CHANNELS_ADMIN_PUBLIC_TOO_MUCH"));

    const result = await telegramCreateChannelExecutor(
      { title: "Test", username: "valid_name" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).usernameError).toContain("Too many public channels");
  });

  it("creates channel but reports USERNAME_PURCHASE_AVAILABLE", async () => {
    mockInvoke
      .mockResolvedValueOnce(fakeCreateResult)
      .mockRejectedValueOnce(new Error("USERNAME_PURCHASE_AVAILABLE"));

    const result = await telegramCreateChannelExecutor(
      { title: "Test", username: "premium_name" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).usernameError).toContain("fragment.com");
  });

  it("rejects username ending with underscore", async () => {
    mockInvoke.mockResolvedValueOnce(fakeCreateResult);

    const result = await telegramCreateChannelExecutor(
      { title: "Test", username: "bad_name_" },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as any).usernameError).toContain("Invalid username format");
  });
});
