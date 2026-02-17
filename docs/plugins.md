# Plugin Development Guide

This guide walks through building, testing, and distributing plugins for Teleton Agent. Plugins extend the agent with new tools that the LLM can invoke, event hooks for real-time message processing, and background tasks.

---

## Table of Contents

- [Overview](#overview)
- [Plugin Structure](#plugin-structure)
- [Minimal Plugin (Hello World)](#minimal-plugin-hello-world)
- [Plugin Lifecycle](#plugin-lifecycle)
- [Manifest](#manifest)
- [Using the SDK](#using-the-sdk)
  - [sdk.telegram](#sdktelegram)
  - [sdk.ton](#sdkton)
  - [sdk.storage](#sdkstorage)
  - [sdk.secrets](#sdksecrets)
  - [sdk.log](#sdklog)
- [Database Migrations](#database-migrations)
- [Event Hooks](#event-hooks)
  - [onMessage](#onmessage)
  - [onCallbackQuery](#oncallbackquery)
- [Tool Definitions](#tool-definitions)
- [Hot-Reload During Development](#hot-reload-during-development)
- [Publishing and Distribution](#publishing-and-distribution)
- [Best Practices](#best-practices)
- [Common Pitfalls](#common-pitfalls)

---

## Overview

A Teleton plugin is a JavaScript module (ESM) placed in `~/.teleton/plugins/`. It exports one required item (`tools`) and several optional lifecycle hooks. The platform discovers plugins at startup, validates them, and integrates their tools into the LLM's available tool set.

Key facts:
- Plugins receive a **frozen SDK** object -- they cannot modify or extend it
- Each plugin gets an **isolated SQLite database** (if `migrate` is exported)
- Plugins see a **sanitized config** with no API keys or secrets
- The official SDK package is `@teleton-agent/sdk` on npm

---

## Plugin Structure

Plugins can be either a single file or a directory:

### Single File

```
~/.teleton/plugins/
  my-plugin.js          # Self-contained plugin
```

### Directory (recommended for plugins with dependencies)

```
~/.teleton/plugins/
  my-plugin/
    index.js            # Entry point (required)
    package.json        # npm dependencies (optional)
    package-lock.json   # Lockfile (required if package.json exists)
    node_modules/       # Auto-installed by the platform
```

When a plugin has a `package.json` and `package-lock.json`, the platform automatically runs `npm ci --ignore-scripts` to install dependencies before loading.

---

## Minimal Plugin (Hello World)

Create `~/.teleton/plugins/hello.js`:

```javascript
export const tools = [
  {
    name: "hello_greet",
    description: "Greet a user by name",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The person's name" },
      },
      required: ["name"],
    },
    async execute(params) {
      return {
        success: true,
        data: { message: `Hello, ${params.name}!` },
      };
    },
  },
];
```

Restart the agent (or enable hot-reload) and the `hello_greet` tool will be available to the LLM.

---

## Plugin Lifecycle

The platform loads plugins in a defined order. Each export is optional except `tools`.

| Export | Signature | When Called | Purpose |
|--------|-----------|------------|---------|
| `manifest` | `PluginManifest` | Load time | Declare name, version, dependencies, default config, secrets |
| `migrate` | `(db: Database) => void` | Before `tools`, once | Create/alter tables in the plugin's isolated SQLite DB |
| `tools` | `SimpleToolDef[]` or `(sdk: PluginSDK) => SimpleToolDef[]` | After `migrate` | Register tools the LLM can invoke |
| `start` | `(ctx) => Promise<void>` | After the Telegram bridge connects | Run background tasks, set up intervals |
| `stop` | `() => Promise<void>` | On shutdown or hot-reload | Clean up timers, close connections |
| `onMessage` | `(event: PluginMessageEvent) => Promise<void>` | Every incoming message | React to messages without LLM involvement |
| `onCallbackQuery` | `(event: PluginCallbackEvent) => Promise<void>` | Inline button press | Handle callback queries from inline keyboards |

### Execution Order

1. **Load** -- `validateManifest()`, check dependencies and SDK version
2. **Migrate** -- `migrate(db)`, create isolated SQLite DB, run custom migrations
3. **Register** -- `tools(sdk)`, validate tool definitions, register with the agent
4. **Start** -- (after bridge connects) `start(ctx)`, background tasks begin
5. **Runtime** -- `onMessage` / `onCallbackQuery` fire on events
6. **Shutdown** -- `stop()`, cleanup

---

## Manifest

The manifest is an optional named export that declares metadata about your plugin. Without it, the plugin name is inferred from the file/directory name.

```javascript
export const manifest = {
  name: "my-plugin",           // Required: lowercase, alphanumeric + hyphens, 1-64 chars
  version: "1.0.0",            // Required: semver
  author: "Your Name",         // Optional: max 128 chars
  description: "What it does", // Optional: max 256 chars
  dependencies: ["deals"],     // Optional: required built-in modules
  sdkVersion: ">=1.0.0",       // Optional: minimum SDK version (supports ^, >=, exact)
  defaultConfig: {             // Optional: merged with user's plugin config
    max_results: 10,
    cooldown_ms: 5000,
  },
  secrets: {                   // Optional: declared secrets with validation
    api_key: {
      required: true,
      description: "External API key for the service",
    },
    webhook_url: {
      required: false,
      description: "Optional webhook for notifications",
    },
  },
};
```

### Manifest Validation Rules

- `name`: Must match `/^[a-z0-9][a-z0-9-]*$/` (lowercase, starts with letter or number)
- `version`: Must be valid semver (`1.0.0`, not `v1.0.0`)
- `dependencies`: Array of built-in module names that must be loaded before this plugin
- `sdkVersion`: Supports `>=1.0.0`, `^1.0.0`, or exact `1.0.0` version matching

### Plugin Config Resolution

Plugin config is resolved by merging `manifest.defaultConfig` with the user's config:

```yaml
# In config.yaml
plugins:
  my_plugin:          # Note: hyphens are replaced with underscores
    max_results: 25   # Overrides the default of 10
    # cooldown_ms uses the default of 5000
```

---

## Using the SDK

When `tools` is a function (recommended), it receives a frozen `PluginSDK` object:

```javascript
export const tools = (sdk) => [
  {
    name: "my_tool",
    description: "Does something",
    async execute(params, context) {
      // Use sdk.telegram, sdk.ton, sdk.storage, sdk.secrets, sdk.log
      return { success: true };
    },
  },
];
```

### sdk.telegram

Send and manage Telegram messages.

| Method | Returns | Description |
|--------|---------|-------------|
| `sendMessage(chatId, text, opts?)` | `Promise<number>` | Send a message, returns message ID |
| `editMessage(chatId, messageId, text, opts?)` | `Promise<number>` | Edit an existing message |
| `sendDice(chatId, emoticon, replyToId?)` | `Promise<DiceResult>` | Send a dice/slot animation |
| `sendReaction(chatId, messageId, emoji)` | `Promise<void>` | React to a message |
| `getMessages(chatId, limit?)` | `Promise<SimpleMessage[]>` | Fetch recent messages (default 50) |
| `getMe()` | `TelegramUser \| null` | Get the agent's own user info |
| `isAvailable()` | `boolean` | Whether the Telegram bridge is connected |

#### Inline Keyboards

```javascript
await sdk.telegram.sendMessage(chatId, "Choose an option:", {
  inlineKeyboard: [
    [
      { text: "Option A", callback_data: "myplugin:choose:a" },
      { text: "Option B", callback_data: "myplugin:choose:b" },
    ],
    [
      { text: "Cancel", callback_data: "myplugin:cancel" },
    ],
  ],
});
```

### sdk.ton

Interact with the TON blockchain.

| Method | Returns | Description |
|--------|---------|-------------|
| `getAddress()` | `string \| null` | Agent's wallet address |
| `getBalance(address?)` | `Promise<TonBalance \| null>` | Get TON balance (defaults to agent wallet) |
| `getPrice()` | `Promise<TonPrice \| null>` | TON/USD price (cached 30s) |
| `sendTON(to, amount, comment?)` | `Promise<TonSendResult>` | Send TON (irreversible) |
| `getTransactions(address, limit?)` | `Promise<TonTransaction[]>` | Transaction history (max 50) |
| `verifyPayment(params)` | `Promise<SDKPaymentVerification>` | Verify incoming payment with replay protection |
| `getJettonBalances(owner?)` | `Promise<JettonBalance[]>` | List jetton balances |
| `getJettonInfo(address)` | `Promise<JettonInfo \| null>` | Get jetton metadata |
| `sendJetton(jetton, to, amount, opts?)` | `Promise<JettonSendResult>` | Send jettons |
| `getNftItems(owner?)` | `Promise<NftItem[]>` | List NFTs owned |
| `getNftInfo(address)` | `Promise<NftItem \| null>` | Get NFT metadata |
| `toNano(amount)` | `bigint` | Convert TON to nanoTON |
| `fromNano(nano)` | `string` | Convert nanoTON to TON |
| `validateAddress(address)` | `boolean` | Check if a TON address is valid |

#### Payment Verification Example

```javascript
// Verify a user payment with replay protection
const result = await sdk.ton.verifyPayment({
  amount: 1.0,                // Expected amount
  memo: event.senderUsername,  // Expected comment
  gameType: "casino_spin",    // Replay group (prevents double-spend)
  maxAgeMinutes: 10,          // Time window
});

if (result.verified) {
  sdk.log.info(`Payment verified: ${result.amount} TON from ${result.playerWallet}`);
} else {
  sdk.log.warn(`Payment not found: ${result.error}`);
}
```

Note: `verifyPayment` requires a `used_transactions` table in your plugin's database. See [Database Migrations](#database-migrations).

### sdk.storage

Simple key-value persistence without SQL boilerplate. Available only when `migrate` is exported (the plugin has a database).

| Method | Returns | Description |
|--------|---------|-------------|
| `get<T>(key)` | `T \| undefined` | Get a value by key |
| `set<T>(key, value, opts?)` | `void` | Store a value. Optional `{ ttl: ms }` for auto-expiration |
| `delete(key)` | `boolean` | Delete a key, returns true if it existed |
| `has(key)` | `boolean` | Check if a key exists (respects TTL) |
| `clear()` | `void` | Delete all stored key-value pairs |

```javascript
// Store with TTL
sdk.storage.set("cache:prices", priceData, { ttl: 300_000 }); // 5 minutes

// Retrieve
const cached = sdk.storage.get("cache:prices");
if (cached) {
  return { success: true, data: cached };
}
```

Values are JSON-serialized. Expired entries are lazily cleaned up with a 5% probability on each read.

### sdk.secrets

Secure access to API keys, tokens, and credentials. The resolution order is:

1. **Environment variable**: `PLUGINNAME_KEY` (e.g., `MY_PLUGIN_API_KEY`)
2. **Secrets store**: Set via `/plugin set my-plugin api_key <value>` admin command
3. **Plugin config**: From `config.yaml` under `plugins.my_plugin.api_key`

| Method | Returns | Description |
|--------|---------|-------------|
| `get(key)` | `string \| undefined` | Get a secret value |
| `require(key)` | `string` | Get a secret or throw `PluginSDKError` |
| `has(key)` | `boolean` | Check if a secret is available |

```javascript
export const tools = (sdk) => [
  {
    name: "fetch_data",
    description: "Fetch data from external API",
    async execute(params) {
      const apiKey = sdk.secrets.require("api_key"); // Throws if missing
      const response = await fetch("https://api.example.com/data", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return { success: true, data: await response.json() };
    },
  },
];
```

Secrets are stored in `~/.teleton/plugins/data/<plugin>.secrets.json` with `0600` permissions.

### sdk.log

Prefixed logger for consistent log output.

| Method | Description |
|--------|-------------|
| `info(...args)` | Informational message |
| `warn(...args)` | Warning |
| `error(...args)` | Error |
| `debug(...args)` | Debug (visible only when `DEBUG` or `VERBOSE` env vars are set) |

All methods auto-prefix output with the plugin name: `[my-plugin] Your message here`.

---

## Database Migrations

Export a `migrate` function to create tables in your plugin's isolated SQLite database. This function runs once at load time, before `tools`.

```javascript
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scores (
      user_id   INTEGER PRIMARY KEY,
      username  TEXT,
      score     INTEGER DEFAULT 0,
      updated   TEXT DEFAULT (datetime('now'))
    )
  `);

  // Required for sdk.ton.verifyPayment() replay protection
  db.exec(`
    CREATE TABLE IF NOT EXISTS used_transactions (
      tx_hash   TEXT PRIMARY KEY,
      user_id   TEXT NOT NULL,
      amount    REAL NOT NULL,
      game_type TEXT NOT NULL,
      used_at   INTEGER NOT NULL
    )
  `);
}
```

The database file is created at `~/.teleton/plugins/data/<plugin-name>.db`. Each plugin gets its own isolated database -- plugins cannot access each other's data.

You can also access the database directly via `sdk.db` in your tool functions:

```javascript
export const tools = (sdk) => [
  {
    name: "leaderboard",
    description: "Show top scores",
    async execute() {
      const rows = sdk.db
        .prepare("SELECT username, score FROM scores ORDER BY score DESC LIMIT 10")
        .all();
      return { success: true, data: rows };
    },
  },
];
```

---

## Event Hooks

Plugins can export `onMessage` and `onCallbackQuery` to react to Telegram events directly, without going through the LLM agentic loop. These hooks are fire-and-forget -- errors are caught per plugin and logged, so a failing hook never blocks message processing or other plugins.

### onMessage

Called for every incoming message (DMs and groups), after the message is stored to the feed database. This fires regardless of whether the agent will respond to the message.

```javascript
export async function onMessage(event) {
  // event.chatId       - Telegram chat ID
  // event.senderId     - Sender's user ID
  // event.senderUsername - Sender's @username (without @)
  // event.text         - Message text
  // event.isGroup      - Whether this is a group chat
  // event.hasMedia     - Whether the message contains media
  // event.messageId    - Message ID
  // event.timestamp    - Date object

  if (event.isGroup && /spam|scam/i.test(event.text)) {
    console.log(`Flagged message ${event.messageId} from ${event.senderId}`);
  }
}
```

### onCallbackQuery

Called when a user presses an inline keyboard button. The `data` string is split on `:` into `action` (first segment) and `params` (remaining segments). You must call `event.answer()` to dismiss the loading spinner on the user's client.

```javascript
export async function onCallbackQuery(event) {
  // event.data       - Raw callback data string (e.g., "myplugin:bet:100")
  // event.action     - First segment: "myplugin"
  // event.params     - Remaining segments: ["bet", "100"]
  // event.chatId     - Chat ID where the button was pressed
  // event.messageId  - Message ID the button belongs to
  // event.userId     - User ID who pressed the button
  // event.answer(text?, alert?) - Answer the callback (dismisses spinner)

  if (event.action !== "myplugin") return; // Not for this plugin

  const [subAction, ...args] = event.params;

  if (subAction === "confirm") {
    await event.answer("Confirmed!", false); // Toast notification
    // Handle the confirmation...
  } else {
    await event.answer("Unknown action", true); // Alert popup
  }
}
```

Namespace your callback data with your plugin name (e.g., `"myplugin:action:param"`) so multiple plugins can coexist without collisions. All registered `onCallbackQuery` hooks receive every callback event -- filter by `event.action` to handle only your own buttons.

---

## Tool Definitions

Each tool in the `tools` array (or returned by the tools factory function) must be an object with:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique tool name (e.g., `"myplugin_action"`). Must not conflict with built-in tools. |
| `description` | `string` | Yes | Description shown to the LLM so it knows when to use the tool. |
| `parameters` | `object` | No | JSON Schema describing the tool's input parameters. |
| `execute` | `function` | Yes | `async (params, context) => { success, data?, error? }` |
| `scope` | `string` | No | Visibility: `"always"` (default), `"dm-only"`, `"group-only"`, `"admin-only"` |
| `category` | `string` | No | `"data-bearing"` (results masked in old iterations) or `"action"` (always preserved) |

### The Execute Function

```javascript
async execute(params, context) {
  // params: parsed parameters matching your JSON Schema
  // context.chatId: current chat ID
  // context.userId: user who triggered the tool
  // context.config: sanitized app config (no secrets)
  // context.db: plugin's isolated database (if migrate was exported)

  return {
    success: true,           // Required: whether execution succeeded
    data: { key: "value" },  // Optional: result data (serialized for the LLM)
    error: "Something wrong", // Optional: error message (when success is false)
  };
}
```

### Scope

- `"always"` -- Tool is available in all contexts (default)
- `"dm-only"` -- Only available in direct messages
- `"group-only"` -- Only available in group chats
- `"admin-only"` -- Only available to users in `telegram.admin_ids`

### Category

- `"data-bearing"` -- Tool results are subject to observation masking. After a few agentic iterations, older results from data-bearing tools are summarized to reduce token usage (~90% reduction).
- `"action"` -- Tool results are always preserved in full across all iterations. Use for tools whose output must remain visible (e.g., transaction confirmations).

---

## Hot-Reload During Development

Enable hot-reload to automatically reload plugins when files change, without restarting the agent:

```yaml
# In config.yaml
dev:
  hot_reload: true
```

When enabled, the platform watches `~/.teleton/plugins/` for file changes using `chokidar`. On detecting a change:

1. The modified plugin's `stop()` function is called (if exported)
2. The plugin module is re-imported
3. `migrate()`, `tools()`, and `start()` are re-executed
4. The tool registry is updated

This allows rapid iteration: edit your plugin file, save, and the changes take effect immediately.

---

## Official Example Plugins

The [teleton-plugins](https://github.com/TONresistor/teleton-plugins) repository contains maintained example plugins you can use as reference or install directly:

- **Casino** -- Slot machine and dice games with persistent balances
- More community plugins coming soon

```bash
# Install the casino plugin
cp -r path/to/teleton-plugins/plugins/casino ~/.teleton/plugins/casino
```

Browse the source code to see real-world patterns for SDK usage, database migrations, event hooks, and tool definitions.

---

## Publishing and Distribution

### Manual Distribution

The simplest approach: share your plugin file or directory. Users place it in `~/.teleton/plugins/`.

### npm Package

For plugins with dependencies, publish as an npm package:

```json
{
  "name": "teleton-plugin-my-feature",
  "version": "1.0.0",
  "main": "index.js",
  "peerDependencies": {
    "@teleton-agent/sdk": ">=1.0.0"
  }
}
```

Users install it:

```bash
cd ~/.teleton/plugins
mkdir my-feature && cd my-feature
npm init -y
npm install teleton-plugin-my-feature
```

Then create an `index.js` that re-exports:

```javascript
export { tools, manifest, migrate, start, stop } from "teleton-plugin-my-feature";
```

### TypeScript Plugins

Write in TypeScript, compile to JavaScript before deploying:

```bash
# Development
npx tsc --watch

# Deploy the compiled .js to ~/.teleton/plugins/
cp dist/index.js ~/.teleton/plugins/my-plugin/index.js
```

Install `@teleton-agent/sdk` as a dev dependency for type definitions:

```bash
npm install -D @teleton-agent/sdk
```

---

## Best Practices

1. **Namespace your tools**: Prefix tool names with your plugin name (e.g., `casino_spin`, `casino_balance`). This prevents name collisions with built-in tools and other plugins.

2. **Namespace callback data**: Use `"pluginname:action:params"` format for inline keyboard callbacks so multiple plugins can coexist.

3. **Handle errors gracefully**: Return `{ success: false, error: "message" }` instead of throwing exceptions from `execute`. The platform catches unhandled exceptions, but explicit error handling gives better UX.

4. **Use sdk.secrets for credentials**: Never hardcode API keys. Declare them in `manifest.secrets` and access via `sdk.secrets.get()` or `sdk.secrets.require()`.

5. **Check telegram availability in start()**: The bridge may not be connected when `start()` runs. Use `sdk.telegram.isAvailable()` before calling Telegram methods.

6. **Clean up in stop()**: Clear intervals, close connections, and release resources. This is called on shutdown and on hot-reload.

7. **Use sdk.storage for simple state**: For key-value data, prefer `sdk.storage` over raw SQL. It handles JSON serialization and TTL automatically.

8. **Mark financial tools as "action" category**: If your tool performs irreversible operations (sending TON, confirming trades), set `category: "action"` to prevent the result from being masked by observation compaction.

9. **Keep tool descriptions clear**: The LLM decides when to use a tool based on its `description`. Write descriptions that clearly state what the tool does and when it should be used.

10. **Test with hot-reload**: Enable `dev.hot_reload: true` during development for fast iteration without restarts.

---

## Common Pitfalls

1. **Missing `tools` export**: The only required export is `tools`. Without it, the plugin is skipped with a warning.

2. **Forgetting to call `event.answer()`**: In `onCallbackQuery`, you must call `event.answer()` to dismiss the loading spinner. If you do not, the user sees an indefinite spinner.

3. **Using `require()` instead of `import`**: Plugins must be ESM modules. Use `import` syntax (or dynamic `import()` for conditional loads).

4. **Accessing `sdk` outside of `tools` factory**: The SDK is only available inside the `tools` function and within tool `execute` functions (via closure). It is not passed to `migrate`, `start`, or `stop`.

5. **Mutating the SDK object**: The SDK is frozen with `Object.freeze()`. Attempting to add properties or modify methods will silently fail (or throw in strict mode).

6. **Plugin name conflicts**: If two plugins have the same name (from manifest or inferred from filename), the second one is skipped. Use unique, descriptive names.

7. **Missing `package-lock.json`**: If your plugin has a `package.json` but no `package-lock.json`, dependencies are NOT installed. The platform requires a lockfile for deterministic installs.

8. **Database access without `migrate`**: `sdk.db` is `null` if you do not export a `migrate` function. However, `sdk.storage` (KV store) is available as long as the plugin has a database, since the platform always creates a DB file for plugins that export `migrate`.

9. **Calling `sdk.ton.verifyPayment` without `used_transactions` table**: This method requires a `used_transactions` table in your plugin's database. Create it in your `migrate` function.

10. **Blocking the event loop in hooks**: `onMessage` and `onCallbackQuery` are fire-and-forget but still run on the main event loop. Avoid CPU-intensive synchronous operations; use `setTimeout` or `setImmediate` for heavy processing.
