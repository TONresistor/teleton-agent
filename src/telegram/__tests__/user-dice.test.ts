import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";

const mocks = vi.hoisted(() => ({
  sendFile: vi.fn(),
}));

vi.mock("../client.js", () => ({
  TelegramUserClient: class {
    getClient() {
      return {
        sendFile: mocks.sendFile,
      };
    }
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

import { GramJSUserBridge } from "../bridges/user.js";

describe("GramJSUserBridge dice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendFile.mockResolvedValue({
      id: 321,
      date: 1_750_000_000,
      dice: new Api.MessageMediaDice({
        emoticon: "🎲",
        value: 6,
      }),
    });
  });

  it("returns the dice value from the message returned by GramJS", async () => {
    const bridge = new GramJSUserBridge({
      apiId: 1,
      apiHash: "test",
      phone: "+10000000000",
      sessionPath: "/tmp/teleton-dice-test",
    });

    const sent = await bridge.sendDice("123", "🎲");

    expect(sent).toEqual({
      id: 321,
      date: 1_750_000_000,
      chatId: "123",
      value: 6,
    });
    expect(mocks.sendFile).toHaveBeenCalledOnce();
    const [chatId, options] = mocks.sendFile.mock.calls[0];
    expect(chatId).toBe("123");
    expect(options.file).toBeInstanceOf(Api.InputMediaDice);
    expect(options.file.emoticon).toBe("🎲");
  });
});
