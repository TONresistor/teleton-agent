import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTelegramSocialSDK } from "../telegram-social.js";
import { PluginSDKError } from "@teleton-agent/sdk";

// ─── GramJS mock ────────────────────────────────────────────────
vi.mock("telegram", () => {
  const cls = (tag: string) =>
    class {
      [key: string]: any;
      constructor(args?: Record<string, any>) {
        Object.assign(this, { _: tag, ...args });
      }
    };
  return {
    Api: {
      channels: {
        GetFullChannel: cls("channels.GetFullChannel"),
        GetParticipants: cls("channels.GetParticipants"),
        EditBanned: cls("channels.EditBanned"),
      },
      messages: {
        GetFullChat: cls("messages.GetFullChat"),
        SendMedia: cls("messages.SendMedia"),
      },
      contacts: {
        ResolveUsername: cls("contacts.ResolveUsername"),
      },
      payments: {
        GetStarsStatus: cls("payments.GetStarsStatus"),
        GetPaymentForm: cls("payments.GetPaymentForm"),
        SendStarsForm: cls("payments.SendStarsForm"),
        GetStarGifts: cls("payments.GetStarGifts"),
        GetSavedStarGifts: cls("payments.GetSavedStarGifts"),
      },
      stories: {
        SendStory: cls("stories.SendStory"),
      },
      InputPeerSelf: cls("InputPeerSelf"),
      InputInvoiceStarGift: cls("InputInvoiceStarGift"),
      TextWithEntities: cls("TextWithEntities"),
      Poll: cls("Poll"),
      PollAnswer: cls("PollAnswer"),
      InputMediaPoll: cls("InputMediaPoll"),
      ChatBannedRights: cls("ChatBannedRights"),
      ChannelParticipantsRecent: cls("ChannelParticipantsRecent"),
      InputPrivacyValueAllowAll: cls("InputPrivacyValueAllowAll"),
      InputMediaUploadedPhoto: cls("InputMediaUploadedPhoto"),
      InputMediaUploadedDocument: cls("InputMediaUploadedDocument"),
      DocumentAttributeVideo: cls("DocumentAttributeVideo"),
      DocumentAttributeFilename: cls("DocumentAttributeFilename"),
    },
    helpers: {
      generateRandomBigInt: () => BigInt(12345),
    },
  };
});

vi.mock("telegram/client/uploads.js", () => ({
  CustomFile: class CustomFile {
    name: string;
    size: number;
    path: string;
    buffer: Buffer;
    constructor(name: string, size: number, path: string, buffer: Buffer) {
      this.name = name;
      this.size = size;
      this.path = path;
      this.buffer = buffer;
    }
  },
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(() => Buffer.from("fake-file-data")),
    statSync: vi.fn(() => ({ size: 100 })),
  };
});

// ─── Mocks ──────────────────────────────────────────────────────
const mockGramJsClient = {
  invoke: vi.fn(),
  sendMessage: vi.fn(),
  sendFile: vi.fn(),
  getEntity: vi.fn(),
  getInputEntity: vi.fn(),
  getMessages: vi.fn(),
  downloadMedia: vi.fn(),
  uploadFile: vi.fn(),
};

const mockBridgeClient = {
  getClient: () => mockGramJsClient,
  getMe: vi.fn(),
};

const mockBridge = {
  isAvailable: vi.fn(() => true),
  getClient: () => mockBridgeClient,
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  sendReaction: vi.fn(),
  setTyping: vi.fn(),
  getMessages: vi.fn(),
} as any;

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("createTelegramSocialSDK", () => {
  let sdk: ReturnType<typeof createTelegramSocialSDK>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBridge.isAvailable.mockReturnValue(true);
    sdk = createTelegramSocialSDK(mockBridge, mockLog);
  });

  // ─── BRIDGE_NOT_CONNECTED for all methods ──────────────────
  describe("BRIDGE_NOT_CONNECTED guard", () => {
    beforeEach(() => {
      mockBridge.isAvailable.mockReturnValue(false);
      sdk = createTelegramSocialSDK(mockBridge, mockLog);
    });

    const methodCalls: [string, () => Promise<any>][] = [
      ["getChatInfo", () => sdk.getChatInfo("chat")],
      ["getUserInfo", () => sdk.getUserInfo(123)],
      ["resolveUsername", () => sdk.resolveUsername("user")],
      ["getParticipants", () => sdk.getParticipants("chat")],
      ["createPoll", () => sdk.createPoll("chat", "q?", ["a", "b"])],
      ["createQuiz", () => sdk.createQuiz("chat", "q?", ["a", "b"], 0)],
      ["banUser", () => sdk.banUser("chat", 123)],
      ["unbanUser", () => sdk.unbanUser("chat", 123)],
      ["muteUser", () => sdk.muteUser("chat", 123)],
      ["getStarsBalance", () => sdk.getStarsBalance()],
      ["sendGift", () => sdk.sendGift(123, "gift1")],
      ["getAvailableGifts", () => sdk.getAvailableGifts()],
      ["getMyGifts", () => sdk.getMyGifts()],
      ["getResaleGifts", () => sdk.getResaleGifts()],
      ["buyResaleGift", () => sdk.buyResaleGift("gift1")],
      ["sendStory", () => sdk.sendStory("/path/to/img.jpg")],
    ];

    for (const [name, call] of methodCalls) {
      it(`${name}() throws BRIDGE_NOT_CONNECTED`, async () => {
        await expect(call()).rejects.toMatchObject({ code: "BRIDGE_NOT_CONNECTED" });
      });
    }
  });

  // ─── getChatInfo ────────────────────────────────────────────
  describe("getChatInfo()", () => {
    it("handles User entity type", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({
        className: "User",
        id: BigInt(123),
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
      });

      const result = await sdk.getChatInfo("123");

      expect(result).toEqual({
        id: "123",
        title: "John Doe",
        type: "private",
        username: "johndoe",
      });
    });

    it("handles User with no lastName", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({
        className: "User",
        id: BigInt(123),
        firstName: "Alice",
        lastName: undefined,
        username: undefined,
      });

      const result = await sdk.getChatInfo("123");

      expect(result).toEqual({
        id: "123",
        title: "Alice",
        type: "private",
        username: undefined,
      });
    });

    it("handles Channel (supergroup) entity type", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({
        className: "Channel",
        id: BigInt(456),
        title: "Test Group",
        username: "testgroup",
        megagroup: true,
        broadcast: false,
      });
      mockGramJsClient.invoke.mockResolvedValue({
        fullChat: { about: "A test group", participantsCount: 100 },
      });

      const result = await sdk.getChatInfo("-100456");

      expect(result).toEqual({
        id: "456",
        title: "Test Group",
        type: "supergroup",
        username: "testgroup",
        description: "A test group",
        membersCount: 100,
      });
    });

    it("handles Channel (broadcast) entity type", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({
        className: "Channel",
        id: BigInt(789),
        title: "News Channel",
        username: "news",
        megagroup: false,
        broadcast: true,
      });
      mockGramJsClient.invoke.mockResolvedValue({
        fullChat: { about: "", participantsCount: 5000 },
      });

      const result = await sdk.getChatInfo("-100789");

      expect(result).toEqual({
        id: "789",
        title: "News Channel",
        type: "channel",
        username: "news",
        description: undefined,
        membersCount: 5000,
      });
    });

    it("handles Chat entity type", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({
        className: "Chat",
        id: BigInt(111),
        title: "Small Group",
        participantsCount: 5,
      });
      mockGramJsClient.invoke.mockResolvedValue({
        fullChat: { about: "A small group" },
      });

      const result = await sdk.getChatInfo("111");

      expect(result).toEqual({
        id: "111",
        title: "Small Group",
        type: "group",
        description: "A small group",
        membersCount: 5,
      });
    });

    it("returns null when entity not found", async () => {
      mockGramJsClient.getEntity.mockRejectedValue(new Error("not found"));

      const result = await sdk.getChatInfo("999");
      expect(result).toBeNull();
    });

    it("returns null for unknown entity type", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({
        className: "SomethingElse",
      });

      const result = await sdk.getChatInfo("999");
      expect(result).toBeNull();
    });

    it("handles Channel with failed GetFullChannel gracefully", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({
        className: "Channel",
        id: BigInt(456),
        title: "Restricted",
        username: undefined,
        megagroup: false,
        broadcast: false,
      });
      mockGramJsClient.invoke.mockRejectedValue(new Error("no permission"));

      const result = await sdk.getChatInfo("-100456");

      expect(result).toEqual({
        id: "456",
        title: "Restricted",
        type: "group",
        username: undefined,
        description: undefined,
        membersCount: undefined,
      });
    });

    it("returns null on unexpected top-level error, logs it", async () => {
      // Make getClient throw to hit the outer catch
      const originalGetClient = mockBridge.getClient;
      mockBridge.getClient = () => {
        throw new Error("unexpected");
      };

      const freshSdk = createTelegramSocialSDK(mockBridge, mockLog);
      const result = await freshSdk.getChatInfo("123");

      expect(result).toBeNull();
      expect(mockLog.error).toHaveBeenCalled();

      mockBridge.getClient = originalGetClient;
    });
  });

  // ─── getUserInfo ────────────────────────────────────────────
  describe("getUserInfo()", () => {
    it("returns UserInfo for a User entity", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({
        className: "User",
        id: BigInt(123),
        firstName: "Alice",
        lastName: "Smith",
        username: "alice",
        bot: false,
      });

      const result = await sdk.getUserInfo(123);

      expect(result).toEqual({
        id: 123,
        firstName: "Alice",
        lastName: "Smith",
        username: "alice",
        isBot: false,
      });
    });

    it("handles string userId with @ prefix", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({
        className: "User",
        id: BigInt(123),
        firstName: "Bob",
        bot: true,
      });

      const result = await sdk.getUserInfo("@bob");

      expect(mockGramJsClient.getEntity).toHaveBeenCalledWith("bob");
      expect(result).toEqual({
        id: 123,
        firstName: "Bob",
        lastName: undefined,
        username: undefined,
        isBot: true,
      });
    });

    it("returns null when entity not found", async () => {
      mockGramJsClient.getEntity.mockRejectedValue(new Error("not found"));

      const result = await sdk.getUserInfo(999);
      expect(result).toBeNull();
    });

    it("returns null for non-User entity", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({
        className: "Channel",
      });

      const result = await sdk.getUserInfo(999);
      expect(result).toBeNull();
    });
  });

  // ─── resolveUsername ────────────────────────────────────────
  describe("resolveUsername()", () => {
    it("resolves a user", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        users: [{ id: BigInt(100), username: "alice", firstName: "Alice" }],
        chats: [],
      });

      const result = await sdk.resolveUsername("@Alice");

      expect(result).toEqual({
        id: 100,
        type: "user",
        username: "alice",
        title: "Alice",
      });
    });

    it("resolves a Channel chat", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        users: [],
        chats: [{ id: BigInt(200), className: "Channel", username: "news", title: "News" }],
      });

      const result = await sdk.resolveUsername("news");

      expect(result).toEqual({
        id: 200,
        type: "channel",
        username: "news",
        title: "News",
      });
    });

    it("resolves a non-Channel chat", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        users: [],
        chats: [{ id: BigInt(300), className: "Chat", username: "group", title: "Group" }],
      });

      const result = await sdk.resolveUsername("group");

      expect(result).toEqual({
        id: 300,
        type: "chat",
        username: "group",
        title: "Group",
      });
    });

    it("returns null for USERNAME_NOT_OCCUPIED", async () => {
      mockGramJsClient.invoke.mockRejectedValue({
        message: "USERNAME_NOT_OCCUPIED",
        errorMessage: "USERNAME_NOT_OCCUPIED",
      });

      const result = await sdk.resolveUsername("nonexistent");
      expect(result).toBeNull();
    });

    it("returns null for USERNAME_NOT_OCCUPIED (errorMessage variant)", async () => {
      mockGramJsClient.invoke.mockRejectedValue({
        errorMessage: "USERNAME_NOT_OCCUPIED",
      });

      const result = await sdk.resolveUsername("nonexistent");
      expect(result).toBeNull();
    });

    it("returns null for empty username", async () => {
      const result = await sdk.resolveUsername("@");
      expect(result).toBeNull();
    });

    it("returns null for just @ sign", async () => {
      const result = await sdk.resolveUsername("@");
      expect(result).toBeNull();
    });

    it("returns null when no users and no chats", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        users: [],
        chats: [],
      });

      const result = await sdk.resolveUsername("empty");
      expect(result).toBeNull();
    });

    it("throws OPERATION_FAILED for other API errors", async () => {
      mockGramJsClient.invoke.mockRejectedValue(new Error("INTERNAL_SERVER_ERROR"));

      await expect(sdk.resolveUsername("bad")).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── getParticipants ────────────────────────────────────────
  describe("getParticipants()", () => {
    it("returns mapped UserInfo array", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({ className: "Channel" });
      mockGramJsClient.invoke.mockResolvedValue({
        users: [
          { id: BigInt(1), firstName: "A", lastName: "B", username: "ab", bot: false },
          { id: BigInt(2), firstName: "C", bot: true },
        ],
      });

      const result = await sdk.getParticipants("chat1");

      expect(result).toEqual([
        { id: 1, firstName: "A", lastName: "B", username: "ab", isBot: false },
        { id: 2, firstName: "C", lastName: undefined, username: undefined, isBot: true },
      ]);
    });

    it("uses default limit of 100", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({});
      mockGramJsClient.invoke.mockResolvedValue({ users: [] });

      await sdk.getParticipants("chat1");

      const invokeArg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(invokeArg.limit).toBe(100);
    });

    it("returns [] on error (query pattern)", async () => {
      mockGramJsClient.getEntity.mockRejectedValue(new Error("fail"));

      const result = await sdk.getParticipants("chat1");

      expect(result).toEqual([]);
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  // ─── createPoll ─────────────────────────────────────────────
  describe("createPoll()", () => {
    it("creates a poll and extracts message ID from updates", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        className: "Updates",
        updates: [{ className: "UpdateNewMessage", message: { id: 42 } }],
      });

      const result = await sdk.createPoll("chat1", "Favorite color?", ["Red", "Blue", "Green"]);
      expect(result).toBe(42);
    });

    it("validates minimum 2 answers", async () => {
      await expect(sdk.createPoll("chat1", "q?", ["only_one"])).rejects.toMatchObject({
        code: "OPERATION_FAILED",
        message: expect.stringContaining("at least 2 answers"),
      });
    });

    it("validates maximum 10 answers", async () => {
      const tooMany = Array.from({ length: 11 }, (_, i) => `opt${i}`);

      await expect(sdk.createPoll("chat1", "q?", tooMany)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
        message: expect.stringContaining("more than 10"),
      });
    });

    it("throws for empty answers", async () => {
      await expect(sdk.createPoll("chat1", "q?", [])).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });

    it("passes isAnonymous and multipleChoice options", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        className: "Updates",
        updates: [{ className: "UpdateNewMessage", message: { id: 1 } }],
      });

      await sdk.createPoll("chat1", "q?", ["a", "b"], {
        isAnonymous: false,
        multipleChoice: true,
      });

      // The poll is inside the media inside the SendMedia call
      const invokeArg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(invokeArg.media.poll.publicVoters).toBe(true); // !anonymous
      expect(invokeArg.media.poll.multipleChoice).toBe(true);
    });

    it("returns 0 when no update found", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        className: "Updates",
        updates: [],
      });

      const result = await sdk.createPoll("chat1", "q?", ["a", "b"]);
      expect(result).toBe(0);
    });
  });

  // ─── createQuiz ─────────────────────────────────────────────
  describe("createQuiz()", () => {
    it("creates a quiz with correct answer", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        className: "Updates",
        updates: [{ className: "UpdateNewChannelMessage", message: { id: 55 } }],
      });

      const result = await sdk.createQuiz("chat1", "2+2?", ["3", "4", "5"], 1, "Because math");
      expect(result).toBe(55);
    });

    it("validates minimum 2 answers", async () => {
      await expect(sdk.createQuiz("chat1", "q?", ["only"], 0)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
        message: expect.stringContaining("at least 2 answers"),
      });
    });

    it("validates maximum 10 answers", async () => {
      const tooMany = Array.from({ length: 11 }, (_, i) => `opt${i}`);

      await expect(sdk.createQuiz("chat1", "q?", tooMany, 0)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
        message: expect.stringContaining("more than 10"),
      });
    });

    it("validates correctIndex lower bound", async () => {
      await expect(sdk.createQuiz("chat1", "q?", ["a", "b"], -1)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
        message: expect.stringContaining("out of bounds"),
      });
    });

    it("validates correctIndex upper bound", async () => {
      await expect(sdk.createQuiz("chat1", "q?", ["a", "b"], 2)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
        message: expect.stringContaining("out of bounds"),
      });
    });

    it("validates correctIndex equals length is out of bounds", async () => {
      await expect(sdk.createQuiz("chat1", "q?", ["a", "b", "c"], 3)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
        message: expect.stringContaining("out of bounds"),
      });
    });
  });

  // ─── banUser ────────────────────────────────────────────────
  describe("banUser()", () => {
    it("invokes EditBanned with full restrictions", async () => {
      mockGramJsClient.invoke.mockResolvedValue({});

      await sdk.banUser("chat1", 123);

      const arg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(arg._).toBe("channels.EditBanned");
      expect(arg.channel).toBe("chat1");
      expect(arg.participant).toBe("123");
      expect(arg.bannedRights.viewMessages).toBe(true);
      expect(arg.bannedRights.sendMessages).toBe(true);
      expect(arg.bannedRights.sendMedia).toBe(true);
    });

    it("wraps errors", async () => {
      mockGramJsClient.invoke.mockRejectedValue(new Error("not admin"));

      await expect(sdk.banUser("c", 1)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── unbanUser ──────────────────────────────────────────────
  describe("unbanUser()", () => {
    it("invokes EditBanned with no restrictions", async () => {
      mockGramJsClient.invoke.mockResolvedValue({});

      await sdk.unbanUser("chat1", 456);

      const arg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(arg._).toBe("channels.EditBanned");
      expect(arg.participant).toBe("456");
      expect(arg.bannedRights.untilDate).toBe(0);
      // unban should NOT have viewMessages/sendMessages set
      expect(arg.bannedRights.viewMessages).toBeUndefined();
      expect(arg.bannedRights.sendMessages).toBeUndefined();
    });

    it("wraps errors", async () => {
      mockGramJsClient.invoke.mockRejectedValue(new Error("fail"));

      await expect(sdk.unbanUser("c", 1)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── muteUser ───────────────────────────────────────────────
  describe("muteUser()", () => {
    it("invokes EditBanned with sendMessages restriction", async () => {
      mockGramJsClient.invoke.mockResolvedValue({});

      await sdk.muteUser("chat1", 789);

      const arg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(arg._).toBe("channels.EditBanned");
      expect(arg.participant).toBe("789");
      expect(arg.bannedRights.sendMessages).toBe(true);
      expect(arg.bannedRights.untilDate).toBe(0);
    });

    it("passes untilDate when provided", async () => {
      mockGramJsClient.invoke.mockResolvedValue({});

      await sdk.muteUser("chat1", 789, 1700000000);

      const arg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(arg.bannedRights.untilDate).toBe(1700000000);
    });

    it("wraps errors", async () => {
      mockGramJsClient.invoke.mockRejectedValue(new Error("fail"));

      await expect(sdk.muteUser("c", 1)).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── getStarsBalance ────────────────────────────────────────
  describe("getStarsBalance()", () => {
    it("returns balance as number", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        balance: { amount: BigInt(500) },
      });

      const result = await sdk.getStarsBalance();
      expect(result).toBe(500);
    });

    it("returns 0 when balance is missing", async () => {
      mockGramJsClient.invoke.mockResolvedValue({});

      const result = await sdk.getStarsBalance();
      expect(result).toBe(0);
    });

    it("wraps errors", async () => {
      mockGramJsClient.invoke.mockRejectedValue(new Error("fail"));

      await expect(sdk.getStarsBalance()).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── sendGift ───────────────────────────────────────────────
  describe("sendGift()", () => {
    it("performs payment flow (GetPaymentForm + SendStarsForm)", async () => {
      mockGramJsClient.getEntity.mockResolvedValue({ _: "user", id: 123 });
      mockGramJsClient.invoke
        .mockResolvedValueOnce({ formId: BigInt(999) }) // GetPaymentForm
        .mockResolvedValueOnce({}); // SendStarsForm

      await sdk.sendGift(123, "42", { message: "Happy birthday!", anonymous: true });

      expect(mockGramJsClient.invoke).toHaveBeenCalledTimes(2);
      const firstCall = mockGramJsClient.invoke.mock.calls[0][0];
      expect(firstCall._).toBe("payments.GetPaymentForm");
      const secondCall = mockGramJsClient.invoke.mock.calls[1][0];
      expect(secondCall._).toBe("payments.SendStarsForm");
    });

    it("wraps errors", async () => {
      mockGramJsClient.getEntity.mockRejectedValue(new Error("user not found"));

      await expect(sdk.sendGift(999, "g1")).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── getAvailableGifts ──────────────────────────────────────
  describe("getAvailableGifts()", () => {
    it("filters out soldOut gifts", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        className: "payments.StarGifts",
        gifts: [
          { id: BigInt(1), stars: BigInt(100), soldOut: false, limited: false },
          { id: BigInt(2), stars: BigInt(200), soldOut: true, limited: true },
          {
            id: BigInt(3),
            stars: BigInt(50),
            soldOut: false,
            limited: true,
            availabilityRemains: BigInt(10),
            availabilityTotal: BigInt(100),
          },
        ],
      });

      const result = await sdk.getAvailableGifts();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "1",
        starsAmount: 100,
        availableAmount: undefined,
        totalAmount: undefined,
      });
      expect(result[1]).toEqual({
        id: "3",
        starsAmount: 50,
        availableAmount: 10,
        totalAmount: 100,
      });
    });

    it("returns [] for StarGiftsNotModified", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        className: "payments.StarGiftsNotModified",
      });

      const result = await sdk.getAvailableGifts();
      expect(result).toEqual([]);
    });

    it("handles missing gifts array", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        className: "payments.StarGifts",
      });

      const result = await sdk.getAvailableGifts();
      expect(result).toEqual([]);
    });

    it("wraps errors", async () => {
      mockGramJsClient.invoke.mockRejectedValue(new Error("fail"));

      await expect(sdk.getAvailableGifts()).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── getMyGifts ─────────────────────────────────────────────
  describe("getMyGifts()", () => {
    it("maps received gifts correctly", async () => {
      mockGramJsClient.invoke.mockResolvedValue({
        gifts: [
          {
            gift: { id: BigInt(1), stars: BigInt(100) },
            fromId: 42,
            date: 1700000000,
            unsaved: false,
            msgId: 555,
          },
          {
            gift: { id: BigInt(2), stars: BigInt(200) },
            fromId: null,
            date: 1700000001,
            unsaved: true,
          },
        ],
      });

      const result = await sdk.getMyGifts();

      expect(result).toEqual([
        {
          id: "1",
          fromId: 42,
          date: 1700000000,
          starsAmount: 100,
          saved: true,
          messageId: 555,
        },
        {
          id: "2",
          fromId: undefined,
          date: 1700000001,
          starsAmount: 200,
          saved: false,
          messageId: undefined,
        },
      ]);
    });

    it("uses default limit of 50", async () => {
      mockGramJsClient.invoke.mockResolvedValue({ gifts: [] });

      await sdk.getMyGifts();

      const invokeArg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(invokeArg.limit).toBe(50);
    });

    it("passes custom limit", async () => {
      mockGramJsClient.invoke.mockResolvedValue({ gifts: [] });

      await sdk.getMyGifts(10);

      const invokeArg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(invokeArg.limit).toBe(10);
    });

    it("wraps errors", async () => {
      mockGramJsClient.invoke.mockRejectedValue(new Error("fail"));

      await expect(sdk.getMyGifts()).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });

  // ─── getResaleGifts ─────────────────────────────────────────
  describe("getResaleGifts()", () => {
    it("throws when API not available", async () => {
      // The mock doesn't have GetResaleStarGifts on payments
      await expect(sdk.getResaleGifts()).rejects.toMatchObject({
        code: "OPERATION_FAILED",
        message: expect.stringContaining("not supported"),
      });
    });
  });

  // ─── buyResaleGift ──────────────────────────────────────────
  describe("buyResaleGift()", () => {
    it("throws when API not available", async () => {
      // The mock doesn't have InputInvoiceStarGiftResale on Api
      await expect(sdk.buyResaleGift("gift1")).rejects.toMatchObject({
        code: "OPERATION_FAILED",
        message: expect.stringContaining("not supported"),
      });
    });
  });

  // ─── sendStory ──────────────────────────────────────────────
  describe("sendStory()", () => {
    it("uploads photo and sends story", async () => {
      mockGramJsClient.uploadFile.mockResolvedValue({ _: "InputFile" });
      mockGramJsClient.invoke.mockResolvedValue({ id: 77 });

      const result = await sdk.sendStory("/path/to/image.jpg", { caption: "My story" });

      expect(mockGramJsClient.uploadFile).toHaveBeenCalledOnce();
      expect(mockGramJsClient.invoke).toHaveBeenCalledOnce();
      expect(result).toBe(77);
    });

    it("detects video files by extension", async () => {
      mockGramJsClient.uploadFile.mockResolvedValue({ _: "InputFile" });
      mockGramJsClient.invoke.mockResolvedValue({ id: 88 });

      const result = await sdk.sendStory("/path/to/clip.mp4");

      expect(result).toBe(88);
      // The invoke call should contain InputMediaUploadedDocument for video
      const invokeArg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(invokeArg.media._).toBe("InputMediaUploadedDocument");
    });

    it("uses InputMediaUploadedPhoto for non-video files", async () => {
      mockGramJsClient.uploadFile.mockResolvedValue({ _: "InputFile" });
      mockGramJsClient.invoke.mockResolvedValue({ id: 99 });

      await sdk.sendStory("/path/to/photo.png");

      const invokeArg = mockGramJsClient.invoke.mock.calls[0][0];
      expect(invokeArg.media._).toBe("InputMediaUploadedPhoto");
    });

    it("returns 0 when result has no id", async () => {
      mockGramJsClient.uploadFile.mockResolvedValue({ _: "InputFile" });
      mockGramJsClient.invoke.mockResolvedValue({});

      const result = await sdk.sendStory("/path/to/img.jpg");
      expect(result).toBe(0);
    });

    it("wraps errors", async () => {
      mockGramJsClient.uploadFile.mockRejectedValue(new Error("upload failed"));

      await expect(sdk.sendStory("/path/to/img.jpg")).rejects.toMatchObject({
        code: "OPERATION_FAILED",
      });
    });
  });
});
