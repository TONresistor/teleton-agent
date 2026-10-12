import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import { _dispatchUpdate } from "telegram/client/updates.js";
import { toLong } from "../../utils/gramjs-bigint.js";

const mocks = vi.hoisted(() => ({ clients: [] as unknown[], debug: vi.fn() }));
vi.mock("telegram", async (load) => {
  const original = await load<typeof import("telegram")>();
  return {
    ...original,
    TelegramClient: class {
      _eventBuilders: unknown[] = [];
      _selfInputPeer = new original.Api.InputPeerUser({
        userId: toLong(99),
        accessHash: toLong(1),
      });
      _log = { canSend: () => false };
      _entityCache = { get: () => undefined };
      constructor() {
        mocks.clients.push(this);
      }
      addEventHandler(callback: unknown, builder: unknown) {
        this._eventBuilders.push([builder, callback]);
      }
    },
  };
});
vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({ debug: mocks.debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
import { TelegramUserClient } from "../client.js";

describe("private wallet reply routing", () => {
  beforeEach(() => {
    mocks.clients.length = 0;
    vi.clearAllMocks();
  });
  it("stops real GramJS dispatch before ordinary callbacks and DEBUG text logging", async () => {
    vi.stubEnv("DEBUG", "1");
    try {
      const user = new TelegramUserClient({
        apiId: 1,
        apiHash: "test",
        phone: "",
        sessionPath: "/tmp/nonexistent-wallet-test-session",
      });
      const ordinary = vi.fn();
      const privateHandler = vi.fn(async (message: Api.Message) => {
        message.message = "";
        return true;
      });
      user.setPrivateMessageInterceptor(privateHandler);
      user.addNewMessageHandler(ordinary);
      const message = new Api.Message({
        id: 1,
        date: 1,
        peerId: new Api.PeerUser({ userId: toLong(42) }),
        fromId: new Api.PeerUser({ userId: toLong(42) }),
        message: "secret-never-log",
      });
      const update = new Api.UpdateNewMessage({ message, pts: 1, ptsCount: 1 });
      await _dispatchUpdate(mocks.clients[0] as Parameters<typeof _dispatchUpdate>[0], { update });
      expect(privateHandler).toHaveBeenCalledTimes(1);
      expect(ordinary).not.toHaveBeenCalled();
      expect(mocks.debug).not.toHaveBeenCalled();
      expect(message.message).toBe("");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
