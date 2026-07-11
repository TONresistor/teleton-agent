// ─── Telegram Extension Types ───────────────────────────────────

/** Dialog/conversation from getDialogs */
export interface Dialog {
  /** Chat ID */
  id: string | null;
  /** Chat title or name */
  title: string;
  /** Chat type */
  type: "dm" | "group" | "channel";
  /** Number of unread messages */
  unreadCount: number;
  /** Number of unread mentions */
  unreadMentionsCount: number;
  /** Whether the chat is pinned */
  isPinned: boolean;
  /** Whether the chat is archived */
  isArchived: boolean;
  /** Last message date (unix timestamp) */
  lastMessageDate: number | null;
  /** Last message preview (truncated) */
  lastMessage: string | null;
}

/** Stars transaction history entry */
export interface StarsTransaction {
  /** Transaction ID */
  id: string;
  /** Amount (positive = received, negative = spent) */
  amount: number;
  /** Transaction date (unix timestamp) */
  date: number;
  /** Peer info */
  peer?: string;
  /** Description */
  description?: string;
}

/** Result of transferring a collectible */
export interface TransferResult {
  /** Message ID of the transferred gift */
  msgId: number;
  /** Recipient identifier */
  transferredTo: string;
  /** Whether transfer cost Stars */
  paidTransfer: boolean;
  /** Stars spent (if paid transfer) */
  starsSpent?: string;
}

/** Fragment collectible information */
export interface CollectibleInfo {
  /** Collectible type */
  type: "username" | "phone";
  /** The username or phone number */
  value: string;
  /** Purchase date (ISO 8601) */
  purchaseDate: string;
  /** Fiat currency */
  currency: string;
  /** Fiat amount */
  amount?: string;
  /** Crypto currency (e.g. "TON") */
  cryptoCurrency?: string;
  /** Crypto amount */
  cryptoAmount?: string;
  /** Fragment URL */
  url?: string;
}

/** Unique NFT gift details */
export interface UniqueGift {
  /** Gift ID */
  id: string;
  /** Collection gift ID */
  giftId: string;
  /** URL slug */
  slug: string;
  /** Gift title */
  title: string;
  /** Number in collection */
  num: number;
  /** Owner info */
  owner: {
    id?: string;
    name?: string;
    address?: string;
    username?: string;
  };
  /** TON address of the gift NFT */
  giftAddress?: string;
  /** NFT attributes */
  attributes: Array<{ type: string; name: string; rarityPercent?: number }>;
  /** Availability info */
  availability?: { total: number; remaining: number };
  /** Link to NFT page */
  nftLink: string;
}

/** Gift value/appraisal info */
export interface GiftValue {
  /** NFT slug */
  slug: string;
  /** Initial sale date (ISO 8601) */
  initialSaleDate?: string;
  /** Initial sale price in Stars */
  initialSaleStars?: string;
  /** Last sale date (ISO 8601) */
  lastSaleDate?: string;
  /** Last sale price */
  lastSalePrice?: string;
  /** Floor price */
  floorPrice?: string;
  /** Average price */
  averagePrice?: string;
  /** Number listed */
  listedCount?: number;
  /** Currency */
  currency?: string;
}

/** Options for sendGiftOffer */
export interface GiftOfferOptions {
  /** Offer validity in seconds (default: 86400 = 24h, min: 21600 = 6h) */
  duration?: number;
}

// ─── Telegram Types ──────────────────────────────────────────────

/** A single inline keyboard button */
export interface InlineButton {
  /** Button label text */
  text: string;
  /** Callback data sent when button is pressed */
  callback_data: string;
}

/** Options for sending a message */
export interface SendMessageOptions {
  /** Message ID to reply to */
  replyToId?: number;
  /** Inline keyboard buttons (2D array: rows of buttons) */
  inlineKeyboard?: InlineButton[][];
}

/** Options for editing a message */
export interface EditMessageOptions {
  /** Updated inline keyboard (omit to keep existing) */
  inlineKeyboard?: InlineButton[][];
}

/** Result of sending a dice animation */
export interface DiceResult {
  /** The dice value (1-6 for dice, 1-64 for slots, etc.) */
  value: number;
  /** Message ID of the dice message */
  messageId: number;
}

/** User info returned by getMe */
export interface TelegramUser {
  /** Telegram user ID */
  id: number;
  /** Username without @ (may be undefined) */
  username?: string;
  /** First name */
  firstName?: string;
  /** Whether the user is a bot */
  isBot: boolean;
}

/** Simplified message from getMessages */
export interface SimpleMessage {
  /** Message ID */
  id: number;
  /** Message text */
  text: string;
  /** Sender user ID */
  senderId: number;
  /** Sender username */
  senderUsername?: string;
  /** Message timestamp */
  timestamp: Date;
}

// ─── Telegram Extended Types ────────────────────────────────────

/** Chat/group information returned by getChatInfo */
export interface ChatInfo {
  /** Chat ID as string */
  id: string;
  /** Chat title (or user's first name for private chats) */
  title: string;
  /** Chat type */
  type: "private" | "group" | "supergroup" | "channel";
  /** Number of members (groups/channels only) */
  membersCount?: number;
  /** Chat username without @ (if public) */
  username?: string;
  /** Chat/channel description/bio */
  description?: string;
}

/** Detailed user information returned by getUserInfo */
export interface UserInfo {
  /** Telegram user ID */
  id: number;
  /** First name */
  firstName: string;
  /** Last name */
  lastName?: string;
  /** Username without @ */
  username?: string;
  /** Whether the user is a bot */
  isBot: boolean;
  /** Custom rank/title (Layer 223+), null if not set */
  rank?: string | null;
}

/** Resolved peer from username lookup */
export interface ResolvedPeer {
  /** Entity ID */
  id: number;
  /** Entity type */
  type: "user" | "chat" | "channel";
  /** Username if available */
  username?: string;
  /** Title (for groups/channels) or first name (for users) */
  title?: string;
}

/** Options for sending media (photo, video, file, etc.) */
export interface MediaSendOptions {
  /** Media caption text */
  caption?: string;
  /** Message ID to reply to */
  replyToId?: number;
  /** Inline keyboard buttons */
  inlineKeyboard?: InlineButton[][];
  /** Duration in seconds (for video/voice) */
  duration?: number;
  /** Width in pixels (for video) */
  width?: number;
  /** Height in pixels (for video) */
  height?: number;
}

/** Options for creating a poll */
export interface PollOptions {
  /** Whether voters are anonymous (default: true) */
  isAnonymous?: boolean;
  /** Allow multiple answers (default: false) */
  multipleChoice?: boolean;
}

/** Star gift from catalog */
export interface StarGift {
  /** Gift ID */
  id: string;
  /** Cost in Telegram Stars */
  starsAmount: number;
  /** Remaining available (limited gifts) */
  availableAmount?: number;
  /** Total supply (limited gifts) */
  totalAmount?: number;
}

/** Received star gift */
export interface ReceivedGift {
  /** Gift ID */
  id: string;
  /** Sender user ID */
  fromId?: number;
  /** Unix timestamp when received */
  date: number;
  /** Stars value */
  starsAmount: number;
  /** Whether saved to profile */
  saved: boolean;
  /** Associated message ID */
  messageId?: number;
}

/** Metadata returned after sending a result from a third-party inline bot. */
export interface InlineBotResult {
  query: string;
  sentIndex: number;
  totalResults: number;
  title: string | null;
  description: string | null;
  type: string | null;
}

/**
 * Telegram messaging and user operations.
 *
 * All methods that interact with Telegram require the bridge to be connected.
 * They throw PluginSDKError with code BRIDGE_NOT_CONNECTED if called
 * before the bridge is ready (i.e., during plugin loading).
 */
export interface TelegramSDK {
  /**
   * Returns the current Telegram mode: "user" (MTProto) or "bot" (Bot API).
   */
  getMode(): "user" | "bot";

  /**
   * Send a text message to a chat.
   *
   * @param chatId — Telegram chat ID
   * @param text — Message text
   * @param opts — Reply-to and inline keyboard options
   * @returns Message ID of the sent message
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<number>;

  /**
   * Edit an existing message.
   *
   * @param chatId — Chat ID where the message lives
   * @param messageId — ID of the message to edit
   * @param text — New message text
   * @param opts — Updated inline keyboard
   * @returns Message ID of the edited message
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  editMessage(
    chatId: string,
    messageId: number,
    text: string,
    opts?: EditMessageOptions
  ): Promise<number>;

  /**
   * Send a dice/slot animation and get the result value.
   *
   * Supported emoticons and their value ranges:
   * - "🎲" (dice: 1-6)
   * - "🎯" (darts: 1-6)
   * - "🏀" (basketball: 1-5)
   * - "⚽" (football: 1-5)
   * - "🎳" (bowling: 1-6)
   * - "🎰" (slots: 1-64)
   *
   * @param chatId — Chat ID to send to
   * @param emoticon — Dice emoticon
   * @param replyToId — Optional message to reply to
   * @returns Dice result with value and message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendDice(chatId: string, emoticon: string, replyToId?: number): Promise<DiceResult>;

  /**
   * Send an emoji reaction to a message.
   *
   * @param chatId — Chat ID
   * @param messageId — Message to react to
   * @param emoji — Reaction emoji (e.g. "👍", "🔥")
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendReaction(chatId: string, messageId: number, emoji: string): Promise<void>;

  /**
   * Get recent messages from a chat.
   *
   * @param chatId — Chat ID to fetch from
   * @param limit — Max messages (default: 50)
   * @returns Simplified message objects, or empty array on error.
   */
  getMessages(chatId: string, limit?: number): Promise<SimpleMessage[]>;

  /**
   * Query a third-party inline bot and send one of its results to a chat.
   * Available in Telegram user mode only.
   *
   * @param chatId — Destination chat ID
   * @param botUsername — Inline bot username, with or without a leading @
   * @param query — Inline query text
   * @param index — Zero-based result index (default: 0, max: 49)
   * @throws {PluginSDKError} NOT_AVAILABLE, BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendInlineBotResult(
    chatId: string,
    botUsername: string,
    query: string,
    index?: number
  ): Promise<InlineBotResult>;

  /**
   * Get bot's own user info.
   * @returns Own user info, or null if not connected.
   */
  getMe(): TelegramUser | null;

  /**
   * Check if the Telegram bridge is connected and ready.
   */
  isAvailable(): boolean;

  // ─── Messages ──────────────────────────────────────────────

  /**
   * Delete a message.
   *
   * @param chatId — Chat ID
   * @param messageId — Message ID to delete
   * @param revoke — Also delete for other users (default: true)
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  deleteMessage(chatId: string, messageId: number, revoke?: boolean): Promise<void>;

  /**
   * Forward a message to another chat.
   *
   * @param fromChatId — Source chat ID
   * @param toChatId — Destination chat ID
   * @param messageId — Message ID to forward
   * @returns Message ID of the forwarded message
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  forwardMessage(fromChatId: string, toChatId: string, messageId: number): Promise<number | null>;

  /**
   * Pin or unpin a message in a chat.
   *
   * @param chatId — Chat ID
   * @param messageId — Message ID to pin/unpin
   * @param opts — Options: silent (no notification), unpin (unpin instead)
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  pinMessage(
    chatId: string,
    messageId: number,
    opts?: { silent?: boolean; unpin?: boolean }
  ): Promise<void>;

  /**
   * Search messages in a chat.
   *
   * @param chatId — Chat ID to search in
   * @param query — Search query string
   * @param limit — Max results (default: 20)
   * @returns Matching messages
   */
  searchMessages(chatId: string, query: string, limit?: number): Promise<SimpleMessage[]>;

  /**
   * Schedule a message for later delivery.
   *
   * @param chatId — Chat ID
   * @param text — Message text
   * @param scheduleDate — Unix timestamp for delivery
   * @returns Scheduled message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  scheduleMessage(chatId: string, text: string, scheduleDate: number): Promise<number | null>;

  /**
   * Get replies to a specific message (thread).
   *
   * @param chatId — Chat ID
   * @param messageId — Parent message ID
   * @param limit — Max replies (default: 50)
   * @returns Reply messages
   */
  getReplies(chatId: string, messageId: number, limit?: number): Promise<SimpleMessage[]>;

  // ─── Media ─────────────────────────────────────────────────

  /**
   * Send a photo.
   *
   * @param chatId — Chat ID
   * @param photo — File path or Buffer
   * @param opts — Caption, reply, keyboard options
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendPhoto(chatId: string, photo: string | Buffer, opts?: MediaSendOptions): Promise<number>;

  /**
   * Send a video.
   *
   * @param chatId — Chat ID
   * @param video — File path or Buffer
   * @param opts — Caption, reply, keyboard options
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendVideo(chatId: string, video: string | Buffer, opts?: MediaSendOptions): Promise<number>;

  /**
   * Send a voice message.
   *
   * @param chatId — Chat ID
   * @param voice — File path or Buffer (OGG/Opus format)
   * @param opts — Caption, reply, keyboard options
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendVoice(chatId: string, voice: string | Buffer, opts?: MediaSendOptions): Promise<number>;

  /**
   * Send a file/document.
   *
   * @param chatId — Chat ID
   * @param file — File path or Buffer
   * @param opts — Caption, reply, keyboard, fileName options
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendFile(
    chatId: string,
    file: string | Buffer,
    opts?: MediaSendOptions & { fileName?: string }
  ): Promise<number>;

  /**
   * Send an animated GIF.
   *
   * @param chatId — Chat ID
   * @param gif — File path or Buffer
   * @param opts — Caption, reply, keyboard options
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendGif(chatId: string, gif: string | Buffer, opts?: MediaSendOptions): Promise<number>;

  /**
   * Send a sticker.
   *
   * @param chatId — Chat ID
   * @param sticker — File path or Buffer (WEBP format)
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendSticker(chatId: string, sticker: string | Buffer): Promise<number>;

  /**
   * Download media from a message.
   *
   * @param chatId — Chat ID
   * @param messageId — Message ID containing media
   * @returns Media as Buffer, or null if no media found
   */
  downloadMedia(chatId: string, messageId: number): Promise<Buffer | null>;

  // ─── Chat & Users ──────────────────────────────────────────

  /**
   * Get chat/group/channel information.
   *
   * @param chatId — Chat ID
   * @returns Chat info, or null if not found
   */
  getChatInfo(chatId: string): Promise<ChatInfo | null>;

  /**
   * Get user information.
   *
   * @param userId — User ID or username
   * @returns User info, or null if not found
   */
  getUserInfo(userId: number | string): Promise<UserInfo | null>;

  /**
   * Resolve a @username to a peer entity.
   *
   * @param username — Username without @
   * @returns Resolved peer info, or null if not found
   */
  resolveUsername(username: string): Promise<ResolvedPeer | null>;

  /**
   * Get participants of a group/channel.
   *
   * @param chatId — Chat ID (must be a group or channel)
   * @param limit — Max participants (default: 100)
   * @returns Array of user info
   */
  getParticipants(chatId: string, limit?: number): Promise<UserInfo[]>;

  // ─── Interactive ───────────────────────────────────────────

  /**
   * Create a poll in a chat.
   *
   * @param chatId — Chat ID
   * @param question — Poll question
   * @param answers — Answer options (2-10)
   * @param opts — Anonymous, multiple choice options
   * @returns Message ID of the poll
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  createPoll(
    chatId: string,
    question: string,
    answers: string[],
    opts?: PollOptions
  ): Promise<number | null>;

  /**
   * Create a quiz (poll with correct answer) in a chat.
   *
   * @param chatId — Chat ID
   * @param question — Quiz question
   * @param answers — Answer options
   * @param correctIndex — Index of the correct answer (0-based)
   * @param explanation — Explanation shown after answering
   * @returns Message ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  createQuiz(
    chatId: string,
    question: string,
    answers: string[],
    correctIndex: number,
    explanation?: string
  ): Promise<number | null>;

  // ─── Moderation ────────────────────────────────────────────

  /**
   * Ban a user from a group/channel.
   *
   * @param chatId — Group/channel ID
   * @param userId — User ID to ban
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  banUser(chatId: string, userId: number | string): Promise<void>;

  /**
   * Unban a user from a group/channel.
   *
   * @param chatId — Group/channel ID
   * @param userId — User ID to unban
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  unbanUser(chatId: string, userId: number | string): Promise<void>;

  /**
   * Mute a user in a group (restrict sending messages).
   *
   * @param chatId — Group/channel ID
   * @param userId — User ID to mute
   * @param untilDate — Unix timestamp when mute expires (0 = forever)
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  muteUser(chatId: string, userId: number | string, untilDate: number): Promise<void>;

  // ─── Stars & Gifts ─────────────────────────────────────────

  /**
   * Get current Telegram Stars balance.
   *
   * @returns Stars balance
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  getStarsBalance(): Promise<number>;

  /**
   * Send a star gift to a user.
   *
   * @param userId — Recipient user ID
   * @param giftId — Gift ID from catalog
   * @param opts — Optional message and anonymity
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendGift(
    userId: number | string,
    giftId: string,
    opts?: { message?: string; anonymous?: boolean }
  ): Promise<void>;

  /**
   * Get available star gifts catalog.
   *
   * @returns Array of available gifts
   */
  getAvailableGifts(): Promise<StarGift[]>;

  /**
   * Get star gifts received by the bot.
   *
   * @param limit — Max gifts to return (default: 50)
   * @returns Array of received gifts
   */
  getMyGifts(limit?: number): Promise<ReceivedGift[]>;

  /**
   * Get star gifts available for resale from a specific collection.
   *
   * @param giftId — Collection ID (numeric string from getAvailableGifts)
   * @param limit — Max results (default: 50)
   * @returns Array of resale gift listings
   */
  getResaleGifts(giftId: string, limit?: number): Promise<StarGift[]>;

  /**
   * Buy a star gift from resale market.
   *
   * @param giftId — Gift ID to purchase
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  buyResaleGift(giftId: string): Promise<void>;

  /**
   * Post a story to the bot's profile.
   *
   * @param mediaPath — Path to photo/video file
   * @param opts — Caption options
   * @returns Story ID
   * @throws {PluginSDKError} BRIDGE_NOT_CONNECTED, OPERATION_FAILED
   */
  sendStory(mediaPath: string, opts?: { caption?: string }): Promise<number | null>;

  // ─── Advanced ──────────────────────────────────────────────

  /**
   * Show "typing..." indicator in a chat.
   *
   * @param chatId — Chat ID
   */
  setTyping(chatId: string): Promise<void>;

  // ─── Scheduled Messages ───────────────────────────────────

  /**
   * Get scheduled messages in a chat.
   * @param chatId — Chat ID
   * @returns Array of scheduled messages
   */
  getScheduledMessages(chatId: string): Promise<SimpleMessage[]>;

  /**
   * Delete a scheduled message.
   * @param chatId — Chat ID
   * @param messageId — Scheduled message ID
   */
  deleteScheduledMessage(chatId: string, messageId: number): Promise<void>;

  /**
   * Send a scheduled message immediately.
   * @param chatId — Chat ID
   * @param messageId — Scheduled message ID
   */
  sendScheduledNow(chatId: string, messageId: number): Promise<void>;

  // ─── Chat ─────────────────────────────────────────────────

  /**
   * Get all dialogs (conversations).
   * @param limit — Max dialogs (default: 50, max: 100)
   * @returns Array of dialog info
   */
  getDialogs(limit?: number): Promise<Dialog[]>;

  /**
   * Get message history from a chat.
   * @param chatId — Chat ID or @username
   * @param limit — Max messages (default: 50, max: 100)
   * @returns Array of messages
   */
  getHistory(chatId: string, limit?: number): Promise<SimpleMessage[]>;

  // ─── Extended Moderation ──────────────────────────────────

  /**
   * Kick a user from a group (ban + immediate unban).
   * @param chatId — Group/channel ID
   * @param userId — User ID to kick
   */
  kickUser(chatId: string, userId: number | string): Promise<void>;

  // ─── Extended Stars & Gifts ───────────────────────────────

  /**
   * Get Stars transaction history.
   * @param limit — Max transactions (default: 50)
   * @returns Array of transactions
   */
  getStarsTransactions(limit?: number): Promise<StarsTransaction[]>;

  /**
   * Transfer a collectible gift to another user.
   * @param msgId — Message ID of the gift (from getMyGifts)
   * @param toUserId — Recipient user ID or @username
   * @returns Transfer result
   */
  transferCollectible(msgId: number, toUserId: number | string): Promise<TransferResult>;

  /**
   * Set or remove the resale price of a collectible.
   * @param msgId — Message ID of the collectible
   * @param price — Price in Stars (0 to unlist)
   */
  setCollectiblePrice(msgId: number, price: number): Promise<void>;

  /**
   * Get info about a Fragment collectible (username or phone).
   * @param slug — Username (without @) or phone number
   * @returns Collectible info, or null if not found
   */
  getCollectibleInfo(slug: string): Promise<CollectibleInfo | null>;

  /**
   * Look up a unique NFT gift by its slug.
   * @param slug — NFT slug from t.me/nft/<slug>
   * @returns Unique gift info, or null if not found
   */
  getUniqueGift(slug: string): Promise<UniqueGift | null>;

  /**
   * Get the market value of a unique NFT gift.
   * @param slug — NFT slug
   * @returns Gift value info, or null if not found
   */
  getUniqueGiftValue(slug: string): Promise<GiftValue | null>;

  /**
   * Send a buy offer on a unique NFT gift to its owner.
   * @param userId — Owner's user ID or @username
   * @param giftMsgId — Slug of the NFT gift
   * @param price — Offer price in Stars
   * @param opts — Duration options
   */
  sendGiftOffer(
    userId: number | string,
    giftSlug: string,
    price: number,
    opts?: GiftOfferOptions
  ): Promise<void>;
}
