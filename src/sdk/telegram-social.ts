import type { TelegramBridge } from "../telegram/bridge.js";
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
import {
  requireBridge as requireBridgeUtil,
  getClient as getClientUtil,
  getApi,
  toSimpleMessage,
} from "./telegram-utils.js";

export function createTelegramSocialSDK(bridge: TelegramBridge, log: PluginLogger) {
  function requireBridge(): void {
    requireBridgeUtil(bridge);
  }

  function getClient() {
    return getClientUtil(bridge);
  }

  return {
    // ─── Chat & Users ─────────────────────────────────────────

    async getChatInfo(chatId: string): Promise<ChatInfo | null> {
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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.getChatInfo() failed:", err);
        return null;
      }
    },

    async getUserInfo(userId: number | string): Promise<UserInfo | null> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to get user info: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async resolveUsername(username: string): Promise<ResolvedPeer | null> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const cleanUsername = username.replace("@", "").toLowerCase();
        if (!cleanUsername) return null;

        let result;
        try {
          result = await client.invoke(
            new Api.contacts.ResolveUsername({ username: cleanUsername })
          );
        } catch (err: any) {
          if (
            err.message?.includes("USERNAME_NOT_OCCUPIED") ||
            err.errorMessage === "USERNAME_NOT_OCCUPIED"
          ) {
            return null;
          }
          throw err;
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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to resolve username: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getParticipants(chatId: string, limit?: number): Promise<UserInfo[]> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const entity = await client.getEntity(chatId);

        const result = await client.invoke(
          new Api.channels.GetParticipants({
            channel: entity,
            filter: new Api.ChannelParticipantsRecent(),
            offset: 0,
            limit: limit ?? 100,
            hash: toLong(0),
          })
        );

        const resultData = result as Api.channels.ChannelParticipants;
        return (resultData.users || []).map((user) => {
          const u = user as Api.User;
          return {
            id: Number(u.id),
            firstName: u.firstName || "",
            lastName: u.lastName || undefined,
            username: u.username || undefined,
            isBot: u.bot || false,
          };
        });
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.getParticipants() failed:", err);
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
      requireBridge();
      if (!answers || answers.length < 2) {
        throw new PluginSDKError("Poll must have at least 2 answers", "OPERATION_FAILED");
      }
      if (answers.length > 10) {
        throw new PluginSDKError("Poll cannot have more than 10 answers", "OPERATION_FAILED");
      }
      try {
        const client = getClient();
        const Api = await getApi();

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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to create poll: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async createQuiz(
      chatId: string,
      question: string,
      answers: string[],
      correctIndex: number,
      explanation?: string
    ): Promise<number | null> {
      requireBridge();
      if (!answers || answers.length < 2) {
        throw new PluginSDKError("Quiz must have at least 2 answers", "OPERATION_FAILED");
      }
      if (answers.length > 10) {
        throw new PluginSDKError("Quiz cannot have more than 10 answers", "OPERATION_FAILED");
      }
      if (correctIndex < 0 || correctIndex >= answers.length) {
        throw new PluginSDKError(
          `correctIndex ${correctIndex} is out of bounds (0-${answers.length - 1})`,
          "OPERATION_FAILED"
        );
      }
      try {
        const client = getClient();
        const Api = await getApi();

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
        });

        const result = await client.invoke(
          new Api.messages.SendMedia({
            peer: chatId,
            media: new Api.InputMediaPoll({
              poll,
              correctAnswers: [Buffer.from([correctIndex])],
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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to create quiz: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    // ─── Moderation ───────────────────────────────────────────

    async banUser(chatId: string, userId: number | string): Promise<void> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        await client.invoke(
          new Api.channels.EditBanned({
            channel: chatId,
            participant: userId.toString(),
            bannedRights: new Api.ChatBannedRights({
              untilDate: 0,
              viewMessages: true,
              sendMessages: true,
              sendMedia: true,
              sendStickers: true,
              sendGifs: true,
              sendGames: true,
              sendInline: true,
              embedLinks: true,
            }),
          })
        );
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to ban user: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async unbanUser(chatId: string, userId: number | string): Promise<void> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        await client.invoke(
          new Api.channels.EditBanned({
            channel: chatId,
            participant: userId.toString(),
            bannedRights: new Api.ChatBannedRights({
              untilDate: 0,
            }),
          })
        );
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to unban user: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async muteUser(chatId: string, userId: number | string, untilDate: number): Promise<void> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        await client.invoke(
          new Api.channels.EditBanned({
            channel: chatId,
            participant: userId.toString(),
            bannedRights: new Api.ChatBannedRights({
              untilDate,
              sendMessages: true,
            }),
          })
        );
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to mute user: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    // ─── Stars & Gifts ────────────────────────────────────────

    async getStarsBalance(): Promise<number> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const result: any = await client.invoke(
          new Api.payments.GetStarsStatus({
            peer: new Api.InputPeerSelf(),
          })
        );

        return Number(result.balance?.amount?.toString() || "0");
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to get stars balance: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async sendGift(
      userId: number | string,
      giftId: string,
      opts?: { message?: string; anonymous?: boolean }
    ): Promise<void> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const user = await client.getInputEntity(userId.toString());

        const invoiceData = {
          peer: user,
          giftId: BigInt(giftId) as any,
          hideName: opts?.anonymous ?? false,
          message: opts?.message
            ? new Api.TextWithEntities({ text: opts.message, entities: [] })
            : undefined,
        };

        const form: any = await client.invoke(
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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send gift: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getAvailableGifts(): Promise<StarGift[]> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const result: any = await client.invoke(new Api.payments.GetStarGifts({ hash: 0 }));

        if (result.className === "payments.StarGiftsNotModified") {
          return [];
        }

        return (result.gifts || [])
          .filter((gift: any) => !gift.soldOut)
          .map((gift: any) => ({
            id: gift.id?.toString(),
            starsAmount: Number(gift.stars?.toString() || "0"),
            availableAmount: gift.limited
              ? Number(gift.availabilityRemains?.toString() || "0")
              : undefined,
            totalAmount: gift.limited
              ? Number(gift.availabilityTotal?.toString() || "0")
              : undefined,
          }));
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to get available gifts: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getMyGifts(limit?: number): Promise<ReceivedGift[]> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const result: any = await client.invoke(
          new Api.payments.GetSavedStarGifts({
            peer: new Api.InputPeerSelf(),
            offset: "",
            limit: limit ?? 50,
          })
        );

        return (result.gifts || []).map((savedGift: any) => {
          const gift = savedGift.gift;
          return {
            id: gift?.id?.toString() || "",
            fromId: savedGift.fromId ? Number(savedGift.fromId) : undefined,
            date: savedGift.date || 0,
            starsAmount: Number(gift?.stars?.toString() || "0"),
            saved: savedGift.unsaved !== true,
            messageId: savedGift.msgId || undefined,
          };
        });
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to get my gifts: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getResaleGifts(giftId: string, limit?: number): Promise<StarGift[]> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const result: any = await client.invoke(
          new Api.payments.GetResaleStarGifts({
            giftId: BigInt(giftId) as any,
            offset: "",
            limit: limit ?? 50,
          })
        );

        return (result.gifts || []).map((listing: any) => ({
          id: listing.slug || listing.id?.toString() || "",
          starsAmount: Number(listing.resellStars?.toString() || "0"),
        }));
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to get resale gifts: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async buyResaleGift(giftId: string): Promise<void> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const toId = new Api.InputPeerSelf();
        const invoice = new Api.InputInvoiceStarGiftResale({
          slug: giftId,
          toId,
        });

        const form: any = await client.invoke(new Api.payments.GetPaymentForm({ invoice }));

        await client.invoke(
          new Api.payments.SendStarsForm({
            formId: form.formId,
            invoice,
          })
        );
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to buy resale gift: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    // ─── Chat ───────────────────────────────────────────────────

    async getDialogs(limit?: number): Promise<Dialog[]> {
      requireBridge();
      try {
        const client = getClient();
        const dialogs = await client.getDialogs({ limit: Math.min(limit ?? 50, 100) });

        return dialogs.map((dialog) => ({
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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.getDialogs() failed:", err);
        return [];
      }
    },

    async getHistory(chatId: string, limit?: number): Promise<SimpleMessage[]> {
      requireBridge();
      try {
        const client = getClient();
        const messages = await client.getMessages(chatId, {
          limit: Math.min(limit ?? 50, 100),
        });

        return messages.map(toSimpleMessage);
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.getHistory() failed:", err);
        return [];
      }
    },

    // ─── Extended Moderation ──────────────────────────────────

    async kickUser(chatId: string, userId: number | string): Promise<void> {
      // Ban then immediately unban = kick (user is removed but can rejoin)
      await this.banUser(chatId, userId);
      await this.unbanUser(chatId, userId);
    },

    // ─── Extended Stars & Gifts ─────────────────────────────────

    async getStarsTransactions(limit?: number): Promise<StarsTransaction[]> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const result: any = await client.invoke(
          new Api.payments.GetStarsTransactions({
            peer: new Api.InputPeerSelf(),
            offset: "",
            limit: limit ?? 50,
          })
        );

        return (result.history || []).map((tx: any) => ({
          id: tx.id?.toString() || "",
          amount: Number(tx.stars?.amount?.toString() || "0"),
          date: tx.date || 0,
          peer: tx.peer?.className || undefined,
          description: tx.description || undefined,
        }));
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.getStarsTransactions() failed:", err);
        return [];
      }
    },

    async transferCollectible(msgId: number, toUserId: number | string): Promise<TransferResult> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

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
        } catch (freeErr: any) {
          if (freeErr?.errorMessage !== "PAYMENT_REQUIRED") throw freeErr;

          // Paid transfer flow
          const invoice = new Api.InputInvoiceStarGiftTransfer({
            stargift: stargiftInput,
            toId: toUser,
          });
          const form: any = await client.invoke(new Api.payments.GetPaymentForm({ invoice }));
          const transferCost = form.invoice?.prices?.[0]?.amount?.toString() || "unknown";
          await client.invoke(new Api.payments.SendStarsForm({ formId: form.formId, invoice }));
          return {
            msgId,
            transferredTo: toUserId.toString(),
            paidTransfer: true,
            starsSpent: transferCost,
          };
        }
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to transfer collectible: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async setCollectiblePrice(msgId: number, price: number): Promise<void> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        await client.invoke(
          new Api.payments.UpdateStarGiftPrice({
            stargift: new Api.InputSavedStarGiftUser({ msgId }),
            resellAmount: new Api.StarsAmount({
              amount: BigInt(price) as any,
              nanos: 0,
            }),
          })
        );
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to set collectible price: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async getCollectibleInfo(slug: string): Promise<CollectibleInfo | null> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        // Try as username first, then phone
        let result: any;
        let type: "username" | "phone" = "username";
        try {
          const collectible = new Api.InputCollectibleUsername({
            username: slug.replace("@", ""),
          });
          result = await client.invoke(new Api.fragment.GetCollectibleInfo({ collectible }));
        } catch (err: any) {
          if (
            err.errorMessage === "USERNAME_NOT_OCCUPIED" ||
            err.errorMessage === "PHONE_NOT_OCCUPIED"
          ) {
            return null;
          }
          // Try as phone — only swallow "not found" errors
          try {
            type = "phone";
            const collectible = new Api.InputCollectiblePhone({ phone: slug });
            result = await client.invoke(new Api.fragment.GetCollectibleInfo({ collectible }));
          } catch (phoneErr: any) {
            if (
              phoneErr.errorMessage === "PHONE_NOT_OCCUPIED" ||
              phoneErr.errorMessage === "USERNAME_NOT_OCCUPIED"
            ) {
              return null;
            }
            throw phoneErr;
          }
        }

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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.getCollectibleInfo() failed:", err);
        return null;
      }
    },

    async getUniqueGift(slug: string): Promise<UniqueGift | null> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const result: any = await client.invoke(new Api.payments.GetUniqueStarGift({ slug }));

        const gift = result.gift;
        const users = result.users || [];
        const ownerUserId = gift.ownerId?.userId?.toString();
        const ownerUser = users.find((u: any) => u.id?.toString() === ownerUserId);

        return {
          id: gift.id?.toString() || "",
          giftId: gift.giftId?.toString() || "",
          slug: gift.slug,
          title: gift.title,
          num: gift.num,
          owner: {
            id: ownerUserId,
            name: gift.ownerName || undefined,
            address: gift.ownerAddress || undefined,
            username: ownerUser?.username || undefined,
          },
          giftAddress: gift.giftAddress || undefined,
          attributes: (gift.attributes || []).map((attr: any) => ({
            type: attr.className?.replace("StarGiftAttribute", "").toLowerCase(),
            name: attr.name,
            rarityPercent: attr.rarityPermille ? attr.rarityPermille / 10 : undefined,
          })),
          availability: gift.availability
            ? { total: gift.availability.total, remaining: gift.availability.remaining }
            : undefined,
          nftLink: `t.me/nft/${gift.slug}`,
        };
      } catch (err: any) {
        if (err.errorMessage === "STARGIFT_SLUG_INVALID") return null;
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.getUniqueGift() failed:", err);
        return null;
      }
    },

    async getUniqueGiftValue(slug: string): Promise<GiftValue | null> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const result: any = await client.invoke(
          new Api.payments.GetUniqueStarGiftValueInfo({ slug })
        );

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
      } catch (err: any) {
        if (err.errorMessage === "STARGIFT_SLUG_INVALID") return null;
        if (err instanceof PluginSDKError) throw err;
        log.error("telegram.getUniqueGiftValue() failed:", err);
        return null;
      }
    },

    async sendGiftOffer(
      userId: number | string,
      giftSlug: string,
      price: number,
      opts?: GiftOfferOptions
    ): Promise<void> {
      requireBridge();
      try {
        const client = getClient();
        const Api = await getApi();

        const peer = await client.getInputEntity(userId.toString());
        const duration = opts?.duration ?? 86400;

        await client.invoke(
          new Api.payments.SendStarGiftOffer({
            peer,
            slug: giftSlug,
            price: new Api.StarsAmount({ amount: BigInt(price) as any, nanos: 0 }),
            duration,
            randomId: randomLong(),
          })
        );
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send gift offer: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },

    // ─── Stories ───────────────────────────────────────────────

    async sendStory(mediaPath: string, opts?: { caption?: string }): Promise<number | null> {
      requireBridge();
      try {
        const client = getClient();
        const { Api, helpers } = await import("telegram");
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
      } catch (err) {
        if (err instanceof PluginSDKError) throw err;
        throw new PluginSDKError(
          `Failed to send story: ${err instanceof Error ? err.message : String(err)}`,
          "OPERATION_FAILED"
        );
      }
    },
  };
}
