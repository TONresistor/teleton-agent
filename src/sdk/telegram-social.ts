import type { TelegramBridge } from "../telegram/bridge.js";
import type {
  PluginLogger,
  ChatInfo,
  UserInfo,
  ResolvedPeer,
  PollOptions,
  StarGift,
  ReceivedGift,
} from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { randomBytes } from "crypto";

export function createTelegramSocialSDK(bridge: TelegramBridge, log: PluginLogger) {
  function requireBridge(): void {
    if (!bridge.isAvailable()) {
      throw new PluginSDKError(
        "Telegram bridge not connected. SDK telegram methods can only be called at runtime (inside tool executors or start()), not during plugin loading.",
        "BRIDGE_NOT_CONNECTED"
      );
    }
  }

  function getClient() {
    return bridge.getClient().getClient();
  }

  return {
    // ─── Chat & Users ─────────────────────────────────────────

    async getChatInfo(chatId: string): Promise<ChatInfo | null> {
      requireBridge();
      try {
        const client = getClient();
        const { Api } = await import("telegram");

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
          const user = entity as any;
          return {
            id: user.id?.toString() || chatId,
            title: [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown",
            type: "private",
            username: user.username || undefined,
          };
        }

        if (isChannel) {
          const channel = entity as any;
          let description: string | undefined;
          let membersCount: number | undefined;

          try {
            const fullChannel = await client.invoke(
              new Api.channels.GetFullChannel({ channel: entity as any })
            );
            const fullChat = fullChannel.fullChat as any;
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
          const chat = entity as any;
          let description: string | undefined;

          try {
            const fullChatResult = await client.invoke(
              new Api.messages.GetFullChat({ chatId: chat.id })
            );
            const fullChat = fullChatResult.fullChat as any;
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
        const { Api } = await import("telegram");

        let entity;
        try {
          const id = typeof userId === "string" ? userId.replace("@", "") : userId.toString();
          entity = await client.getEntity(id);
        } catch {
          return null;
        }

        if (entity.className !== "User") return null;

        const user = entity as any;
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
        const { Api } = await import("telegram");

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
          const user = result.users[0] as any;
          return {
            id: Number(user.id),
            type: "user",
            username: user.username || undefined,
            title: user.firstName || undefined,
          };
        }

        if (result.chats && result.chats.length > 0) {
          const chat = result.chats[0] as any;
          const type = chat.className === "Channel" ? "channel" : "chat";
          return {
            id: Number(chat.id),
            type,
            username: chat.username || undefined,
            title: chat.title || undefined,
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
        const { Api } = await import("telegram");

        const entity = await client.getEntity(chatId);

        const result = await client.invoke(
          new Api.channels.GetParticipants({
            channel: entity,
            filter: new Api.ChannelParticipantsRecent(),
            offset: 0,
            limit: limit ?? 100,
            hash: 0 as any,
          })
        );

        const resultData = result as any;
        return (resultData.users || []).map((user: any) => ({
          id: Number(user.id),
          firstName: user.firstName || "",
          lastName: user.lastName || undefined,
          username: user.username || undefined,
          isBot: user.bot || false,
        }));
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
    ): Promise<number> {
      requireBridge();
      if (!answers || answers.length < 2) {
        throw new PluginSDKError("Poll must have at least 2 answers", "OPERATION_FAILED");
      }
      if (answers.length > 10) {
        throw new PluginSDKError("Poll cannot have more than 10 answers", "OPERATION_FAILED");
      }
      try {
        const client = getClient();
        const { Api } = await import("telegram");

        const anonymous = opts?.isAnonymous ?? true;
        const multipleChoice = opts?.multipleChoice ?? false;

        const poll = new Api.Poll({
          id: randomBytes(8).readBigUInt64BE() as any,
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

        const result: any = await client.invoke(
          new Api.messages.SendMedia({
            peer: chatId,
            media: new Api.InputMediaPoll({ poll }),
            message: "",
            randomId: randomBytes(8).readBigUInt64BE() as any,
          })
        );

        // Extract message ID from updates
        if (result.className === "Updates" || result.className === "UpdatesCombined") {
          for (const update of (result as any).updates) {
            if (
              update.className === "UpdateNewMessage" ||
              update.className === "UpdateNewChannelMessage"
            ) {
              return update.message?.id ?? 0;
            }
          }
        }

        return 0;
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
    ): Promise<number> {
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
        const { Api } = await import("telegram");

        const poll = new Api.Poll({
          id: randomBytes(8).readBigUInt64BE() as any,
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

        const result: any = await client.invoke(
          new Api.messages.SendMedia({
            peer: chatId,
            media: new Api.InputMediaPoll({
              poll,
              correctAnswers: [Buffer.from([correctIndex])],
              solution: explanation,
              solutionEntities: [],
            }),
            message: "",
            randomId: randomBytes(8).readBigUInt64BE() as any,
          })
        );

        if (result.className === "Updates" || result.className === "UpdatesCombined") {
          for (const update of (result as any).updates) {
            if (
              update.className === "UpdateNewMessage" ||
              update.className === "UpdateNewChannelMessage"
            ) {
              return update.message?.id ?? 0;
            }
          }
        }

        return 0;
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
        const { Api } = await import("telegram");

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
        const { Api } = await import("telegram");

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

    async muteUser(chatId: string, userId: number | string, untilDate?: number): Promise<void> {
      requireBridge();
      try {
        const client = getClient();
        const { Api } = await import("telegram");

        await client.invoke(
          new Api.channels.EditBanned({
            channel: chatId,
            participant: userId.toString(),
            bannedRights: new Api.ChatBannedRights({
              untilDate: untilDate ?? 0,
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
        const { Api } = await import("telegram");

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
        const { Api } = await import("telegram");

        const user = await client.getEntity(userId.toString());

        const invoiceData = {
          peer: user,
          giftId: BigInt(giftId),
          hideName: opts?.anonymous ?? false,
          message: opts?.message
            ? new Api.TextWithEntities({ text: opts.message, entities: [] })
            : undefined,
        };

        const form: any = await client.invoke(
          new Api.payments.GetPaymentForm({
            invoice: new (Api as any).InputInvoiceStarGift(invoiceData),
          })
        );

        await client.invoke(
          new Api.payments.SendStarsForm({
            formId: form.formId,
            invoice: new (Api as any).InputInvoiceStarGift(invoiceData),
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
        const { Api } = await import("telegram");

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
        const { Api } = await import("telegram");

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

    async getResaleGifts(limit?: number): Promise<StarGift[]> {
      requireBridge();
      try {
        const client = getClient();
        const { Api } = await import("telegram");

        if (!(Api.payments as any).GetResaleStarGifts) {
          throw new PluginSDKError(
            "Resale gift marketplace is not supported in the current Telegram API layer.",
            "OPERATION_FAILED"
          );
        }

        const result: any = await client.invoke(
          new (Api.payments as any).GetResaleStarGifts({
            offset: "",
            limit: limit ?? 50,
          })
        );

        return (result.gifts || []).map((listing: any) => ({
          id: listing.odayId?.toString() || "",
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
        const { Api } = await import("telegram");

        if (!(Api as any).InputInvoiceStarGiftResale) {
          throw new PluginSDKError(
            "Resale gift purchasing is not supported in the current Telegram API layer.",
            "OPERATION_FAILED"
          );
        }

        const stargiftInput = new (Api as any).InputSavedStarGiftUser({
          odayId: BigInt(giftId),
        });

        const invoiceData = { stargift: stargiftInput };

        const form: any = await client.invoke(
          new Api.payments.GetPaymentForm({
            invoice: new (Api as any).InputInvoiceStarGiftResale(invoiceData),
          })
        );

        await client.invoke(
          new Api.payments.SendStarsForm({
            formId: form.formId,
            invoice: new (Api as any).InputInvoiceStarGiftResale(invoiceData),
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

    async sendStory(mediaPath: string, opts?: { caption?: string }): Promise<number> {
      requireBridge();
      try {
        const client = getClient();
        const { Api, helpers } = await import("telegram");
        const { CustomFile } = await import("telegram/client/uploads.js");
        const { readFileSync, statSync } = await import("fs");
        const { basename } = await import("path");

        const filePath = mediaPath;
        const fileName = basename(filePath);
        const fileSize = statSync(filePath).size;
        const fileBuffer = readFileSync(filePath);
        const isVideo = filePath.toLowerCase().match(/\.(mp4|mov|avi)$/);

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

        return (result as any).id || 0;
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
