# @teleton-agent/sdk

**Plugin SDK for Teleton Agent** — TypeScript types and utilities for building plugins that interact with Telegram and the TON blockchain.

[![npm](https://img.shields.io/npm/v/@teleton-agent/sdk?style=flat-square)](https://www.npmjs.com/package/@teleton-agent/sdk)
[![license](https://img.shields.io/npm/l/@teleton-agent/sdk?style=flat-square)](https://github.com/TONresistor/teleton-agent/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-blue?style=flat-square)](https://www.typescriptlang.org/)

---

## Install

```bash
npm install @teleton-agent/sdk
```

The package ships type definitions and the `PluginSDKError` class. It has an optional peer dependency on `better-sqlite3` (used only if your plugin needs a database).

## Quick Start

A Teleton plugin is a module that exports a `tools` function and, optionally, `manifest`, `start`, and `migrate`.

```typescript
import type { PluginSDK, SimpleToolDef, PluginManifest } from "@teleton-agent/sdk";

export const manifest: PluginManifest = {
  name: "greeting",
  version: "1.0.0",
  description: "Sends a greeting with the bot's TON balance",
};

export const tools = (sdk: PluginSDK): SimpleToolDef[] => [
  {
    name: "greeting_hello",
    description: "Greet the user and show the bot wallet balance",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "User's name" },
      },
      required: ["name"],
    },
    async execute(params, context) {
      const balance = await sdk.ton.getBalance();
      const text = `Hello ${params.name}! Bot balance: ${balance?.balance ?? "unknown"} TON`;
      await sdk.telegram.sendMessage(String(context.chatId), text);
      return { success: true, data: { greeting: text } };
    },
  },
];
```

Place the compiled plugin at `~/.teleton/plugins/<name>/index.js` and register it in `config.yaml`:

```yaml
plugins:
  greeting:
    enabled: true
```

## Plugin Lifecycle

The core platform loads plugins in a defined order. Each export is optional except `tools`.

| Export | Signature | When Called | Purpose |
|--------|-----------|------------|---------|
| `manifest` | `PluginManifest` | Load time | Declares name, version, dependencies, default config |
| `migrate` | `(db: Database) => void` | Before `tools`, once | Create/alter tables in the plugin's isolated SQLite DB |
| `tools` | `SimpleToolDef[] \| (sdk: PluginSDK) => SimpleToolDef[]` | After migrate | Register tools the LLM can invoke |
| `start` | `(ctx) => Promise<void>` | After bridge connects | Run background tasks, set up intervals |
| `stop` | `() => Promise<void>` | On shutdown / hot-reload | Cleanup timers, close connections |
| `onMessage` | `(event: PluginMessageEvent) => Promise<void>` | Every incoming message | React to messages without LLM involvement |
| `onCallbackQuery` | `(event: PluginCallbackEvent) => Promise<void>` | Inline button press | Handle callback queries from inline keyboards |

The `tools` export can be either a static array or a factory function receiving the SDK. The `start` function receives a context object with `db`, `config`, `pluginConfig`, and `log`. The SDK object passed to `tools` is **frozen** -- plugins cannot modify or extend it. Each plugin receives its own isolated database (if `migrate` is exported) and a sanitized config object with no API keys.

### Event Hooks

Plugins can export `onMessage` and `onCallbackQuery` to react to Telegram events directly, without going through the LLM agentic loop. These hooks are **fire-and-forget** — errors are caught per plugin and logged, so a failing hook never blocks message processing or other plugins.

#### `onMessage`

Called for every incoming message (DMs and groups), after the message is stored to the feed database. This fires regardless of whether the agent will respond to the message.

```typescript
import type { PluginMessageEvent } from "@teleton-agent/sdk";

export async function onMessage(event: PluginMessageEvent) {
  // Auto-moderation example: delete messages containing banned words
  if (event.isGroup && /spam|scam/i.test(event.text)) {
    console.log(`Flagged message ${event.messageId} from ${event.senderId}`);
  }
}
```

#### `onCallbackQuery`

Called when a user presses an inline keyboard button. The `data` string is split on `:` into `action` (first segment) and `params` (remaining segments). **You must call `event.answer()`** to dismiss the loading spinner on the user's client.

```typescript
import type { PluginCallbackEvent } from "@teleton-agent/sdk";

export async function onCallbackQuery(event: PluginCallbackEvent) {
  // Button data format: "myplugin:action:param1:param2"
  if (event.action !== "myplugin") return; // Not for this plugin

  const [subAction, ...args] = event.params;

  if (subAction === "confirm") {
    await event.answer("Confirmed!", false); // Toast notification
    // ... handle the confirmation
  } else {
    await event.answer("Unknown action", true); // Alert popup
  }
}
```

> **Tip:** Namespace your callback data with your plugin name (e.g. `"casino:bet:100"`) so multiple plugins can coexist without action collisions. All registered `onCallbackQuery` hooks receive every callback event — filter by `event.action` to handle only your own buttons.

## API Reference

### Core

#### `PluginSDK`

Root SDK object passed to plugin functions.

| Property | Type | Description |
|----------|------|-------------|
| `version` | `string` | SDK version (semver) |
| `ton` | `TonSDK` | TON blockchain operations |
| `telegram` | `TelegramSDK` | Telegram messaging and user operations |
| `secrets` | `SecretsSDK` | Secure access to plugin secrets (API keys, tokens) |
| `storage` | `StorageSDK \| null` | Simple key-value storage (null if no DB) |
| `db` | `Database \| null` | Isolated SQLite database (null if no `migrate` exported) |
| `config` | `Record<string, unknown>` | Sanitized app config (no secrets) |
| `pluginConfig` | `Record<string, unknown>` | Plugin-specific config from `config.yaml` |
| `log` | `PluginLogger` | Prefixed logger |

#### `PluginLogger`

All methods auto-prefix output with the plugin name.

| Method | Description |
|--------|-------------|
| `info(...args)` | Informational message |
| `warn(...args)` | Warning |
| `error(...args)` | Error |
| `debug(...args)` | Debug (visible only when `DEBUG` or `VERBOSE` is set) |

#### `PluginSDKError`

```typescript
import { PluginSDKError } from "@teleton-agent/sdk";
```

Extends `Error` with a `code` property for programmatic handling.

| Property | Type | Description |
|----------|------|-------------|
| `name` | `"PluginSDKError"` | Always `"PluginSDKError"` |
| `code` | `SDKErrorCode` | Machine-readable error code |
| `message` | `string` | Human-readable description |

#### `SDKErrorCode`

```typescript
type SDKErrorCode =
  | "BRIDGE_NOT_CONNECTED"   // Telegram bridge not ready
  | "WALLET_NOT_INITIALIZED" // TON wallet not configured
  | "INVALID_ADDRESS"        // Malformed TON address
  | "SECRET_NOT_FOUND"       // Required secret not configured
  | "OPERATION_FAILED";      // Generic failure
```

#### `SDK_VERSION`

```typescript
import { SDK_VERSION } from "@teleton-agent/sdk";
// "1.0.0"
```

---

### TON

#### `TonSDK`

| Method | Returns | Description |
|--------|---------|-------------|
| `getAddress()` | `string \| null` | Bot's wallet address |
| `getBalance(address?)` | `Promise<TonBalance \| null>` | Balance for an address (defaults to bot) |
| `getPrice()` | `Promise<TonPrice \| null>` | Current TON/USD price (cached 30s) |
| `sendTON(to, amount, comment?)` | `Promise<TonSendResult>` | Send TON (irreversible) |
| `getTransactions(address, limit?)` | `Promise<TonTransaction[]>` | Transaction history (max 50) |
| `verifyPayment(params)` | `Promise<SDKPaymentVerification>` | Verify incoming payment with replay protection |
| `getJettonBalances(ownerAddress?)` | `Promise<JettonBalance[]>` | Jetton balances (defaults to bot wallet) |
| `getJettonInfo(jettonAddress)` | `Promise<JettonInfo \| null>` | Jetton metadata (name, symbol, decimals) |
| `sendJetton(jettonAddress, to, amount, opts?)` | `Promise<JettonSendResult>` | Transfer jetton tokens (irreversible) |
| `getJettonWalletAddress(ownerAddress, jettonAddress)` | `Promise<string \| null>` | Get jetton wallet address for owner |
| `getNftItems(ownerAddress?)` | `Promise<NftItem[]>` | NFTs owned by address (defaults to bot) |
| `getNftInfo(nftAddress)` | `Promise<NftItem \| null>` | NFT item metadata |
| `toNano(amount)` | `bigint` | Convert TON to nanoTON |
| `fromNano(nano)` | `string` | Convert nanoTON to TON string |
| `validateAddress(address)` | `boolean` | Validate TON address format |
| `getJettonPrice(jettonAddress)` | `Promise<JettonPrice \| null>` | Jetton USD/TON price with 24h/7d/30d changes |
| `getJettonHolders(jettonAddress, limit?)` | `Promise<JettonHolder[]>` | Top holders ranked by balance (max 100) |
| `getJettonHistory(jettonAddress)` | `Promise<JettonHistory \| null>` | Market analytics: volume, FDV, market cap |
| `dex` | `DexSDK` | DEX quotes and swaps (STON.fi + DeDust) |
| `dns` | `DnsSDK` | .ton domain management and auctions |

#### `TonBalance`

| Field | Type | Description |
|-------|------|-------------|
| `balance` | `string` | Human-readable (e.g. `"12.50"`) |
| `balanceNano` | `string` | Balance in nanoTON |

#### `TonPrice`

| Field | Type | Description |
|-------|------|-------------|
| `usd` | `number` | Price in USD |
| `source` | `string` | `"TonAPI"` or `"CoinGecko"` |
| `timestamp` | `number` | Fetch time (ms since epoch) |

#### `TonSendResult`

| Field | Type | Description |
|-------|------|-------------|
| `txRef` | `string` | Reference: `seqno_timestamp_amount` |
| `amount` | `number` | Amount sent in TON |

#### `TonTransaction`

| Field | Type | Description |
|-------|------|-------------|
| `type` | `TransactionType` | Transaction type |
| `hash` | `string` | Blockchain tx hash (hex) |
| `amount` | `string?` | e.g. `"1.5 TON"` |
| `from` | `string?` | Sender address |
| `to` | `string?` | Recipient address |
| `comment` | `string \| null?` | Transaction memo |
| `date` | `string` | ISO 8601 date |
| `secondsAgo` | `number` | Age in seconds |
| `explorer` | `string` | Tonviewer link |
| `jettonAmount` | `string?` | Raw jetton amount |
| `jettonWallet` | `string?` | Jetton wallet address |
| `nftAddress` | `string?` | NFT address |
| `transfers` | `TonTransaction[]?` | Sub-transfers (for `multi_send`) |

#### `TransactionType`

```typescript
type TransactionType =
  | "ton_received" | "ton_sent"
  | "jetton_received" | "jetton_sent"
  | "nft_received" | "nft_sent"
  | "gas_refund" | "bounce"
  | "contract_call" | "multi_send";
```

#### `JettonBalance`

| Field | Type | Description |
|-------|------|-------------|
| `jettonAddress` | `string` | Jetton master contract address |
| `walletAddress` | `string` | Owner's jetton wallet address |
| `balance` | `string` | Raw balance (string to avoid precision loss) |
| `balanceFormatted` | `string` | Human-readable (e.g. `"100.50"`) |
| `symbol` | `string` | Token ticker (e.g. `"USDT"`) |
| `name` | `string` | Token name (e.g. `"Tether USD"`) |
| `decimals` | `number` | Token decimals (e.g. 6 for USDT) |
| `verified` | `boolean` | Whether verified on TonAPI |
| `usdPrice` | `number?` | USD price per token (if available) |

#### `JettonInfo`

| Field | Type | Description |
|-------|------|-------------|
| `address` | `string` | Jetton master contract address |
| `name` | `string` | Token name |
| `symbol` | `string` | Token ticker |
| `decimals` | `number` | Token decimals |
| `totalSupply` | `string` | Total supply in raw units |
| `holdersCount` | `number` | Number of unique holders |
| `verified` | `boolean` | Whether verified on TonAPI |
| `description` | `string?` | Token description |
| `image` | `string?` | Token image URL |

#### `JettonSendResult`

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether transaction was sent |
| `seqno` | `number` | Wallet sequence number used |

#### `NftItem`

| Field | Type | Description |
|-------|------|-------------|
| `address` | `string` | NFT item contract address |
| `index` | `number` | Index within collection |
| `ownerAddress` | `string?` | Current owner address |
| `collectionAddress` | `string?` | Collection contract address |
| `collectionName` | `string?` | Collection name |
| `name` | `string?` | NFT name |
| `description` | `string?` | NFT description |
| `image` | `string?` | NFT image URL |
| `verified` | `boolean` | Whether verified |

#### `SDKVerifyPaymentParams`

| Field | Type | Description |
|-------|------|-------------|
| `amount` | `number` | Expected amount in TON |
| `memo` | `string` | Expected comment (e.g. username) |
| `gameType` | `string` | Replay protection group |
| `maxAgeMinutes` | `number?` | Time window (default: 10) |

#### `SDKPaymentVerification`

| Field | Type | Description |
|-------|------|-------------|
| `verified` | `boolean` | Whether payment was found and valid |
| `txHash` | `string?` | Transaction hash (replay protection) |
| `amount` | `number?` | Verified amount |
| `playerWallet` | `string?` | Sender wallet (for payouts) |
| `date` | `string?` | ISO 8601 date |
| `secondsAgo` | `number?` | Age in seconds |
| `error` | `string?` | Failure reason |

#### `JettonPrice`

| Field | Type | Description |
|-------|------|-------------|
| `priceUSD` | `number \| null` | Price in USD |
| `priceTON` | `number \| null` | Price in TON |
| `change24h` | `string \| null` | 24h change (e.g. `"-2.5%"`) |
| `change7d` | `string \| null` | 7d change |
| `change30d` | `string \| null` | 30d change |

#### `JettonHolder`

| Field | Type | Description |
|-------|------|-------------|
| `rank` | `number` | Rank (1 = top holder) |
| `address` | `string` | Holder's TON address |
| `name` | `string \| null` | Known name (e.g. `"Binance"`) |
| `balance` | `string` | Formatted balance (e.g. `"1,234.56"`) |
| `balanceRaw` | `string` | Raw balance in smallest units |

#### `JettonHistory`

| Field | Type | Description |
|-------|------|-------------|
| `symbol` | `string` | Token symbol |
| `name` | `string` | Token name |
| `currentPrice` | `string` | Price in USD |
| `currentPriceTON` | `string` | Price in TON |
| `changes` | `{ "24h", "7d", "30d" }` | Price change percentages |
| `volume24h` | `string` | 24h trading volume (USD) |
| `fdv` | `string` | Fully diluted valuation |
| `marketCap` | `string` | Market cap |
| `holders` | `number` | Number of holders |

#### DEX — `sdk.ton.dex`

Dual DEX aggregator supporting STON.fi and DeDust. Compares quotes in parallel and recommends the best execution.

#### `DexSDK`

| Method | Returns | Description |
|--------|---------|-------------|
| `quote(params)` | `Promise<DexQuoteResult>` | Compare quotes from both DEXes |
| `quoteSTONfi(params)` | `Promise<DexSingleQuote \| null>` | Quote from STON.fi only |
| `quoteDeDust(params)` | `Promise<DexSingleQuote \| null>` | Quote from DeDust only |
| `swap(params)` | `Promise<DexSwapResult>` | Swap via best DEX (or forced) |
| `swapSTONfi(params)` | `Promise<DexSwapResult>` | Swap on STON.fi |
| `swapDeDust(params)` | `Promise<DexSwapResult>` | Swap on DeDust |

```typescript
// Get best quote for swapping 10 TON → USDT
const usdt = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const quote = await sdk.ton.dex.quote({
  fromAsset: "ton",
  toAsset: usdt,
  amount: 10,
  slippage: 0.01, // 1%
});
console.log(`Best: ${quote.recommended} → ${quote.stonfi?.expectedOutput ?? "N/A"} USDT`);

// Execute the swap
const result = await sdk.ton.dex.swap({ fromAsset: "ton", toAsset: usdt, amount: 10 });
```

#### `DexQuoteParams`

| Field | Type | Description |
|-------|------|-------------|
| `fromAsset` | `string` | `"ton"` or jetton master address |
| `toAsset` | `string` | `"ton"` or jetton master address |
| `amount` | `number` | Amount in human-readable units |
| `slippage` | `number?` | Tolerance (0.01 = 1%, default: 0.01) |

#### `DexQuoteResult`

| Field | Type | Description |
|-------|------|-------------|
| `stonfi` | `DexSingleQuote \| null` | STON.fi quote |
| `dedust` | `DexSingleQuote \| null` | DeDust quote |
| `recommended` | `"stonfi" \| "dedust"` | Best DEX for this trade |
| `savings` | `string` | Savings vs the other DEX |

#### `DexSingleQuote`

| Field | Type | Description |
|-------|------|-------------|
| `dex` | `"stonfi" \| "dedust"` | DEX name |
| `expectedOutput` | `string` | Expected output amount |
| `minOutput` | `string` | Minimum after slippage |
| `rate` | `string` | Exchange rate |
| `priceImpact` | `string?` | Price impact percentage |
| `fee` | `string` | Fee amount |
| `poolType` | `string?` | Pool type (DeDust: `"volatile"` or `"stable"`) |

#### `DexSwapParams`

Extends `DexQuoteParams` with:

| Field | Type | Description |
|-------|------|-------------|
| `dex` | `"stonfi" \| "dedust"?` | Force a specific DEX (omit for auto) |

#### `DexSwapResult`

| Field | Type | Description |
|-------|------|-------------|
| `dex` | `"stonfi" \| "dedust"` | DEX used |
| `fromAsset` | `string` | Source asset |
| `toAsset` | `string` | Destination asset |
| `amountIn` | `string` | Amount sent |
| `expectedOutput` | `string` | Expected output |
| `minOutput` | `string` | Minimum after slippage |
| `slippage` | `string` | Slippage used |

#### DNS — `sdk.ton.dns`

Manage .ton domains: check availability, resolve addresses, participate in auctions, and link domains to wallets.

#### `DnsSDK`

| Method | Returns | Description |
|--------|---------|-------------|
| `check(domain)` | `Promise<DnsCheckResult>` | Check availability, owner, auction status |
| `resolve(domain)` | `Promise<DnsResolveResult \| null>` | Resolve domain to wallet address |
| `getAuctions(limit?)` | `Promise<DnsAuction[]>` | List active auctions |
| `startAuction(domain)` | `Promise<DnsAuctionResult>` | Start auction for an available domain |
| `bid(domain, amount)` | `Promise<DnsBidResult>` | Place bid on active auction |
| `link(domain, address)` | `Promise<void>` | Link domain to wallet address |
| `unlink(domain)` | `Promise<void>` | Remove wallet link |

```typescript
// Check if a domain is available
const info = await sdk.ton.dns.check("mybot.ton");
if (info.available) {
  const result = await sdk.ton.dns.startAuction("mybot.ton");
  sdk.log.info(`Auction started for ${result.domain}`);
} else {
  sdk.log.info(`Domain owned by ${info.owner}`);
}

// Resolve a domain
const resolved = await sdk.ton.dns.resolve("alice.ton");
if (resolved) {
  await sdk.ton.sendTON(resolved.walletAddress!, 1, "Hello from plugin");
}
```

#### `DnsCheckResult`

| Field | Type | Description |
|-------|------|-------------|
| `domain` | `string` | Domain name (e.g. `"example.ton"`) |
| `available` | `boolean` | Whether the domain is available |
| `owner` | `string?` | Current owner address |
| `nftAddress` | `string?` | NFT address of the domain |
| `walletAddress` | `string?` | Linked wallet address |
| `auction` | `object?` | Active auction: `{ bids, lastBid, endTime }` |

#### `DnsResolveResult`

| Field | Type | Description |
|-------|------|-------------|
| `domain` | `string` | Domain name |
| `walletAddress` | `string \| null` | Linked wallet address |
| `nftAddress` | `string` | NFT address of the domain |
| `owner` | `string \| null` | Owner address |
| `expirationDate` | `number?` | Expiration (unix timestamp) |

#### `DnsAuction`

| Field | Type | Description |
|-------|------|-------------|
| `domain` | `string` | Domain name |
| `nftAddress` | `string` | NFT address |
| `owner` | `string` | Current highest bidder |
| `lastBid` | `string` | Highest bid in TON |
| `endTime` | `number` | Auction end (unix timestamp) |
| `bids` | `number` | Number of bids |

#### `DnsAuctionResult`

| Field | Type | Description |
|-------|------|-------------|
| `domain` | `string` | Domain name |
| `success` | `boolean` | Whether auction started |
| `bidAmount` | `string` | Initial bid in TON |

#### `DnsBidResult`

| Field | Type | Description |
|-------|------|-------------|
| `domain` | `string` | Domain name |
| `bidAmount` | `string` | Bid amount in TON |
| `success` | `boolean` | Whether bid was placed |

---

### Telegram

#### `TelegramSDK`

**Core**

| Method | Returns | Description |
|--------|---------|-------------|
| `sendMessage(chatId, text, opts?)` | `Promise<number>` | Send message, returns message ID |
| `editMessage(chatId, messageId, text, opts?)` | `Promise<number>` | Edit existing message |
| `sendDice(chatId, emoticon, replyToId?)` | `Promise<DiceResult>` | Send dice/slot animation |
| `sendReaction(chatId, messageId, emoji)` | `Promise<void>` | React to a message |
| `getMessages(chatId, limit?)` | `Promise<SimpleMessage[]>` | Fetch recent messages (default 50) |
| `getMe()` | `TelegramUser \| null` | Bot's user info |
| `isAvailable()` | `boolean` | Whether the bridge is connected |
| `getRawClient()` | `unknown \| null` | Raw GramJS client for advanced MTProto |

**Messages**

| Method | Returns | Description |
|--------|---------|-------------|
| `deleteMessage(chatId, messageId, revoke?)` | `Promise<void>` | Delete a message |
| `forwardMessage(from, to, messageId)` | `Promise<number \| null>` | Forward message to another chat |
| `pinMessage(chatId, messageId, opts?)` | `Promise<void>` | Pin/unpin a message |
| `searchMessages(chatId, query, limit?)` | `Promise<SimpleMessage[]>` | Search messages in a chat |
| `scheduleMessage(chatId, text, scheduleDate)` | `Promise<number \| null>` | Schedule message for later |
| `getScheduledMessages(chatId)` | `Promise<SimpleMessage[]>` | Get scheduled messages in a chat |
| `deleteScheduledMessage(chatId, messageId)` | `Promise<void>` | Delete a scheduled message |
| `sendScheduledNow(chatId, messageId)` | `Promise<void>` | Send a scheduled message immediately |
| `getReplies(chatId, messageId, limit?)` | `Promise<SimpleMessage[]>` | Get thread replies |

**Media**

| Method | Returns | Description |
|--------|---------|-------------|
| `sendPhoto(chatId, photo, opts?)` | `Promise<number>` | Send a photo |
| `sendVideo(chatId, video, opts?)` | `Promise<number>` | Send a video |
| `sendVoice(chatId, voice, opts?)` | `Promise<number>` | Send a voice message |
| `sendFile(chatId, file, opts?)` | `Promise<number>` | Send a document/file |
| `sendGif(chatId, gif, opts?)` | `Promise<number>` | Send an animated GIF |
| `sendSticker(chatId, sticker)` | `Promise<number>` | Send a sticker |
| `downloadMedia(chatId, messageId)` | `Promise<Buffer \| null>` | Download media (max 50MB) |

**Chat & Users**

| Method | Returns | Description |
|--------|---------|-------------|
| `getChatInfo(chatId)` | `Promise<ChatInfo \| null>` | Get chat/group/channel info |
| `getUserInfo(userId)` | `Promise<UserInfo \| null>` | Get user information |
| `resolveUsername(username)` | `Promise<ResolvedPeer \| null>` | Resolve @username to peer |
| `getParticipants(chatId, limit?)` | `Promise<UserInfo[]>` | Get group/channel members |
| `getDialogs(limit?)` | `Promise<Dialog[]>` | Get all conversations (max 100) |
| `getHistory(chatId, limit?)` | `Promise<SimpleMessage[]>` | Get message history (max 100) |

**Interactive**

| Method | Returns | Description |
|--------|---------|-------------|
| `createPoll(chatId, question, answers, opts?)` | `Promise<number \| null>` | Create a poll |
| `createQuiz(chatId, question, answers, correctIndex, explanation?)` | `Promise<number \| null>` | Create a quiz |

**Moderation**

| Method | Returns | Description |
|--------|---------|-------------|
| `banUser(chatId, userId)` | `Promise<void>` | Ban user from group |
| `unbanUser(chatId, userId)` | `Promise<void>` | Unban user |
| `muteUser(chatId, userId, untilDate)` | `Promise<void>` | Mute user (0 = forever) |
| `kickUser(chatId, userId)` | `Promise<void>` | Kick user (ban + immediate unban) |

**Stars & Gifts**

| Method | Returns | Description |
|--------|---------|-------------|
| `getStarsBalance()` | `Promise<number>` | Get Telegram Stars balance |
| `sendGift(userId, giftId, opts?)` | `Promise<void>` | Send a star gift |
| `getAvailableGifts()` | `Promise<StarGift[]>` | Get gift catalog |
| `getMyGifts(limit?)` | `Promise<ReceivedGift[]>` | Get received gifts |
| `getResaleGifts(giftId, limit?)` | `Promise<StarGift[]>` | Get resale gifts from a collection |
| `buyResaleGift(giftId)` | `Promise<void>` | Buy a resale gift |
| `getStarsTransactions(limit?)` | `Promise<StarsTransaction[]>` | Stars transaction history |
| `transferCollectible(msgId, toUserId)` | `Promise<TransferResult>` | Transfer a collectible gift |
| `setCollectiblePrice(msgId, price)` | `Promise<void>` | Set/remove resale price (0 = unlist) |
| `getCollectibleInfo(slug)` | `Promise<CollectibleInfo \| null>` | Fragment collectible info |
| `getUniqueGift(slug)` | `Promise<UniqueGift \| null>` | NFT gift details by slug |
| `getUniqueGiftValue(slug)` | `Promise<GiftValue \| null>` | NFT gift market valuation |
| `sendGiftOffer(userId, giftSlug, price, opts?)` | `Promise<void>` | Make buy offer on an NFT gift |

```typescript
// Gift marketplace flow: browse → check value → make offer
const gifts = await sdk.telegram.getMyGifts(10);
for (const gift of gifts) {
  sdk.log.info(`Gift ${gift.id} from user ${gift.fromId}, worth ${gift.starsAmount} stars`);
}

// Check NFT gift value
const value = await sdk.telegram.getUniqueGiftValue("CryptoBot-42");
if (value?.floorPrice) {
  sdk.log.info(`Floor: ${value.floorPrice} ${value.currency}`);
}

// Transfer a collectible
const result = await sdk.telegram.transferCollectible(gift.messageId!, targetUserId);
sdk.log.info(`Transferred to ${result.transferredTo}, paid: ${result.paidTransfer}`);
```

**Stories & Advanced**

| Method | Returns | Description |
|--------|---------|-------------|
| `sendStory(mediaPath, opts?)` | `Promise<number \| null>` | Post a story |
| `setTyping(chatId)` | `Promise<void>` | Show typing indicator |

#### `InlineButton`

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | Button label text |
| `callback_data` | `string` | Callback data sent when pressed |

#### `SendMessageOptions`

| Field | Type | Description |
|-------|------|-------------|
| `replyToId` | `number?` | Message ID to reply to |
| `inlineKeyboard` | `InlineButton[][]?` | Inline keyboard rows |

#### `EditMessageOptions`

| Field | Type | Description |
|-------|------|-------------|
| `inlineKeyboard` | `InlineButton[][]?` | Updated keyboard (omit to keep) |

#### `DiceResult`

| Field | Type | Description |
|-------|------|-------------|
| `value` | `number` | Result value (range depends on emoticon) |
| `messageId` | `number` | Message ID of the dice |

#### `TelegramUser`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Telegram user ID |
| `username` | `string?` | Username (without `@`) |
| `firstName` | `string?` | First name |
| `isBot` | `boolean` | Whether the user is a bot |

#### `SimpleMessage`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Message ID |
| `text` | `string` | Message text |
| `senderId` | `number` | Sender user ID |
| `senderUsername` | `string?` | Sender username |
| `timestamp` | `Date` | Message timestamp |

#### `ChatInfo`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Chat ID |
| `title` | `string` | Chat title or user's first name |
| `type` | `"private" \| "group" \| "supergroup" \| "channel"` | Chat type |
| `membersCount` | `number?` | Number of members |
| `username` | `string?` | Chat username (if public) |
| `description` | `string?` | Chat/channel description |

#### `UserInfo`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Telegram user ID |
| `firstName` | `string` | First name |
| `lastName` | `string?` | Last name |
| `username` | `string?` | Username without `@` |
| `isBot` | `boolean` | Whether the user is a bot |

#### `ResolvedPeer`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Entity ID |
| `type` | `"user" \| "chat" \| "channel"` | Entity type |
| `username` | `string?` | Username if available |
| `title` | `string?` | Title or first name |

#### `MediaSendOptions`

| Field | Type | Description |
|-------|------|-------------|
| `caption` | `string?` | Media caption text |
| `replyToId` | `number?` | Message ID to reply to |
| `inlineKeyboard` | `InlineButton[][]?` | Inline keyboard |
| `duration` | `number?` | Duration in seconds (video/voice) |
| `width` | `number?` | Width in pixels (video) |
| `height` | `number?` | Height in pixels (video) |

#### `PollOptions`

| Field | Type | Description |
|-------|------|-------------|
| `isAnonymous` | `boolean?` | Anonymous voters (default: true) |
| `multipleChoice` | `boolean?` | Allow multiple answers (default: false) |

#### `StarGift`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Gift ID |
| `starsAmount` | `number` | Cost in Telegram Stars |
| `availableAmount` | `number?` | Remaining available |
| `totalAmount` | `number?` | Total supply |

#### `ReceivedGift`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Gift ID |
| `fromId` | `number?` | Sender user ID |
| `date` | `number` | Unix timestamp |
| `starsAmount` | `number` | Stars value |
| `saved` | `boolean` | Whether saved to profile |
| `messageId` | `number?` | Associated message ID |

#### `Dialog`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string \| null` | Chat ID |
| `title` | `string` | Chat title or name |
| `type` | `"dm" \| "group" \| "channel"` | Chat type |
| `unreadCount` | `number` | Unread messages |
| `unreadMentionsCount` | `number` | Unread mentions |
| `isPinned` | `boolean` | Whether pinned |
| `isArchived` | `boolean` | Whether archived |
| `lastMessageDate` | `number \| null` | Last message (unix timestamp) |
| `lastMessage` | `string \| null` | Last message preview |

#### `StarsTransaction`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Transaction ID |
| `amount` | `number` | Amount (+received, -spent) |
| `date` | `number` | Unix timestamp |
| `peer` | `string?` | Peer info |
| `description` | `string?` | Description |

#### `TransferResult`

| Field | Type | Description |
|-------|------|-------------|
| `msgId` | `number` | Message ID of transferred gift |
| `transferredTo` | `string` | Recipient identifier |
| `paidTransfer` | `boolean` | Whether it cost Stars |
| `starsSpent` | `string?` | Stars spent (if paid) |

#### `CollectibleInfo`

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"username" \| "phone"` | Collectible type |
| `value` | `string` | Username or phone number |
| `purchaseDate` | `string` | ISO 8601 date |
| `currency` | `string` | Fiat currency |
| `amount` | `string?` | Fiat amount |
| `cryptoCurrency` | `string?` | Crypto currency (e.g. `"TON"`) |
| `cryptoAmount` | `string?` | Crypto amount |
| `url` | `string?` | Fragment URL |

#### `UniqueGift`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Gift ID |
| `giftId` | `string` | Collection gift ID |
| `slug` | `string` | URL slug |
| `title` | `string` | Gift title |
| `num` | `number` | Number in collection |
| `owner` | `object` | `{ id?, name?, address?, username? }` |
| `giftAddress` | `string?` | TON address of the NFT |
| `attributes` | `Array` | `[{ type, name, rarityPercent? }]` |
| `availability` | `object?` | `{ total, remaining }` |
| `nftLink` | `string` | Link to NFT page |

#### `GiftValue`

| Field | Type | Description |
|-------|------|-------------|
| `slug` | `string` | NFT slug |
| `initialSaleDate` | `string?` | First sale (ISO 8601) |
| `initialSaleStars` | `string?` | First sale price in Stars |
| `lastSaleDate` | `string?` | Last sale (ISO 8601) |
| `lastSalePrice` | `string?` | Last sale price |
| `floorPrice` | `string?` | Floor price |
| `averagePrice` | `string?` | Average price |
| `listedCount` | `number?` | Number listed |
| `currency` | `string?` | Currency |

#### `GiftOfferOptions`

| Field | Type | Description |
|-------|------|-------------|
| `duration` | `number?` | Offer validity in seconds (default: 86400, min: 21600) |

---

### Secrets

#### `SecretsSDK`

Secure access to plugin secrets (API keys, tokens, credentials). Resolution order: environment variable > secrets store (`/plugin set`) > `pluginConfig`.

| Method | Returns | Description |
|--------|---------|-------------|
| `get(key)` | `string \| undefined` | Get secret value |
| `require(key)` | `string` | Get secret, throws `SECRET_NOT_FOUND` if missing |
| `has(key)` | `boolean` | Check if a secret is configured |

```typescript
const apiKey = sdk.secrets.get("api_key");
if (!apiKey) return { success: false, error: "API key not configured" };
```

#### `SecretDeclaration`

Used in `PluginManifest.secrets` to declare required secrets.

| Field | Type | Description |
|-------|------|-------------|
| `required` | `boolean` | Whether the plugin needs this secret to function |
| `description` | `string` | Human-readable description |
| `env` | `string?` | Environment variable name override |

---

### Storage

#### `StorageSDK`

Simple key-value storage for plugins. Uses an auto-created `_kv` table in the plugin's isolated DB. No `migrate()` export needed. Values are JSON-serialized with optional TTL.

| Method | Returns | Description |
|--------|---------|-------------|
| `get<T>(key)` | `T \| undefined` | Get value (undefined if missing or expired) |
| `set<T>(key, value, opts?)` | `void` | Set value (optional `{ ttl: ms }` for expiration) |
| `delete(key)` | `boolean` | Delete a key (true if existed) |
| `has(key)` | `boolean` | Check if key exists and is not expired |
| `clear()` | `void` | Delete all keys |

```typescript
// Simple counter
const count = sdk.storage.get<number>("visits") ?? 0;
sdk.storage.set("visits", count + 1);

// Cache with 5-minute TTL
sdk.storage.set("api_result", data, { ttl: 300_000 });
```

---

### Plugin Definitions

#### `SimpleToolDef`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique tool name (e.g. `"casino_spin"`) |
| `description` | `string` | Description for the LLM |
| `parameters` | `Record<string, unknown>?` | JSON Schema for params |
| `execute` | `(params, context) => Promise<ToolResult>` | Tool handler |
| `scope` | `ToolScope?` | Visibility scope (default: `"always"`) |
| `category` | `ToolCategory?` | Masking category |

#### `PluginManifest`

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Plugin name (lowercase, hyphens, 1-64 chars) |
| `version` | `string` | Semver string |
| `author` | `string?` | Author name |
| `description` | `string?` | Short description (max 256 chars) |
| `dependencies` | `string[]?` | Required built-in modules |
| `defaultConfig` | `Record<string, unknown>?` | Default config values |
| `sdkVersion` | `string?` | Required SDK version range (e.g. `">=1.0.0"`) |
| `secrets` | `Record<string, SecretDeclaration>?` | Secrets required by this plugin |

#### `ToolResult`

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether execution succeeded |
| `data` | `unknown?` | Result data (serialized for LLM) |
| `error` | `string?` | Error message |

#### `ToolScope`

```typescript
type ToolScope = "always" | "dm-only" | "group-only" | "admin-only";
```

#### `ToolCategory`

```typescript
type ToolCategory = "data-bearing" | "action";
```

`data-bearing` tool results are subject to observation masking (token reduction on older results). `action` tool results are always preserved in full.

#### `StartContext`

Context passed to the `start(ctx)` lifecycle hook.

| Field | Type | Description |
|-------|------|-------------|
| `bridge` | `unknown` | Telegram bridge for advanced operations |
| `db` | `unknown` | Plugin's isolated SQLite database |
| `config` | `Record<string, unknown>` | Sanitized app config (no API keys) |
| `pluginConfig` | `Record<string, unknown>` | Plugin-specific config from `config.yaml` |
| `log` | `PluginLogger` | Prefixed logger |

#### `PluginToolContext`

Runtime context passed to tool `execute` functions.

| Field | Type | Description |
|-------|------|-------------|
| `chatId` | `string` | Telegram chat ID where tool was invoked |
| `senderId` | `number` | Telegram user ID of the sender |
| `isGroup` | `boolean` | Whether this is a group chat |
| `bridge` | `unknown` | TelegramBridge for advanced operations |
| `db` | `unknown` | Plugin's isolated SQLite database |
| `config` | `Record<string, unknown>?` | Sanitized bot config |

---

### Event Hook Types

#### `PluginMessageEvent`

| Field | Type | Description |
|-------|------|-------------|
| `chatId` | `string` | Telegram chat ID |
| `senderId` | `number` | Sender's user ID |
| `senderUsername` | `string?` | Sender's `@username` (without `@`) |
| `text` | `string` | Message text |
| `isGroup` | `boolean` | Whether this is a group chat |
| `hasMedia` | `boolean` | Whether the message contains media |
| `messageId` | `number` | Message ID |
| `timestamp` | `Date` | Message timestamp |

#### `PluginCallbackEvent`

| Field | Type | Description |
|-------|------|-------------|
| `data` | `string` | Raw callback data string |
| `action` | `string` | First segment of `data.split(":")` |
| `params` | `string[]` | Remaining segments after action |
| `chatId` | `string` | Chat ID where the button was pressed |
| `messageId` | `number` | Message ID the button belongs to |
| `userId` | `number` | User ID who pressed the button |
| `answer` | `(text?: string, alert?: boolean) => Promise<void>` | Answer the callback query (dismisses spinner) |

## Error Handling

All SDK methods that perform I/O throw `PluginSDKError` on failure. Use the `code` property for control flow:

```typescript
import { PluginSDKError } from "@teleton-agent/sdk";

async execute(params, context) {
  try {
    await sdk.ton.sendTON(params.address, params.amount);
    return { success: true };
  } catch (err) {
    if (err instanceof PluginSDKError) {
      switch (err.code) {
        case "WALLET_NOT_INITIALIZED":
          return { success: false, error: "Bot wallet not configured" };
        case "INVALID_ADDRESS":
          return { success: false, error: "Bad address format" };
        default:
          return { success: false, error: err.message };
      }
    }
    throw err; // Re-throw unexpected errors
  }
}
```

Always check `telegram.isAvailable()` before calling Telegram methods in `start()`, since the bridge may not be connected yet.

## License

MIT -- see [LICENSE](https://github.com/TONresistor/teleton-agent/blob/main/LICENSE).

Copyright 2025-2026 Digital Resistance.

## Links

- [Repository](https://github.com/TONresistor/teleton-agent)
- [Issues](https://github.com/TONresistor/teleton-agent/issues)
- [Teleton Agent](https://github.com/TONresistor/teleton-agent) -- the main project
