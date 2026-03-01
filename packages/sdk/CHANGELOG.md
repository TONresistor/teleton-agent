# Changelog

All notable changes to `@teleton-agent/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Fixed
- `getResaleGifts` signature: first param is `giftId` (collection ID), not omitted

## [1.0.0] - 2025-06-15

### Added
- Initial release
- **TON**: wallet, balance, price, transfers, jettons, NFTs, payment verification
- **Telegram**: messaging, media, chat info, polls, moderation, stars, gifts, stories
- **Secrets**: 3-tier resolution (env → secrets store → config)
- **Storage**: KV store with TTL
- **Plugin lifecycle**: manifest, migrate, tools, start, stop, onMessage, onCallbackQuery
- Error handling with `PluginSDKError` and typed error codes
- Frozen SDK objects for plugin isolation
