import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import { toLong } from "../../utils/gramjs-bigint.js";
import type { TelegramMessage } from "../bridge-interface.js";

const mocks = vi.hoisted(() => ({ addServiceMessageHandler: vi.fn(), invoke: vi.fn() }));
vi.mock("../client.js", () => ({
  TelegramUserClient: class {
    addServiceMessageHandler = mocks.addServiceMessageHandler;
    getClient() {
      return { invoke: mocks.invoke };
    }
  },
}));
import { GramJSUserBridge } from "../bridges/user.js";

async function deliver(action: Api.TypeMessageAction, out = false, group = false) {
  const bridge = new GramJSUserBridge({
    apiId: 1,
    apiHash: "test",
    phone: "",
    sessionPath: "/tmp",
  });
  const handler = vi.fn<(message: TelegramMessage) => void>();
  bridge.onServiceMessage(handler);
  const msg = new Api.MessageService({
    id: 17,
    date: 1_800_000_000,
    out,
    action,
    peerId: group
      ? new Api.PeerChat({ chatId: toLong(123) })
      : new Api.PeerUser({ userId: toLong(42) }),
    fromId: new Api.PeerUser({ userId: toLong(42) }),
  });
  vi.spyOn(msg, "getSender").mockResolvedValue(new Api.User({ id: toLong(42), username: "alice" }));
  await mocks.addServiceMessageHandler.mock.calls[0][0](msg);
  return handler;
}

describe("Layer 230 wallet service messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delivers transfer identifiers and preserves exact large amounts", async () => {
    const handler = await deliver(
      new Api.MessageActionGramTransfer({
        amount: toLong("9007199254740993"),
        peerAddress: "EQ-peer",
        transactionId: "tx-1",
        comment: "payment",
      }),
      false,
      true
    );
    const message = handler.mock.calls[0][0];
    expect(message.text).toContain("9007199254740993");
    expect(message.text).toContain("EQ-peer");
    expect(message.text).toContain("tx-1");
    expect(message.text).toContain("payment");
    expect(message.isGroup).toBe(true);
    expect(message.isChannel).toBe(false);
  });

  it("does not expose ciphertext as a readable comment", async () => {
    const handler = await deliver(
      new Api.MessageActionGramTransfer({
        amount: toLong(1),
        peerAddress: "EQ-peer",
        transactionId: "tx-1",
        commentEncrypted: true,
        comment: "ciphertext",
      })
    );
    expect(handler.mock.calls[0][0].text).toContain("[encrypted]");
    expect(handler.mock.calls[0][0].text).not.toContain("ciphertext");
  });

  it.each([
    [{}, "pending", 2_000_000_000],
    [{ accepted: true }, "accepted", 1],
    [{ declined: true }, "declined", 1],
    [{}, "expired", 1],
  ] as const)("renders TON Connect status %s", async (flags, status, expires) => {
    const handler = await deliver(
      new Api.MessageActionWalletTonConnectRequest({
        ...flags,
        sessionId: toLong("9007199254740993"),
        expires,
        dappName: "Example",
        topic: "topic",
        traceId: "trace",
      })
    );
    const text = handler.mock.calls[0][0].text;
    expect(text).toContain(`Status: ${status}`);
    expect(text).toContain("Session ID: 9007199254740993");
    expect(text).toContain("DApp: Example");
    expect(text).toContain("Message ID: 17");
    expect(text).toContain("Topic: topic");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("ignores outgoing service messages", async () => {
    const handler = await deliver(
      new Api.MessageActionGramTransfer({
        amount: toLong(1),
        peerAddress: "EQ-peer",
        transactionId: "tx-1",
      }),
      true
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("continues ignoring unrelated service messages", async () => {
    const handler = await deliver(new Api.MessageActionEmpty());
    expect(handler).not.toHaveBeenCalled();
  });
});
