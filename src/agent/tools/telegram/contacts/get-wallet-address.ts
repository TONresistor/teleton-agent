import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { getClient } from "../../../../sdk/telegram-utils.js";
import { walletError } from "../wallet/reads.js";

interface GetWalletAddressParams {
  user: string;
}

export const telegramGetWalletAddressTool: Tool = {
  name: "telegram_get_wallet_address",
  description:
    "Resolve a Telegram user ID or @username to the wallet address returned by Telegram. Returns available=false if Telegram returns no address for that user. Does not infer addresses from profile text or send funds.",
  category: "data-bearing",
  parameters: Type.Object({
    user: Type.String({
      minLength: 1,
      description: "Telegram user ID or @username. Channels and groups are not supported.",
    }),
  }),
};

export const telegramGetWalletAddressExecutor: ToolExecutor<GetWalletAddressParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const user = params.user.trim();
    if (!user) return { success: false, error: "User ID or @username is required" };
    const client = getClient(context.bridge);
    const entity = await client.getEntity(user);
    if (!(entity instanceof Api.User)) {
      return {
        success: false,
        error: "The target must be a Telegram user, not a group or channel",
      };
    }
    const peer = await client.getInputEntity(entity);
    if (!(peer instanceof Api.InputPeerUser) && !(peer instanceof Api.InputPeerSelf)) {
      return { success: false, error: "Could not resolve the user's Telegram access credentials" };
    }
    const result = await client.invoke(
      new Api.wallet.GetUserAddresses({
        id: [
          peer instanceof Api.InputPeerSelf
            ? new Api.InputUserSelf()
            : new Api.InputUser({ userId: peer.userId, accessHash: peer.accessHash }),
        ],
        addresses: [],
      })
    );
    const wallet = result.addresses.find(
      (entry) => entry.userId?.toString() === entity.id.toString() && entry.address.length > 0
    );
    return {
      success: true,
      data: {
        userId: entity.id.toString(),
        username: entity.username ?? null,
        available: !!wallet,
        address: wallet?.address ?? null,
        source: "telegram.wallet.getUserAddresses",
      },
    };
  } catch (error) {
    return { success: false, error: walletError(error) };
  }
};
