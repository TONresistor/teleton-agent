# Changelog

All notable changes to `@teleton-agent/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] - 2026-07-11

### Added

- `telegram.sendInlineBotResult(chatId, botUsername, query, index?)` safely queries a third-party inline bot and sends the selected result without exposing the raw Telegram client.
- `InlineBotResult` describes the normalized result metadata returned to plugins.
- `ton.highload` preserves Highload Wallet v3 addresses while core owns signing, transaction serialization, and persistent query IDs.

## [2.0.0] - 2026-07-10

### Breaking

- `getResaleGifts(giftId, limit?)` now requires the collection `giftId`; the previous signature could not query the Telegram API correctly.
- Invalid exported plugin manifests now fail closed instead of being silently ignored.
- Plugin tool scopes are validated against the canonical SDK scope list.
- `start(ctx)` now receives `ctx.sdk` instead of the raw Telegram bridge.
- `PluginToolContext.bridge` and `sdk.telegram.getRawClient()` were removed; plugins use the typed SDK capabilities instead.
- Secret environment overrides are restricted to the declaring plugin's namespace.

### Security

- Plugin lifecycle methods and tool executors always receive the isolated plugin database handle, never the agent database.
- `ATTACH DATABASE` and `DETACH DATABASE` remain blocked on every plugin-facing database surface.
- External action tools require authenticated owner approval by default; data-bearing tools can opt in with `requiresApproval`.

### Changed

- `PluginManifest`, hook names, tool scopes, and tool categories are aligned with runtime validation.
- SDK version compatibility parsing is strict and follows caret semantics for `0.0.x` releases.
- SDK types are split by TON, Telegram, plugin, and common domains while preserving the root import path.

### Added

#### TON — Jetton Analytics
- `getJettonPrice(jettonAddress)` — USD/TON price with 24h/7d/30d changes
- `getJettonHolders(jettonAddress, limit?)` — Top holders ranked by balance
- `getJettonHistory(jettonAddress)` — Market analytics (volume, FDV, market cap, holders)

#### TON — DEX (`sdk.ton.dex`)
- `quote(params)` — Compare quotes from STON.fi and DeDust in parallel
- `quoteSTONfi(params)` / `quoteDeDust(params)` — Single-DEX quotes
- `swap(params)` — Execute swap via best DEX (or forced)
- `swapSTONfi(params)` / `swapDeDust(params)` — Single-DEX swaps
- Types: `DexSDK`, `DexQuoteParams`, `DexQuoteResult`, `DexSingleQuote`, `DexSwapParams`, `DexSwapResult`

#### TON — DNS (`sdk.ton.dns`)
- `check(domain)` — Availability, owner, auction status
- `resolve(domain)` — Resolve .ton domain to wallet address
- `getAuctions(limit?)` — List active DNS auctions
- `startAuction(domain)` — Initiate auction for available domain
- `bid(domain, amount)` — Place bid on active auction
- `link(domain, address)` / `unlink(domain)` — Manage domain-wallet links
- `setSiteRecord(domain, adnlAddress)` — Set TON Site (ADNL) record on a .ton domain
- Types: `DnsSDK`, `DnsCheckResult`, `DnsResolveResult`, `DnsAuction`, `DnsAuctionResult`, `DnsBidResult`

#### Telegram — Scheduled Messages
- `getScheduledMessages(chatId)` — List scheduled messages
- `deleteScheduledMessage(chatId, messageId)` — Delete a scheduled message
- `sendScheduledNow(chatId, messageId)` — Send immediately

#### Telegram — Chat & History
- `getDialogs(limit?)` — Get all conversations with unread counts
- `getHistory(chatId, limit?)` — Get message history
- Type: `Dialog`

#### Telegram — Extended Moderation
- `kickUser(chatId, userId)` — Ban + immediate unban

#### Telegram — Stars & Collectibles
- `getStarsTransactions(limit?)` — Stars transaction history
- `transferCollectible(msgId, toUserId)` — Transfer collectible gift
- `setCollectiblePrice(msgId, price)` — Set/remove resale price
- `getCollectibleInfo(slug)` — Fragment collectible info (username/phone)
- `getUniqueGift(slug)` — NFT gift details by slug
- `getUniqueGiftValue(slug)` — Market valuation (floor, average, last sale)
- `sendGiftOffer(userId, giftSlug, price, opts?)` — Make buy offer
- Types: `StarsTransaction`, `TransferResult`, `CollectibleInfo`, `UniqueGift`, `GiftValue`, `GiftOfferOptions`

## [1.0.0] - 2026-02-16

### Added
- Initial release
- **TON**: wallet, balance, price, transfers, jettons, NFTs, payment verification
- **Telegram**: messaging, media, chat info, polls, moderation, stars, gifts, stories
- **Secrets**: 3-tier resolution (env → secrets store → config)
- **Storage**: KV store with TTL
- **Plugin lifecycle**: manifest, migrate, tools, start, stop, onMessage, onCallbackQuery
- Error handling with `PluginSDKError` and typed error codes
- Frozen SDK objects for plugin isolation
