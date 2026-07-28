import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import type { ToolContext } from "../../../types.js";
import { telegramGetHistoryExecutor } from "../../chats/get-history.js";
import { telegramSearchMessagesExecutor } from "../search-messages.js";

const getMessages = vi.fn();
const getEntity = vi.fn();
const invoke = vi.fn();

const context = {
  bridge: {
    getMode: () => "user",
    getPeer: () => undefined,
    getClient: () => ({
      getClient: () => ({ getMessages, getEntity, invoke }),
    }),
  },
  chatId: "123",
  senderId: 456,
  isGroup: false,
} as unknown as ToolContext;

function richMessage(): Api.Message {
  return new Api.Message({
    id: 13008,
    peerId: new Api.PeerChannel({ channelId: 3525458001n }),
    date: 1_753_660_800,
    message: "",
    richMessage: new Api.RichMessage({
      blocks: [
        new Api.PageBlockHeading1({
          text: new Api.TextPlain({ text: "Teleton Rich Text Demo" }),
        }),
      ],
      photos: [],
      documents: [],
    }),
  } as any);
}

describe("Rich Message tool output", () => {
  beforeEach(() => {
    getMessages.mockReset();
    getEntity.mockReset();
    invoke.mockReset();
  });

  it("returns Rich Message content from telegram_get_history", async () => {
    getMessages.mockResolvedValue([richMessage()]);

    const result = await telegramGetHistoryExecutor(
      { chatId: "-1003525458001", limit: 10 },
      context
    );

    expect(result.success).toBe(true);
    expect((result.data as any).messages[0]).toMatchObject({
      id: 13008,
      text: "# Teleton Rich Text Demo",
    });
  });

  it("returns Rich Message content from telegram_search_messages", async () => {
    const entity = new Api.InputPeerChannel({
      channelId: 3525458001n,
      accessHash: 1n,
    });
    getEntity.mockResolvedValue(entity);
    invoke.mockResolvedValue(
      new Api.messages.Messages({
        messages: [richMessage()],
        chats: [],
        users: [],
      })
    );

    const result = await telegramSearchMessagesExecutor(
      {
        chatId: "-1003525458001",
        query: "Teleton",
        limit: 10,
      },
      context
    );

    expect(result.success).toBe(true);
    expect((result.data as any).messages[0]).toMatchObject({
      id: 13008,
      text: "# Teleton Rich Text Demo",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
