/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import type { Api } from "telegram";
import type {
  PluginLogger,
  ChatInfo,
  UserInfo,
  ResolvedPeer,
  PollOptions,
  StarGift,
  ReceivedGift,
  Dialog,
  SimpleMessage,
  StarsTransaction,
  TransferResult,
  CollectibleInfo,
  UniqueGift,
  GiftValue,
  GiftOfferOptions,
} from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { randomLong, toLong } from "../utils/gramjs-bigint.js";
import { getApi, toSimpleMessage } from "./telegram-utils.js";
import {
  boundedLimit,
  requireNonEmpty,
  requireNonNegativeInteger,
  requirePositiveInteger,
} from "./validation.js";
import { createTelegramRuntime, type TelegramUserOpContext } from "./telegram/runtime.js";

export function createTelegramSocialSDK(
  bridge: ITelegramBridge,
  log: PluginLogger,
  mode?: "user" | "bot"
) {
  const { requireBridge, requireUserMode, getClient, userOp } = createTelegramRuntime(bridge, mode);

  /** Issue an EditBanned with the given rights — shared by ban/unban/mute. */
  async function editBanned(
    ctx: TelegramUserOpContext,
    chatId: string,
    userId: number | string,
    bannedRights: Api.ChatBannedRights
  ): Promise<void> {
    await ctx.client.invoke(
      new ctx.Api.channels.EditBanned({
        channel: chatId,
        participant: userId.toString(),
        bannedRights,
      })
    );
  }

  function validatePoll(question: string, answers: string[], label: "Poll" | "Quiz"): void {
    requireNonEmpty(question, `${label} question`);
    if (!answers || answers.length < 2) {
      throw new PluginSDKError(`${label} must have at least 2 answers`, "INVALID_INPUT");
    }
    if (answers.length > 10) {
      throw new PluginSDKError(`${label} cannot have more than 10 answers`, "INVALID_INPUT");
    }
    answers.forEach((answer, index) => requireNonEmpty(answer, `${label} answer ${index + 1}`));
  }

  return {
    // ─── Chat & Users ─────────────────────────────────────────

    async getChatInfo(chatId: string): Promise<ChatInfo | null> {
      requireUserMode("getChatInfo");
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        let entity;
        try {
          entity = await client.getEntity(chatId);
        } catch {
          return null;
        }

        const isChannel = entity.className === "Channel" || entity.className === "ChannelForbidden";
        const isChat = entity.className === "Chat" || entity.className === "ChatForbidden";
        const isUser = entity.className === "User";

        if (isUser) {
          const user = entity as Api.User;
          return {
            id: user.id?.toString() || chatId,
            title: [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown",
            type: "private",
            username: user.username || undefined,
          };
        }

        if (isChannel) {
          const channel = entity as Api.Channel;
          let description: string | undefined;
          let membersCount: number | undefined;

          try {
            const fullChannel = await client.invoke(new Api.channels.GetFullChannel({ channel }));
            const fullChat = fullChannel.fullChat as Api.ChannelFull;
            description = fullChat.about || undefined;
            membersCount = fullChat.participantsCount || undefined;
          } catch {
            // May lack permissions
          }

          const type = channel.megagroup ? "supergroup" : channel.broadcast ? "channel" : "group";
          return {
            id: channel.id?.toString() || chatId,
            title: channel.title || "Unknown",
            type: type as ChatInfo["type"],
            username: channel.username || undefined,
            description,
            membersCount,
          };
        }

        if (isChat) {
          const chat = entity as Api.Chat;
          let description: string | undefined;

          try {
            const fullChatResult = await client.invoke(
              new Api.messages.GetFullChat({ chatId: chat.id })
            );
            const fullChat = fullChatResult.fullChat as Api.ChatFull;
            description = fullChat.about || undefined;
          } catch {
            // May lack permissions
          }

          return {
            id: chat.id?.toString() || chatId,
            title: chat.title || "Unknown",
            type: "group",
            description,
            membersCount: chat.participantsCount || undefined,
          };
        }

        return null;
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        log.error("telegram.getChatInfo() failed:", error);
        return null;
      }
    },

    async getUserInfo(userId: number | string): Promise<UserInfo | null> {
      return userOp("getUserInfo", "get user info", async ({ client }) => {
        let entity;
        try {
          const id = typeof userId === "string" ? userId.replace("@", "") : userId.toString();
          entity = await client.getEntity(id);
        } catch {
          return null;
        }

        if (entity.className !== "User") return null;

        const user = entity as Api.User;
        return {
          id: Number(user.id),
          firstName: user.firstName || "",
          lastName: user.lastName || undefined,
          username: user.username || undefined,
          isBot: user.bot || false,
        };
      });
    },

    async resolveUsername(username: string): Promise<ResolvedPeer | null> {
      return userOp("resolveUsername", "resolve username", async ({ client, Api }) => {
        const cleanUsername = username.replace("@", "").toLowerCase();
        if (!cleanUsername) return null;

        let result;
        try {
          result = await client.invoke(
            new Api.contacts.ResolveUsername({ username: cleanUsername })
          );
        } catch (innerError: unknown) {
          const tgErr = innerError as { message?: string; errorMessage?: string };
          if (
            tgErr.message?.includes("USERNAME_NOT_OCCUPIED") ||
            tgErr.errorMessage === "USERNAME_NOT_OCCUPIED"
          ) {
            return null;
          }
          throw innerError;
        }

        if (result.users && result.users.length > 0) {
          const user = result.users[0];
          if (user instanceof Api.User) {
            return {
              id: Number(user.id),
              type: "user",
              username: user.username || undefined,
              title: user.firstName || undefined,
            };
          }
        }

        if (result.chats && result.chats.length > 0) {
          const chat = result.chats[0];
          const type = chat.className === "Channel" ? "channel" : "chat";
          return {
            id: Number(chat.id),
            type,
            username: chat instanceof Api.Channel ? chat.username || undefined : undefined,
            title:
              chat instanceof Api.Channel || chat instanceof Api.Chat
                ? chat.title || undefined
                : undefined,
          };
        }

        return null;
      });
    },

    async getParticipants(chatId: string, limit?: number): Promise<UserInfo[]> {
      requireUserMode("getParticipants");
      requireBridge();
      const bounded = boundedLimit(limit, 100, 200);
      try {
        const client = getClient();
        const Api = await getApi();

        const entity = await client.getEntity(chatId);

        const result = await client.invoke(
          new Api.channels.GetParticipants({
            channel: entity,
            filter: new Api.ChannelParticipantsRecent(),
            offset: 0,
            limit: bounded,
            hash: toLong(0),
          })
        );

        const resultData = result as Api.channels.ChannelParticipants;
        const participantMap = new Map<string, Api.TypeChannelParticipant>();
        for (const p of resultData.participants || []) {
          if ("userId" in p) participantMap.set(p.userId?.toString(), p);
        }
        return (resultData.users || []).map((user) => {
          const u = user as Api.User;
          const p = participantMap.get(u.id?.toString());
          return {
            id: Number(u.id),
            firstName: u.firstName || "",
            lastName: u.lastName || undefined,
            username: u.username || undefined,
            isBot: u.bot || false,
            rank: (p && "rank" in p && p.rank) || null,
          };
        });
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        log.error("telegram.getParticipants() failed:", error);
        return [];
      }
    },

    // ─── Interactive ──────────────────────────────────────────

    async createPoll(
      chatId: string,
      question: string,
      answers: string[],
      opts?: PollOptions
    ): Promise<number | null> {
      return userOp("createPoll", "create poll", async ({ client, Api }) => {
        validatePoll(question, answers, "Poll");
        const anonymous = opts?.isAnonymous ?? true;
        const multipleChoice = opts?.multipleChoice ?? false;

        const poll = new Api.Poll({
          id: randomLong(),
          question: new Api.TextWithEntities({ text: question, entities: [] }),
          answers: answers.map(
            (opt, idx) =>
              new Api.PollAnswer({
                text: new Api.TextWithEntities({ text: opt, entities: [] }),
                option: Buffer.from([idx]),
              })
          ),
          publicVoters: !anonymous,
          multipleChoice,
          hash: toLong(0),
        });

        const result = await client.invoke(
          new Api.messages.SendMedia({
            peer: chatId,
            media: new Api.InputMediaPoll({ poll }),
            message: "",
            randomId: randomLong(),
          })
        );

        // Extract message ID from updates
        if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
          for (const update of result.updates) {
            if (
              update.className === "UpdateNewMessage" ||
              update.className === "UpdateNewChannelMessage"
            ) {
              return update.message?.id ?? null;
            }
          }
        }

        return null;
      });
    },

    async createQuiz(
      chatId: string,
      question: string,
      answers: string[],
      correctIndex: number,
      explanation?: string
    ): Promise<number | null> {
      return userOp("createQuiz", "create quiz", async ({ client, Api }) => {
        validatePoll(question, answers, "Quiz");
        if (
          !Number.isSafeInteger(correctIndex) ||
          correctIndex < 0 ||
          correctIndex >= answers.length
        ) {
          throw new PluginSDKError(
            `correctIndex ${correctIndex} is out of bounds (0-${answers.length - 1})`,
            "INVALID_INPUT"
          );
        }
        const poll = new Api.Poll({
          id: randomLong(),
          question: new Api.TextWithEntities({ text: question, entities: [] }),
          answers: answers.map(
            (opt, idx) =>
              new Api.PollAnswer({
                text: new Api.TextWithEntities({ text: opt, entities: [] }),
                option: Buffer.from([idx]),
              })
          ),
          quiz: true,
          publicVoters: false,
          multipleChoice: false,
          hash: toLong(0),
        });

        const result = await client.invoke(
          new Api.messages.SendMedia({
            peer: chatId,
            media: new Api.InputMediaPoll({
              poll,
              correctAnswers: [correctIndex],
              solution: explanation,
              solutionEntities: [],
            }),
            message: "",
            randomId: randomLong(),
          })
        );

        if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
          for (const update of result.updates) {
            if (
              update.className === "UpdateNewMessage" ||
              update.className === "UpdateNewChannelMessage"
            ) {
              return update.message?.id ?? null;
            }
          }
        }

        return null;
      });
    },

    // ─── Moderation ───────────────────────────────────────────

    async banUser(chatId: string, userId: number | string): Promise<void> {
      return userOp("banUser", "ban user", async (ctx) => {
        await editBanned(
          ctx,
          chatId,
          userId,
          new ctx.Api.ChatBannedRights({
            untilDate: 0,
            viewMessages: true,
            sendMessages: true,
            sendMedia: true,
            sendStickers: true,
            sendGifs: true,
            sendGames: true,
            sendInline: true,
            embedLinks: true,
          })
        );
      });
    },

    async unbanUser(chatId: string, userId: number | string): Promise<void> {
      return userOp("unbanUser", "unban user", async (ctx) => {
        await editBanned(ctx, chatId, userId, new ctx.Api.ChatBannedRights({ untilDate: 0 }));
      });
    },

    async muteUser(chatId: string, userId: number | string, untilDate: number): Promise<void> {
      return userOp("muteUser", "mute user", async (ctx) => {
        await editBanned(
          ctx,
          chatId,
          userId,
          new ctx.Api.ChatBannedRights({ untilDate, sendMessages: true })
        );
      });
    },

    // ─── Stars & Gifts ────────────────────────────────────────

    async getStarsBalance(): Promise<number> {
      return userOp("getStarsBalance", "get stars balance", async ({ client, Api }) => {
        const result = await client.invoke(
          new Api.payments.GetStarsStatus({
            peer: new Api.InputPeerSelf(),
          })
        );

        return Number(result.balance?.amount?.toString() || "0");
      });
    },

    async sendGift(
      userId: number | string,
      giftId: string,
      opts?: { message?: string; anonymous?: boolean }
    ): Promise<void> {
      return userOp("sendGift", "send gift", async ({ client, Api }) => {
        requireNonEmpty(giftId, "Gift ID");
        const user = await client.getInputEntity(userId.toString());

        const invoiceData = {
          peer: user,
          giftId: toLong(giftId),
          hideName: opts?.anonymous ?? false,
          message: opts?.message
            ? new Api.TextWithEntities({ text: opts.message, entities: [] })
            : undefined,
        };

        const form = await client.invoke(
          new Api.payments.GetPaymentForm({
            invoice: new Api.InputInvoiceStarGift(invoiceData),
          })
        );

        await client.invoke(
          new Api.payments.SendStarsForm({
            formId: form.formId,
            invoice: new Api.InputInvoiceStarGift(invoiceData),
          })
        );
      });
    },

    async getAvailableGifts(): Promise<StarGift[]> {
      return userOp("getAvailableGifts", "get available gifts", async ({ client, Api }) => {
        const result = await client.invoke(new Api.payments.GetStarGifts({ hash: 0 }));

        if (result.className === "payments.StarGiftsNotModified") {
          return [];
        }

        return ((result.gifts || []) as Api.TypeStarGift[])
          .filter((g): g is Api.StarGift => g.className !== "StarGiftUnique" && !g.soldOut)
          .map((gift: Api.StarGift) => ({
            id: gift.id?.toString(),
            starsAmount: Number(gift.stars?.toString() || "0"),
            availableAmount: gift.limited
              ? Number(gift.availabilityRemains?.toString() || "0")
              : undefined,
            totalAmount: gift.limited
              ? Number(gift.availabilityTotal?.toString() || "0")
              : undefined,
          }));
      });
    },

    async getMyGifts(limit?: number): Promise<ReceivedGift[]> {
      return userOp("getMyGifts", "get my gifts", async ({ client, Api }) => {
        const result = await client.invoke(
          new Api.payments.GetSavedStarGifts({
            peer: new Api.InputPeerSelf(),
            offset: "",
            limit: boundedLimit(limit, 50, 100),
          })
        );

        return (result.gifts || []).map((savedGift: any) => {
          const gift = savedGift.gift as Api.StarGift;
          return {
            id: gift?.id?.toString() || "",
            fromId: savedGift.fromId ? Number(savedGift.fromId) : undefined,
            date: savedGift.date || 0,
            starsAmount: Number(gift?.stars?.toString() || "0"),
            saved: savedGift.unsaved !== true,
            messageId: savedGift.msgId || undefined,
          };
        });
      });
    },

    async getResaleGifts(giftId: string, limit?: number): Promise<StarGift[]> {
      return userOp("getResaleGifts", "get resale gifts", async ({ client, Api }) => {
        requireNonEmpty(giftId, "Gift collection ID");
        const result = await client.invoke(
          new Api.payments.GetResaleStarGifts({
            giftId: toLong(giftId),
            offset: "",
            limit: boundedLimit(limit, 50, 100),
          })
        );

        return (result.gifts || []).map((g: any) => {
          const listing = g as Api.StarGiftUnique;
          return {
            id: listing.slug || listing.id?.toString() || "",
            starsAmount: Number(listing.resellAmount?.[0]?.amount?.toString() || "0"),
          };
        });
      });
    },

    async buyResaleGift(giftId: string): Promise<void> {
      return userOp("buyResaleGift", "buy resale gift", async ({ client, Api }) => {
        requireNonEmpty(giftId, "Gift ID");
        const toId = new Api.InputPeerSelf();
        const invoice = new Api.InputInvoiceStarGiftResale({
          slug: giftId,
          toId,
        });

        const form = await client.invoke(new Api.payments.GetPaymentForm({ invoice }));

        await client.invoke(
          new Api.payments.SendStarsForm({
            formId: form.formId,
            invoice,
          })
        );
      });
    },

    // ─── Chat ───────────────────────────────────────────────────

    async getDialogs(limit?: number): Promise<Dialog[]> {
      requireUserMode("getDialogs");
      requireBridge();
      const bounded = boundedLimit(limit, 50, 100);
      try {
        const client = getClient();
        const dialogs = await client.getDialogs({ limit: bounded });

        return dialogs.map((dialog: any) => ({
          id: dialog.id?.toString() || null,
          title: dialog.title || "Unknown",
          type: (dialog.isChannel ? "channel" : dialog.isGroup ? "group" : "dm") as Dialog["type"],
          unreadCount: dialog.unreadCount || 0,
          unreadMentionsCount: dialog.unreadMentionsCount || 0,
          isPinned: dialog.pinned || false,
          isArchived: dialog.archived || false,
          lastMessageDate: dialog.date || null,
          lastMessage: dialog.message?.message?.substring(0, 100) || null,
        }));
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        log.error("telegram.getDialogs() failed:", error);
        return [];
      }
    },

    async getHistory(chatId: string, limit?: number): Promise<SimpleMessage[]> {
      requireUserMode("getHistory");
      requireBridge();
      const bounded = boundedLimit(limit, 50, 100);
      try {
        const client = getClient();
        const messages = await client.getMessages(chatId, {
          limit: bounded,
        });

        return messages.map(toSimpleMessage);
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        log.error("telegram.getHistory() failed:", error);
        return [];
      }
    },

    // ─── Extended Moderation ──────────────────────────────────

    async kickUser(chatId: string, userId: number | string): Promise<void> {
      requireUserMode("kickUser");
      // Ban then immediately unban = kick (user is removed but can rejoin)
      await this.banUser(chatId, userId);
      await this.unbanUser(chatId, userId);
    },

    // ─── Extended Stars & Gifts ─────────────────────────────────

    async getStarsTransactions(limit?: number): Promise<StarsTransaction[]> {
      requireUserMode("getStarsTransactions");
      requireBridge();
      const bounded = boundedLimit(limit, 50, 100);
      try {
        const client = getClient();
        const Api = await getApi();

        const result = await client.invoke(
          new Api.payments.GetStarsTransactions({
            peer: new Api.InputPeerSelf(),
            offset: "",
            limit: bounded,
          })
        );

        return (result.history || []).map((tx: any) => ({
          id: tx.id?.toString() || "",
          amount: Number(tx.amount?.amount?.toString() || "0"),
          date: tx.date || 0,
          peer: tx.peer?.className || undefined,
          description: tx.description || undefined,
        }));
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        log.error("telegram.getStarsTransactions() failed:", error);
        return [];
      }
    },

    async transferCollectible(msgId: number, toUserId: number | string): Promise<TransferResult> {
      return userOp("transferCollectible", "transfer collectible", async ({ client, Api }) => {
        requirePositiveInteger(msgId, "Gift message ID");
        const toUser = await client.getInputEntity(toUserId.toString());
        const stargiftInput = new Api.InputSavedStarGiftUser({ msgId });

        // Try free transfer first
        try {
          await client.invoke(
            new Api.payments.TransferStarGift({ stargift: stargiftInput, toId: toUser })
          );
          return {
            msgId,
            transferredTo: toUserId.toString(),
            paidTransfer: false,
          };
        } catch (freeErr: unknown) {
          const tgErr = freeErr as { errorMessage?: string };
          if (tgErr.errorMessage !== "PAYMENT_REQUIRED") throw freeErr;

          // Paid transfer flow
          const invoice = new Api.InputInvoiceStarGiftTransfer({
            stargift: stargiftInput,
            toId: toUser,
          });
          const form = await client.invoke(new Api.payments.GetPaymentForm({ invoice }));
          const transferCost = form.invoice?.prices?.[0]?.amount?.toString() || "unknown";
          await client.invoke(new Api.payments.SendStarsForm({ formId: form.formId, invoice }));
          return {
            msgId,
            transferredTo: toUserId.toString(),
            paidTransfer: true,
            starsSpent: transferCost,
          };
        }
      });
    },

    async setCollectiblePrice(msgId: number, price: number): Promise<void> {
      return userOp("setCollectiblePrice", "set collectible price", async ({ client, Api }) => {
        requirePositiveInteger(msgId, "Gift message ID");
        requireNonNegativeInteger(price, "Gift price");
        await client.invoke(
          new Api.payments.UpdateStarGiftPrice({
            stargift: new Api.InputSavedStarGiftUser({ msgId }),
            resellAmount: new Api.StarsAmount({
              amount: toLong(price),
              nanos: 0,
            }),
          })
        );
      });
    },

    async getCollectibleInfo(slug: string): Promise<CollectibleInfo | null> {
      requireUserMode("getCollectibleInfo");
      requireBridge();
      requireNonEmpty(slug, "Collectible slug");
      try {
        const client = getClient();
        const Api = await getApi();

        // Try as username first, then phone
        let result: Api.fragment.CollectibleInfo | undefined;
        let type: "username" | "phone" = "username";
        try {
          const collectible = new Api.InputCollectibleUsername({
            username: slug.replace("@", ""),
          });
          result = await client.invoke(new Api.fragment.GetCollectibleInfo({ collectible }));
        } catch (innerError: unknown) {
          const tgErr = innerError as { errorMessage?: string };
          if (
            tgErr.errorMessage === "USERNAME_NOT_OCCUPIED" ||
            tgErr.errorMessage === "PHONE_NOT_OCCUPIED"
          ) {
            return null;
          }
          // Try as phone — only swallow "not found" errors
          try {
            type = "phone";
            const collectible = new Api.InputCollectiblePhone({ phone: slug });
            result = await client.invoke(new Api.fragment.GetCollectibleInfo({ collectible }));
          } catch (phoneErr: unknown) {
            const phoneTgErr = phoneErr as { errorMessage?: string };
            if (
              phoneTgErr.errorMessage === "PHONE_NOT_OCCUPIED" ||
              phoneTgErr.errorMessage === "USERNAME_NOT_OCCUPIED"
            ) {
              return null;
            }
            throw phoneErr;
          }
        }

        if (!result) return null;

        return {
          type,
          value: slug,
          purchaseDate: new Date(result.purchaseDate * 1000).toISOString(),
          currency: result.currency,
          amount: result.amount?.toString(),
          cryptoCurrency: result.cryptoCurrency,
          cryptoAmount: result.cryptoAmount?.toString(),
          url: result.url,
        };
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        log.error("telegram.getCollectibleInfo() failed:", error);
        return null;
      }
    },

    async getUniqueGift(slug: string): Promise<UniqueGift | null> {
      requireUserMode("getUniqueGift");
      requireBridge();
      requireNonEmpty(slug, "Gift slug");
      try {
        const client = getClient();
        const Api = await getApi();

        const result = await client.invoke(new Api.payments.GetUniqueStarGift({ slug }));

        const gift = result.gift as Api.StarGiftUnique;
        const users = result.users || [];
        const ownerPeer = gift.ownerId;
        const ownerUserId =
          ownerPeer && "userId" in ownerPeer ? ownerPeer.userId?.toString() : undefined;
        const ownerUser = (users as Api.TypeUser[]).find(
          (u): u is Api.User => u.className === "User" && u.id?.toString() === ownerUserId
        );

        return {
          id: gift.id?.toString() || "",
          giftId: gift.giftId?.toString() || "",
          slug: gift.slug,
          title: gift.title || "",
          num: gift.num,
          owner: {
            id: ownerUserId,
            name: gift.ownerName || undefined,
            address: gift.ownerAddress || undefined,
            username: ownerUser?.username || undefined,
          },
          giftAddress: gift.giftAddress || undefined,
          attributes: (gift.attributes || []).map((attr) => {
            const type = attr.className?.replace("StarGiftAttribute", "").toLowerCase();
            const name = "name" in attr ? (attr.name as string) : "";
            const rarity = "rarity" in attr ? attr.rarity : undefined;
            const permille =
              rarity && "permille" in rarity ? (rarity.permille as number) : undefined;
            return {
              type,
              name,
              rarityPercent: permille ? permille / 10 : undefined,
            };
          }),
          availability:
            gift.availabilityTotal > 0
              ? {
                  total: gift.availabilityTotal,
                  remaining: gift.availabilityTotal - gift.availabilityIssued,
                }
              : undefined,
          nftLink: `t.me/nft/${gift.slug}`,
        };
      } catch (error: unknown) {
        const tgErr = error as { errorMessage?: string };
        if (tgErr.errorMessage === "STARGIFT_SLUG_INVALID") return null;
        if (error instanceof PluginSDKError) throw error;
        log.error("telegram.getUniqueGift() failed:", error);
        return null;
      }
    },

    async getUniqueGiftValue(slug: string): Promise<GiftValue | null> {
      requireUserMode("getUniqueGiftValue");
      requireBridge();
      requireNonEmpty(slug, "Gift slug");
      try {
        const client = getClient();
        const Api = await getApi();

        const result = await client.invoke(new Api.payments.GetUniqueStarGiftValueInfo({ slug }));

        return {
          slug,
          initialSaleDate: result.initialSaleDate
            ? new Date(result.initialSaleDate * 1000).toISOString()
            : undefined,
          initialSaleStars: result.initialSaleStars?.toString(),
          lastSaleDate: result.lastSaleDate
            ? new Date(result.lastSaleDate * 1000).toISOString()
            : undefined,
          lastSalePrice: result.lastSalePrice?.toString(),
          floorPrice: result.floorPrice?.toString(),
          averagePrice: result.averagePrice?.toString(),
          listedCount: result.listedCount,
          currency: result.currency,
        };
      } catch (error: unknown) {
        const tgErr = error as { errorMessage?: string };
        if (tgErr.errorMessage === "STARGIFT_SLUG_INVALID") return null;
        if (error instanceof PluginSDKError) throw error;
        log.error("telegram.getUniqueGiftValue() failed:", error);
        return null;
      }
    },

    async sendGiftOffer(
      userId: number | string,
      giftSlug: string,
      price: number,
      opts?: GiftOfferOptions
    ): Promise<void> {
      return userOp("sendGiftOffer", "send gift offer", async ({ client, Api }) => {
        requireNonEmpty(giftSlug, "Gift slug");
        requirePositiveInteger(price, "Offer price");
        const peer = await client.getInputEntity(userId.toString());
        const duration = requirePositiveInteger(opts?.duration ?? 86400, "Offer duration");

        await client.invoke(
          new Api.payments.SendStarGiftOffer({
            peer,
            slug: giftSlug,
            price: new Api.StarsAmount({ amount: toLong(price), nanos: 0 }),
            duration,
            randomId: randomLong(),
          })
        );
      });
    },

    // ─── Stories ───────────────────────────────────────────────

    async sendStory(mediaPath: string, opts?: { caption?: string }): Promise<number | null> {
      return userOp("sendStory", "send story", async ({ client, Api }) => {
        requireNonEmpty(mediaPath, "Story media path");
        const { helpers } = await import("telegram");
        const { CustomFile } = await import("telegram/client/uploads.js");
        const { readFileSync, statSync } = await import("fs");
        const { basename } = await import("path");

        const { resolve, normalize } = await import("path");
        const { homedir } = await import("os");
        const { realpathSync } = await import("fs");

        const filePath = realpathSync(resolve(normalize(mediaPath)));
        const home = homedir();
        const teletonWorkspace = `${home}/.teleton/workspace/`;
        const allowedPrefixes = [
          "/tmp/",
          `${home}/Downloads/`,
          `${home}/Pictures/`,
          `${home}/Videos/`,
          `${teletonWorkspace}uploads/`,
          `${teletonWorkspace}downloads/`,
          `${teletonWorkspace}memes/`,
        ];
        if (!allowedPrefixes.some((p) => filePath.startsWith(p))) {
          throw new PluginSDKError(
            "sendStory: media path must be within /tmp, Downloads, Pictures, or Videos",
            "OPERATION_FAILED"
          );
        }

        const fileName = basename(filePath);
        const fileSize = statSync(filePath).size;
        const fileBuffer = readFileSync(filePath);
        const isVideo = filePath.toLowerCase().match(/\.(mp4|mov|avi|webm|mkv|m4v)$/);

        const customFile = new CustomFile(fileName, fileSize, filePath, fileBuffer);

        const uploadedFile = await client.uploadFile({
          file: customFile,
          workers: 1,
        });

        let inputMedia;
        if (isVideo) {
          inputMedia = new Api.InputMediaUploadedDocument({
            file: uploadedFile,
            mimeType: "video/mp4",
            attributes: [
              new Api.DocumentAttributeVideo({
                duration: 0,
                w: 720,
                h: 1280,
                supportsStreaming: true,
              }),
              new Api.DocumentAttributeFilename({ fileName }),
            ],
          });
        } else {
          inputMedia = new Api.InputMediaUploadedPhoto({
            file: uploadedFile,
          });
        }

        const privacyRules = [new Api.InputPrivacyValueAllowAll()];

        const result = await client.invoke(
          new Api.stories.SendStory({
            peer: "me",
            media: inputMedia,
            caption: opts?.caption || "",
            privacyRules,
            randomId: helpers.generateRandomBigInt(),
          })
        );

        const storyUpdate =
          result instanceof Api.Updates
            ? result.updates.find((u) => u.className === "UpdateStory")
            : undefined;
        return storyUpdate?.story?.id ?? null;
      });
    },
  };
}
