import { createHash } from "node:crypto";
import { Api } from "telegram";
import { getInputPeer, getPeerId } from "telegram/Utils.js";
import { mapTelegramError } from "../../../../sdk/telegram-utils.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { toLong } from "../../../../utils/gramjs-bigint.js";

export type TelegramSearchSort =
  | "telegram"
  | "date_desc"
  | "date_asc"
  | "views_desc"
  | "forwards_desc";

export type TelegramSearchPeerType = "all" | "channels" | "groups" | "users";

export type TelegramSearchMessageType =
  | "all"
  | "photos"
  | "videos"
  | "photo_video"
  | "documents"
  | "links"
  | "gifs"
  | "voice"
  | "music"
  | "round_video"
  | "polls"
  | "pinned";

export interface TelegramSearchHit {
  id: number;
  text: string;
  date: number;
  timestamp: string;
  chatId: string;
  chatType: "dm" | "group" | "channel" | "unknown";
  chatTitle: string | null;
  chatUsername: string | null;
  senderId: string | null;
  senderName: string | null;
  senderUsername: string | null;
  postAuthor: string | null;
  mediaType: string | null;
  isPost: boolean;
  views: number | null;
  forwards: number | null;
  reactions: number | null;
  replies: number | null;
  link: string | null;
}

export interface TelegramSearchQuota {
  queryIsFree: boolean;
  totalDaily: number;
  remaining: number;
  waitUntil: number | null;
  waitUntilIso: string | null;
  starsRequired: string;
}

type SearchEntity = Api.TypeUser | Api.TypeChat;

type CursorPeer =
  | { type: "self" }
  | { type: "user"; id: string; accessHash: string }
  | { type: "chat"; id: string }
  | { type: "channel"; id: string; accessHash: string };

interface SearchCursorPayload {
  v: 1;
  kind: "global" | "posts";
  requestHash: string;
  offsetRate: number;
  offsetId: number;
  seen: number;
  peer: CursorPeer;
}

export interface SearchOffset {
  offsetRate: number;
  offsetPeer: Api.TypeInputPeer;
  offsetId: number;
  seen: number;
}

export interface ExtractedSearchPage {
  rawMessages: Api.TypeMessage[];
  hits: TelegramSearchHit[];
  total: number | null;
  inexact: boolean;
  nextRate: number | null;
  searchFlood: Api.SearchPostsFlood | null;
  entities: Map<string, SearchEntity>;
}

const SEARCH_CURSOR_MAX_LENGTH = 2048;
const MAX_TELEGRAM_DATE = 2_147_483_647;
const DECIMAL_INTEGER_RE = /^-?\d+$/;
const REQUEST_HASH_RE = /^[a-f0-9]{64}$/;

export const initialSearchOffset: SearchOffset = {
  offsetRate: 0,
  offsetPeer: new Api.InputPeerEmpty(),
  offsetId: 0,
  seen: 0,
};

export function normalizeSearchText(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function normalizeHashtag(value: string | undefined): string {
  return normalizeSearchText(value).replace(/^#+/, "").trim();
}

export function createSearchRequestHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function parseSearchDate(
  value: string | undefined,
  fieldName: string
): { ok: true; value: number } | { ok: false; error: string } {
  if (!value) return { ok: true, value: 0 };

  const clean = value.trim();
  let unixSeconds: number;
  if (/^\d+$/.test(clean)) {
    unixSeconds = Number(clean);
  } else {
    const milliseconds = Date.parse(clean);
    if (!Number.isFinite(milliseconds)) {
      return {
        ok: false,
        error: `${fieldName} must be an ISO 8601 date or Unix timestamp in seconds`,
      };
    }
    unixSeconds = Math.floor(milliseconds / 1000);
  }

  if (!Number.isSafeInteger(unixSeconds) || unixSeconds < 0 || unixSeconds > MAX_TELEGRAM_DATE) {
    return {
      ok: false,
      error: `${fieldName} is outside Telegram's supported timestamp range`,
    };
  }

  return { ok: true, value: unixSeconds };
}

export function getMessagesFilter(messageType: TelegramSearchMessageType): Api.TypeMessagesFilter {
  switch (messageType) {
    case "photos":
      return new Api.InputMessagesFilterPhotos();
    case "videos":
      return new Api.InputMessagesFilterVideo();
    case "photo_video":
      return new Api.InputMessagesFilterPhotoVideo();
    case "documents":
      return new Api.InputMessagesFilterDocument();
    case "links":
      return new Api.InputMessagesFilterUrl();
    case "gifs":
      return new Api.InputMessagesFilterGif();
    case "voice":
      return new Api.InputMessagesFilterVoice();
    case "music":
      return new Api.InputMessagesFilterMusic();
    case "round_video":
      return new Api.InputMessagesFilterRoundVideo();
    case "polls":
      return new Api.InputMessagesFilterPoll();
    case "pinned":
      return new Api.InputMessagesFilterPinned();
    case "all":
      return new Api.InputMessagesFilterEmpty();
  }
}

function entityMapFromResponse(response: Api.messages.TypeMessages): Map<string, SearchEntity> {
  const entities = new Map<string, SearchEntity>();
  if (!("users" in response) || !("chats" in response)) return entities;

  for (const entity of [...response.users, ...response.chats]) {
    try {
      entities.set(getPeerId(entity), entity);
    } catch {
      // Telegram can return empty/deleted entities that have no usable peer ID.
    }
  }
  return entities;
}

function getEntityDetails(entity: SearchEntity | undefined): {
  type: TelegramSearchHit["chatType"];
  title: string | null;
  username: string | null;
} {
  if (entity instanceof Api.User) {
    return {
      type: "dm",
      title:
        [entity.firstName, entity.lastName].filter(Boolean).join(" ") || entity.username || null,
      username: entity.username ?? null,
    };
  }

  if (entity instanceof Api.Chat || entity instanceof Api.ChatForbidden) {
    return {
      type: "group",
      title: entity.title ?? null,
      username: null,
    };
  }

  if (entity instanceof Api.Channel || entity instanceof Api.ChannelForbidden) {
    return {
      type: entity.broadcast ? "channel" : "group",
      title: entity.title ?? null,
      username: entity instanceof Api.Channel ? (entity.username ?? null) : null,
    };
  }

  return { type: "unknown", title: null, username: null };
}

function getSenderDetails(entity: SearchEntity | undefined): {
  name: string | null;
  username: string | null;
} {
  if (entity instanceof Api.User) {
    return {
      name:
        [entity.firstName, entity.lastName].filter(Boolean).join(" ") || entity.username || null,
      username: entity.username ?? null,
    };
  }

  if (
    entity instanceof Api.Chat ||
    entity instanceof Api.ChatForbidden ||
    entity instanceof Api.Channel ||
    entity instanceof Api.ChannelForbidden
  ) {
    return {
      name: entity.title ?? null,
      username: entity instanceof Api.Channel ? (entity.username ?? null) : null,
    };
  }

  return { name: null, username: null };
}

function classifyDocument(document: Api.TypeDocument | undefined): string {
  if (!(document instanceof Api.Document)) return "document";

  const attributes = document.attributes;
  if (attributes.some((attribute) => attribute instanceof Api.DocumentAttributeSticker)) {
    return "sticker";
  }

  const audio = attributes.find(
    (attribute): attribute is Api.DocumentAttributeAudio =>
      attribute instanceof Api.DocumentAttributeAudio
  );
  if (audio) return audio.voice ? "voice" : "music";

  if (attributes.some((attribute) => attribute instanceof Api.DocumentAttributeAnimated)) {
    return "gif";
  }

  const video = attributes.find(
    (attribute): attribute is Api.DocumentAttributeVideo =>
      attribute instanceof Api.DocumentAttributeVideo
  );
  if (video) return video.roundMessage ? "round_video" : "video";

  return "document";
}

function classifyMedia(media: Api.TypeMessageMedia | undefined): string | null {
  if (!media || media instanceof Api.MessageMediaEmpty) return null;
  if (media instanceof Api.MessageMediaPhoto) return "photo";
  if (media instanceof Api.MessageMediaDocument) return classifyDocument(media.document);
  if (media instanceof Api.MessageMediaPoll) return "poll";
  if (media instanceof Api.MessageMediaWebPage) return "link";
  if (
    media instanceof Api.MessageMediaGeo ||
    media instanceof Api.MessageMediaGeoLive ||
    media instanceof Api.MessageMediaVenue
  ) {
    return "location";
  }
  if (media instanceof Api.MessageMediaContact) return "contact";
  if (media instanceof Api.MessageMediaDice) return "dice";
  if (media instanceof Api.MessageMediaStory) return "story";
  return "other";
}

function buildMessageLink(
  messageId: number,
  chatId: string,
  chatType: TelegramSearchHit["chatType"],
  username: string | null
): string | null {
  if (username) return `https://t.me/${username.replace(/^@/, "")}/${messageId}`;
  if ((chatType === "channel" || chatType === "group") && chatId.startsWith("-100")) {
    return `https://t.me/c/${chatId.slice(4)}/${messageId}`;
  }
  return null;
}

function reactionCount(message: Api.Message): number | null {
  if (!message.reactions) return null;
  return message.reactions.results.reduce((total, reaction) => total + reaction.count, 0);
}

function formatSearchHit(
  message: Api.Message,
  entities: Map<string, SearchEntity>
): TelegramSearchHit {
  const chatId = getPeerId(message.peerId);
  const chatEntity = entities.get(chatId);
  const chat = getEntityDetails(chatEntity);
  const senderPeer = message.fromId ?? (message.post ? message.peerId : undefined);
  const senderId = senderPeer ? getPeerId(senderPeer) : null;
  const sender = getSenderDetails(senderId ? entities.get(senderId) : undefined);

  return {
    id: message.id,
    text: message.message ?? "",
    date: message.date,
    timestamp: new Date(message.date * 1000).toISOString(),
    chatId,
    chatType: chat.type,
    chatTitle: chat.title,
    chatUsername: chat.username,
    senderId,
    senderName: sender.name,
    senderUsername: sender.username,
    postAuthor: message.postAuthor ?? null,
    mediaType: classifyMedia(message.media),
    isPost: message.post ?? false,
    views: message.views ?? null,
    forwards: message.forwards ?? null,
    reactions: reactionCount(message),
    replies: message.replies?.replies ?? null,
    link: buildMessageLink(message.id, chatId, chat.type, chat.username),
  };
}

export function extractSearchPage(response: Api.messages.TypeMessages): ExtractedSearchPage {
  const entities = entityMapFromResponse(response);
  const rawMessages = "messages" in response ? response.messages : [];
  const hits = rawMessages
    .filter((message): message is Api.Message => message instanceof Api.Message)
    .map((message) => formatSearchHit(message, entities));

  return {
    rawMessages,
    hits,
    total: "count" in response ? response.count : rawMessages.length,
    inexact: "inexact" in response ? (response.inexact ?? false) : false,
    nextRate: "nextRate" in response ? (response.nextRate ?? null) : null,
    searchFlood: "searchFlood" in response ? (response.searchFlood ?? null) : null,
    entities,
  };
}

export function sortSearchHits(
  hits: TelegramSearchHit[],
  sort: TelegramSearchSort
): TelegramSearchHit[] {
  if (sort === "telegram") return [...hits];

  return hits
    .map((hit, index) => ({ hit, index }))
    .sort((left, right) => {
      let difference = 0;
      if (sort === "date_desc") difference = right.hit.date - left.hit.date;
      if (sort === "date_asc") difference = left.hit.date - right.hit.date;
      if (sort === "views_desc") {
        difference = (right.hit.views ?? 0) - (left.hit.views ?? 0);
      }
      if (sort === "forwards_desc") {
        difference = (right.hit.forwards ?? 0) - (left.hit.forwards ?? 0);
      }
      return difference || left.index - right.index;
    })
    .map(({ hit }) => hit);
}

function serializeInputPeer(peer: Api.TypeInputPeer): CursorPeer | null {
  if (peer instanceof Api.InputPeerSelf) return { type: "self" };
  if (peer instanceof Api.InputPeerUser) {
    return {
      type: "user",
      id: peer.userId.toString(),
      accessHash: peer.accessHash.toString(),
    };
  }
  if (peer instanceof Api.InputPeerChat) {
    return { type: "chat", id: peer.chatId.toString() };
  }
  if (peer instanceof Api.InputPeerChannel) {
    return {
      type: "channel",
      id: peer.channelId.toString(),
      accessHash: peer.accessHash.toString(),
    };
  }
  return null;
}

function deserializeInputPeer(peer: CursorPeer): Api.TypeInputPeer {
  switch (peer.type) {
    case "self":
      return new Api.InputPeerSelf();
    case "user":
      return new Api.InputPeerUser({
        userId: toLong(peer.id),
        accessHash: toLong(peer.accessHash),
      });
    case "chat":
      return new Api.InputPeerChat({ chatId: toLong(peer.id) });
    case "channel":
      return new Api.InputPeerChannel({
        channelId: toLong(peer.id),
        accessHash: toLong(peer.accessHash),
      });
  }
}

function isSafeOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_INTEGER_RE.test(value);
}

function isCursorPeer(value: unknown): value is CursorPeer {
  if (!value || typeof value !== "object") return false;
  const peer = value as Record<string, unknown>;
  if (peer.type === "self") return true;
  if (peer.type === "chat") return isDecimalString(peer.id);
  if (peer.type === "user" || peer.type === "channel") {
    return isDecimalString(peer.id) && isDecimalString(peer.accessHash);
  }
  return false;
}

export function decodeSearchCursor(
  cursor: string | undefined,
  expectedKind: SearchCursorPayload["kind"],
  expectedRequestHash: string
): { ok: true; offset: SearchOffset } | { ok: false; error: string } {
  if (!cursor) return { ok: true, offset: initialSearchOffset };
  if (cursor.length > SEARCH_CURSOR_MAX_LENGTH) {
    return { ok: false, error: "Invalid search cursor: value is too long" };
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("payload is not an object");
    const payload = parsed as Record<string, unknown>;

    if (payload.v !== 1) throw new Error("unsupported version");
    if (payload.kind !== expectedKind) throw new Error("wrong search type");
    if (
      typeof payload.requestHash !== "string" ||
      !REQUEST_HASH_RE.test(payload.requestHash) ||
      payload.requestHash !== expectedRequestHash
    ) {
      throw new Error("cursor does not match this search");
    }
    if (
      !isSafeOffset(payload.offsetRate) ||
      !isSafeOffset(payload.offsetId) ||
      !isSafeOffset(payload.seen) ||
      !isCursorPeer(payload.peer)
    ) {
      throw new Error("invalid pagination offsets");
    }

    return {
      ok: true,
      offset: {
        offsetRate: payload.offsetRate,
        offsetPeer: deserializeInputPeer(payload.peer),
        offsetId: payload.offsetId,
        seen: payload.seen,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid search cursor: ${getErrorMessage(error)}`,
    };
  }
}

function findLastOffsetMessage(
  rawMessages: Api.TypeMessage[]
): Api.Message | Api.MessageService | null {
  for (let index = rawMessages.length - 1; index >= 0; index--) {
    const message = rawMessages[index];
    if (message instanceof Api.Message || message instanceof Api.MessageService) {
      return message;
    }
  }
  return null;
}

export function createNextSearchCursor(options: {
  kind: SearchCursorPayload["kind"];
  requestHash: string;
  page: ExtractedSearchPage;
  limit: number;
  previousSeen: number;
}): { hasMore: boolean; nextCursor: string | null } {
  const { kind, requestHash, page, limit, previousSeen } = options;
  const seen = previousSeen + page.rawMessages.length;
  const countIndicatesMore = !page.inexact && page.total !== null && seen < page.total;
  const hasPossibleContinuation =
    page.nextRate !== null || page.rawMessages.length >= limit || countIndicatesMore;
  if (!hasPossibleContinuation || page.rawMessages.length === 0) {
    return { hasMore: false, nextCursor: null };
  }

  const lastMessage = findLastOffsetMessage(page.rawMessages);
  if (!lastMessage) return { hasMore: false, nextCursor: null };

  const entity = page.entities.get(getPeerId(lastMessage.peerId));
  if (!entity) return { hasMore: false, nextCursor: null };

  let inputPeer: Api.TypeInputPeer;
  try {
    inputPeer = getInputPeer(entity);
  } catch {
    return { hasMore: false, nextCursor: null };
  }
  const peer = serializeInputPeer(inputPeer);
  if (!peer) return { hasMore: false, nextCursor: null };

  const payload: SearchCursorPayload = {
    v: 1,
    kind,
    requestHash,
    offsetRate: page.nextRate ?? lastMessage.date,
    offsetId: lastMessage.id,
    seen,
    peer,
  };

  return {
    hasMore: true,
    nextCursor: Buffer.from(JSON.stringify(payload)).toString("base64url"),
  };
}

export function normalizeSearchQuota(quota: Api.SearchPostsFlood): TelegramSearchQuota {
  const waitUntil = quota.waitTill ?? null;
  return {
    queryIsFree: quota.queryIsFree ?? false,
    totalDaily: quota.totalDaily,
    remaining: quota.remains,
    waitUntil,
    waitUntilIso: waitUntil === null ? null : new Date(waitUntil * 1000).toISOString(),
    starsRequired: quota.starsAmount.toString(),
  };
}

export function mapSearchTelegramError(
  error: unknown,
  overrides: Record<string, string> = {}
): { success: false; error: string } {
  const message = getErrorMessage(error);
  const floodMatch = message.match(/FLOOD_WAIT[_\s-]*(\d+)/i);
  if (floodMatch) {
    return {
      success: false,
      error: `Telegram rate limit reached. Retry after ${floodMatch[1]} seconds.`,
    };
  }

  return mapTelegramError(error, {
    SEARCH_QUERY_EMPTY: "Telegram rejected the empty search query.",
    FOLDER_ID_INVALID: "The Telegram folder ID is invalid.",
    INPUT_FILTER_INVALID: "Telegram does not support this filter for global search.",
    OFFSET_PEER_ID_INVALID: "The search cursor references an invalid Telegram peer.",
    PREMIUM_ACCOUNT_REQUIRED: "Telegram Premium is required for this public post search.",
    FROZEN_METHOD_INVALID: "This Telegram account is frozen and cannot search public posts.",
    ...overrides,
  });
}
