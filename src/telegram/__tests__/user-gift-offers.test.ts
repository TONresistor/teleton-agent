import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import { toLong } from "../../utils/gramjs-bigint.js";
import { GramJSUserBridge } from "../bridges/user.js";

const { addServiceMessageHandler } = vi.hoisted(() => ({
  addServiceMessageHandler: vi.fn<(handler: (msg: Api.MessageService) => Promise<void>) => void>(),
}));

vi.mock("../client.js", () => ({
  TelegramUserClient: class {
    addServiceMessageHandler = addServiceMessageHandler;
  },
}));

const gift = new Api.StarGiftUnique({
  id: toLong(1),
  giftId: toLong(2),
  title: "Plush",
  slug: "Plush-1",
  num: 1,
  attributes: [],
  availabilityIssued: 1,
  availabilityTotal: 2,
});
const sender = new Api.PeerUser({ userId: toLong(42) });
const expiresAt = 1_750_000_000;

function onchainOffer(
  flags: Partial<ConstructorParameters<typeof Api.MessageActionStarGiftOnchainOffer>[0]> = {}
) {
  return new Api.MessageActionStarGiftOnchainOffer({
    gift,
    offerId: toLong(1),
    amount: toLong("1500000001"),
    feeBps: 100,
    expiresAt,
    offerAddress: "fixture",
    ...flags,
  });
}

async function receive(
  action: Api.TypeMessageAction,
  options: { out?: boolean; peerId?: Api.TypePeer } = {}
) {
  const bridge = new GramJSUserBridge({
    apiId: 1,
    apiHash: "test",
    phone: "+10000000000",
    sessionPath: "/tmp",
  });
  const handler = vi.fn();
  bridge.onServiceMessage(handler);

  const message = new Api.MessageService({
    id: 17,
    peerId: options.peerId ?? sender,
    fromId: sender,
    date: expiresAt - 60,
    out: options.out,
    action,
  });
  vi.spyOn(message, "getSender").mockResolvedValue(
    new Api.User({ id: toLong(42), firstName: "Test" })
  );
  await addServiceMessageHandler.mock.calls[0][0](message);
  return handler;
}

describe("gift offer service messages", () => {
  beforeEach(() => {
    addServiceMessageHandler.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [{}, "pending"],
    [{ accepted: true }, "accepted"],
    [{ accepted: true, settled: true }, "settled"],
    [{ cancelling: true }, "cancelling"],
    [{ cancelling: true, cancelled: true }, "cancelled"],
    [{ declined: true }, "declined"],
    [{ expired: true }, "expired"],
  ] as const)("delivers an on-chain offer with its Telegram flags %j", async (flags, status) => {
    const handler = await receive(onchainOffer(flags));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "42",
        senderId: 42,
        text: `[On-chain Gift Offer]\nGift: "Plush" (slug: Plush-1)\nOffer: 1.500000001 TON\nExpires: ${new Date(expiresAt * 1000).toISOString()}\nStatus: ${status}`,
      })
    );
  });

  it("keeps outgoing offers out of the incoming message pipeline", async () => {
    const handler = await receive(onchainOffer(), { out: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps the group context on an offer received outside a DM", async () => {
    const handler = await receive(onchainOffer(), {
      peerId: new Api.PeerChat({ chatId: toLong(15) }),
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ isGroup: true, mentionsMe: false })
    );
  });

  it("uses the actual currency for classic offers, declines and expirations", async () => {
    const price = new Api.StarsTonAmount({ amount: toLong("1250000000") });
    const actions = [
      new Api.MessageActionStarGiftPurchaseOffer({ gift, price, expiresAt }),
      new Api.MessageActionStarGiftPurchaseOfferDeclined({ gift, price }),
      new Api.MessageActionStarGiftPurchaseOfferDeclined({ gift, price, expired: true }),
    ];

    for (const action of actions) {
      addServiceMessageHandler.mockClear();
      const handler = await receive(action);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("1.25 TON") })
      );
    }
  });
});
