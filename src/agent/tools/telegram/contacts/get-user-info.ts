import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for getting user info
 */
interface GetUserInfoParams {
  userId?: string;
  username?: string;
}

/**
 * Tool definition for getting user information
 */
export const telegramGetUserInfoTool: Tool = {
  name: "telegram_get_user_info",
  description: `Get detailed information about a Telegram user.

USAGE:
- By username: pass username (with or without @)
- By ID: pass userId

RETURNS:
- Basic info: id, username, firstName, lastName, phone (if visible)
- Status: isBot, isPremium, isVerified, isScam, isFake
- Bio/about (if public)
- Photo info (if available)
- Common chats count

Use this to learn about traders, verify users, or gather intel.`,
  parameters: Type.Object({
    userId: Type.Optional(
      Type.String({
        description: "User ID to look up",
      })
    ),
    username: Type.Optional(
      Type.String({
        description: "Username to look up (with or without @)",
      })
    ),
  }),
};

/**
 * Executor for telegram_get_user_info tool
 */
export const telegramGetUserInfoExecutor: ToolExecutor<GetUserInfoParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { userId, username } = params;

    if (!userId && !username) {
      return {
        success: false,
        error: "Must provide either userId or username",
      };
    }

    const gramJsClient = context.bridge.getClient().getClient();

    // Resolve the user entity
    let entity: Api.User;
    try {
      if (username) {
        const cleanUsername = username.replace("@", "");
        entity = (await gramJsClient.getEntity(cleanUsername)) as Api.User;
      } else {
        entity = (await gramJsClient.getEntity(userId!)) as Api.User;
      }
    } catch (error) {
      return {
        success: false,
        error: `User not found: ${username || userId}`,
      };
    }

    // Check if it's actually a user (not a channel/group)
    if (entity.className !== "User") {
      return {
        success: false,
        error: `Entity is not a user (got ${entity.className})`,
      };
    }

    // Get full user info for bio/about
    let fullUser: Api.users.UserFull | null = null;
    try {
      fullUser = (await gramJsClient.invoke(
        new Api.users.GetFullUser({
          id: entity,
        })
      )) as Api.users.UserFull;
    } catch (error) {
      // Full user info may not be available for all users
      console.warn("Could not get full user info:", error);
    }

    // Extract photo info
    let photoInfo = null;
    if (entity.photo && entity.photo.className === "UserProfilePhoto") {
      const photo = entity.photo as Api.UserProfilePhoto;
      photoInfo = {
        hasPhoto: true,
        photoId: photo.photoId?.toString(),
      };
    }

    // Build response
    const userInfo: Record<string, any> = {
      id: entity.id.toString(),
      username: entity.username || null,
      firstName: entity.firstName || null,
      lastName: entity.lastName || null,
      fullName: [entity.firstName, entity.lastName].filter(Boolean).join(" ") || null,
      phone: entity.phone || null,

      // Status flags
      isBot: entity.bot || false,
      isPremium: entity.premium || false,
      isVerified: entity.verified || false,
      isScam: entity.scam || false,
      isFake: entity.fake || false,
      isRestricted: entity.restricted || false,

      // Access info
      accessHash: entity.accessHash?.toString(),

      // Photo
      photo: photoInfo,
    };

    // Add full user info if available
    if (fullUser?.fullUser) {
      const full = fullUser.fullUser;
      userInfo.bio = full.about || null;
      userInfo.commonChatsCount = full.commonChatsCount || 0;
      userInfo.canPinMessage = full.canPinMessage || false;
      userInfo.blocked = full.blocked || false;
      userInfo.voiceMessagesForbidden = full.voiceMessagesForbidden || false;
    }

    console.log(`👤 get_user_info: ${userInfo.fullName || userInfo.username || userInfo.id}`);

    return {
      success: true,
      data: userInfo,
    };
  } catch (error) {
    console.error("Error getting user info:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
