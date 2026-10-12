import { beforeEach, describe, expect, it, vi } from "vitest";
import { Api } from "telegram";
import type { ToolContext } from "../../../types.js";
import { toLong } from "../../../../../utils/gramjs-bigint.js";
import { telegramGetWalletAddressExecutor } from "../get-wallet-address.js";

const invoke = vi.fn();
const getEntity = vi.fn();
const getInputEntity = vi.fn();
const context = {
  bridge: {
    getMode: () => "user",
    getClient: () => ({ getClient: () => ({ invoke, getEntity, getInputEntity }) }),
  },
} as unknown as ToolContext;

function address(userId: number, value: string) {
  return new Api.WalletUserAddress({
    userId: toLong(userId),
    address: value,
    publicKey: Buffer.alloc(32),
  });
}

describe("telegram_get_wallet_address", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getEntity.mockResolvedValue(new Api.User({ id: toLong(42), username: "alice" }));
    getInputEntity.mockResolvedValue(
      new Api.InputPeerUser({ userId: toLong(42), accessHash: toLong(99) })
    );
  });

  it("selects only the requested user's address and preserves the access hash", async () => {
    invoke.mockResolvedValue(
      new Api.wallet.UserAddresses({
        addresses: [address(7, "other"), address(42, "EQ-alice")],
        users: [],
      })
    );
    expect(await telegramGetWalletAddressExecutor({ user: "@alice" }, context)).toMatchObject({
      success: true,
      data: { userId: "42", available: true, address: "EQ-alice" },
    });
    const request = invoke.mock.calls[0][0] as Api.wallet.GetUserAddresses;
    expect(request).toBeInstanceOf(Api.wallet.GetUserAddresses);
    expect(request.addresses).toEqual([]);
    expect((request.id[0] as Api.InputUser).accessHash.toString()).toBe("99");
  });

  it("returns unavailable rather than using another user's address", async () => {
    invoke.mockResolvedValue(
      new Api.wallet.UserAddresses({ addresses: [address(7, "other")], users: [] })
    );
    expect(await telegramGetWalletAddressExecutor({ user: "42" }, context)).toMatchObject({
      success: true,
      data: { available: false, address: null },
    });
  });

  it("supports the owner via InputUserSelf", async () => {
    getInputEntity.mockResolvedValue(new Api.InputPeerSelf());
    invoke.mockResolvedValue(
      new Api.wallet.UserAddresses({ addresses: [address(42, "EQ-owner")], users: [] })
    );
    await telegramGetWalletAddressExecutor({ user: "me" }, context);
    expect(invoke.mock.calls[0][0].id[0]).toBeInstanceOf(Api.InputUserSelf);
  });

  it("rejects channels before querying the wallet API", async () => {
    getEntity.mockResolvedValue(
      new Api.ChannelForbidden({ id: toLong(1), accessHash: toLong(2), title: "channel" })
    );
    expect(await telegramGetWalletAddressExecutor({ user: "@channel" }, context)).toMatchObject({
      success: false,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("preserves Telegram RPC failures", async () => {
    invoke.mockRejectedValue(new Error("METHOD_INVALID"));
    expect(await telegramGetWalletAddressExecutor({ user: "@alice" }, context)).toEqual({
      success: false,
      error: "METHOD_INVALID",
    });
  });
});
