import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import type { ToolContext } from "../../../types.js";
import { telegramJoinChannelExecutor } from "../join-channel.js";

const invoke = vi.fn();
const getEntity = vi.fn();

const context = {
  bridge: {
    getMode: () => "user",
    getClient: () => ({
      getClient: () => ({ invoke, getEntity }),
    }),
  },
  chatId: "123",
  senderId: 456,
  isGroup: false,
} as unknown as ToolContext;

function channel(): Api.Channel {
  return new Api.Channel({
    id: 123n,
    accessHash: 456n,
    title: "Test Channel",
    username: "test_channel",
    broadcast: true,
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
  });
}

function joinOk(chats: Api.TypeChat[] = []): Api.messages.ChatInviteJoinResultOk {
  return new Api.messages.ChatInviteJoinResultOk({
    updates: new Api.Updates({
      updates: [],
      users: [],
      chats,
      date: 0,
      seq: 0,
    }),
  });
}

function guardBotResult(): Api.messages.ChatInviteJoinResultWebView {
  return new Api.messages.ChatInviteJoinResultWebView({
    botId: 777n,
    queryId: 888n,
    users: [],
  });
}

describe("telegram_join_channel", () => {
  beforeEach(() => {
    invoke.mockReset();
    getEntity.mockReset();
  });

  it("unwraps Layer 228 updates when joining through a private invite", async () => {
    invoke.mockResolvedValueOnce({}).mockResolvedValueOnce(joinOk([channel()]));

    const result = await telegramJoinChannelExecutor(
      { channel: "https://t.me/+InviteHash" },
      context
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        channelId: "123",
        channelTitle: "Test Channel",
        message: "Successfully joined Test Channel",
      },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0]?.[0]).toBeInstanceOf(Api.messages.CheckChatInvite);
    expect(invoke.mock.calls[1]?.[0]).toBeInstanceOf(Api.messages.ImportChatInvite);
  });

  it("ignores unsupported private guard-bot joins without reporting success", async () => {
    invoke.mockResolvedValueOnce({}).mockResolvedValueOnce(guardBotResult());

    const result = await telegramJoinChannelExecutor(
      { channel: "https://t.me/+GuardedInvite" },
      context
    );

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toContain("interactive guard bot");
    expect(result.error).toContain("channel was not joined");
    expect(result.error).not.toContain("777");
    expect(result.error).not.toContain("888");
  });

  it("unwraps Layer 228 updates when joining a public channel", async () => {
    const publicChannel = channel();
    getEntity.mockResolvedValue(publicChannel);
    invoke.mockResolvedValue(joinOk());

    const result = await telegramJoinChannelExecutor({ channel: "@test_channel" }, context);

    expect(result).toMatchObject({
      success: true,
      data: {
        channelId: "123",
        channelTitle: "Test Channel",
        message: "Successfully joined Test Channel",
      },
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[0]).toBeInstanceOf(Api.channels.JoinChannel);
  });

  it("ignores unsupported public guard-bot joins without reporting success", async () => {
    getEntity.mockResolvedValue(channel());
    invoke.mockResolvedValue(guardBotResult());

    const result = await telegramJoinChannelExecutor({ channel: "@test_channel" }, context);

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toContain("interactive guard bot");
    expect(result.error).toContain("channel was not joined");
  });

  it("keeps the existing already-member behavior for private invites", async () => {
    invoke.mockResolvedValue(new Api.ChatInviteAlready({ chat: channel() }));

    const result = await telegramJoinChannelExecutor(
      { channel: "https://t.me/+ExistingInvite" },
      context
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        channelId: "123",
        channelTitle: "Test Channel",
        message: "Already a member of Test Channel",
      },
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it.each([
    ["INVITE_HASH_INVALID", "Invalid invite link"],
    ["INVITE_HASH_EXPIRED", "invite link has expired"],
    ["CHANNELS_TOO_MUCH", "joined too many channels"],
  ])("keeps the existing %s error mapping", async (telegramError, expectedMessage) => {
    invoke.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error(telegramError));

    const result = await telegramJoinChannelExecutor(
      { channel: "https://t.me/+RejectedInvite" },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(expectedMessage);
  });

  it("keeps join requests as a successful submission", async () => {
    invoke.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("INVITE_REQUEST_SENT"));

    const result = await telegramJoinChannelExecutor(
      { channel: "https://t.me/+ApprovalInvite" },
      context
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        message: "Join request sent. Waiting for admin approval.",
      },
    });
  });
});
