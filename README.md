<p align="center">
  <img src="./logo_dark.png" alt="Teleton Agent" width="700" />
</p>

<p align="center"><b>Autonomous AI agent platform for Telegram with native TON blockchain integration</b></p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-22.22.2%2B-brightgreen" alt="Node.js 22.22.2+"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.7-blue" alt="TypeScript"></a>
  <a href="https://teletonagent.dev"><img src="https://img.shields.io/badge/Website-teletonagent.dev-ff6600" alt="Website"></a>
  <a href="https://docs.teletonagent.dev"><img src="https://img.shields.io/badge/docs-Teleton%20Agents-blue" alt="Documentation"></a>
  <a href="https://ton.org"><img src="https://img.shields.io/badge/Built_on-TON-0098EA?logo=ton&logoColor=white" alt="Built on TON"></a>
</p>

---

<p align="center">Teleton is an autonomous AI agent platform that operates as a real Telegram user account or a Telegram Bot. It thinks through an agentic loop with tool calling, remembers conversations across sessions with hybrid RAG, and natively integrates the TON blockchain: send crypto, swap on DEXs, bid on domains, verify payments - all from a chat message. It can schedule tasks to run autonomously at any time. It ships with 128 always-registered tools plus 5 optional system tools, supports 16 LLM providers, and exposes a Plugin SDK so you can build your own tools on top of the platform.</p>

### Key Highlights

<table>
<tr>
<td align="center" width="33%"><br><b><ins>Full Telegram Access</ins></b><br>Real user via MTProto,<br>not a bot<br><br></td>
<td align="center" width="33%"><br><b><ins>Agentic Loop</ins></b><br>Think, act, observe, repeat<br>until shit gets done<br><br></td>
<td align="center" width="33%"><br><b><ins>16 LLM Providers</ins></b><br>Anthropic, OpenAI, Google, xAI, Groq, and more<br><br></td>
</tr>
<tr>
<td align="center"><br><b><ins>TON Blockchain</ins></b><br>Wallet, jettons, DEX swaps, DNS, NFTs<br><br></td>
<td align="center"><br><b><ins>Persistent Memory</ins></b><br>Hybrid RAG, vector + keyword, auto-compaction<br><br></td>
<td align="center"><br><b><ins>128+ Built-in Tools</ins></b><br>Messaging, media, crypto, DEX, DNS, files<br><br></td>
</tr>
<tr>
<td align="center"><br><b><ins>Plugin SDK</ins></b><br>Custom tools, isolated DBs, secrets, hooks<br><br></td>
<td align="center"><br><b><ins>MCP Client</ins></b><br>Connect any MCP tool server<br><br></td>
<td align="center"><br><b><ins>Secure by Design</ins></b><br>Sandbox, plugin isolation, prompt defense<br><br></td>
</tr>
</table>

---

## Features

### Tool Categories

| Category      | Tools | Description                                                    |
| ------------- | ----- | -------------------------------------------------------------- |
| Telegram      | 83    | Messages, media, chats, polls, stickers, gifts, stars, stories |
| TON & Jettons | 15    | Wallet, send/receive, balances, prices, NFTs, DEX router       |
| STON.fi DEX   | 5     | Swap, quote, search, trending, pools                           |
| DeDust DEX    | 5     | Swap, quote, pools, prices, token analytics                    |
| TON DNS       | 8     | Auctions, bidding, linking, TON Sites, resolution              |
| Journal       | 3     | Trade logging, P&L tracking, natural language queries          |
| Web           | 2     | Search and page extraction via Tavily                          |
| Workspace     | 6     | Sandboxed file operations, path traversal protection           |
| Tool Search   | 1     | Semantic retrieval across the complete tool registry           |
| System        | 5     | Exec (4) and TON Proxy status (1), both optional                |

### Advanced Capabilities

| Capability              | Description                                                              |
| ----------------------- | ------------------------------------------------------------------------ |
| **Multi-Provider LLM**  | 16 providers, hot-swap from dashboard or CLI                             |
| **RAG + Hybrid Search** | Vector (sqlite-vec) + keyword (FTS5) fused search                        |
| **Auto-Compaction**     | AI summarizes old context, saves to `memory/*.md`                        |
| **Observation Masking** | Compresses old tool results, saves ~90% context                          |
| **Plugin SDK**          | Frozen SDK, isolated DBs, secrets, lifecycle hooks                       |
| **Smart DEX Router**    | Compares STON.fi vs DeDust, picks best rate                              |
| **Vision Analysis**     | Image understanding via utility model                                    |
| **Scheduled Tasks**     | Cron-like tasks with dependency chains                                   |
| **Message Debouncing**  | Batches rapid group messages, DMs stay instant                           |
| **Daily Logs**          | Auto session summaries, persisted across resets                          |
| **Multi-Policy Access** | DM/group policies (open, allowlist, admin-only, disabled), per-group     |
| **Tool RAG**            | Sends only top-K relevant tools per message                              |
| **MCP Client**          | stdio, SSE, Streamable HTTP, auto-discovery, CLI or WebUI               |
| **System Execution**    | YOLO mode: shell, files, processes (off by default, admin-only)          |
| **TON Proxy**           | Browse .ton domains via HTTP proxy, auto-installed                       |
| **Management API**      | HTTPS control plane for remote admin, bootstrap mode, lifecycle control  |
| **Sandboxed Workspace** | Path traversal protection, symlink detection, immutable configs          |
| **Heartbeat**           | Autonomous periodic wake-up, HEARTBEAT.md task checklist, configurable intervals |

---

## Prerequisites

- **Node.js 22.22.2+ LTS** - [Download](https://nodejs.org/) (Node 24 requires 24.15.0+)
- **LLM API Key** - One of: [Anthropic](https://console.anthropic.com/) (recommended), [OpenAI](https://platform.openai.com/), [Google](https://aistudio.google.com/), [xAI](https://console.x.ai/), [Groq](https://console.groq.com/), [OpenRouter](https://openrouter.ai/), [Moonshot](https://platform.moonshot.ai/), [Mistral](https://console.mistral.ai/), [Cerebras](https://cloud.cerebras.ai/), [ZAI](https://open.bigmodel.cn/), [MiniMax](https://platform.minimaxi.com/), [Hugging Face](https://huggingface.co/settings/tokens) — or keyless: Codex and Grok Build (CLI auto-detect), Gocoon (TON), Local (Ollama/vLLM)
- **Telegram Account** - Dedicated account recommended for security
- **Telegram API Credentials** - From [my.telegram.org/apps](https://my.telegram.org/apps)
- **Your Telegram User ID** - Message [@userinfobot](https://t.me/userinfobot)
- **Bot Token** *(optional in user mode)* - From [@BotFather](https://t.me/BotFather) for plugin inline cards and callbacks; required in bot mode

> **Security Warning**: The agent will have full control over the Telegram account. Use a dedicated account, not your main one.

---

## Quick Start

### 1. Installation

**npm (recommended):**
```bash
npm install -g teleton@latest
```

**Docker:**
```bash
docker run -it -v ~/.teleton:/data ghcr.io/tonresistor/teleton-agent:latest setup
```

**From source (development):**
```bash
git clone https://github.com/TONresistor/teleton-agent.git
cd teleton-agent
npm install && npm run build
```

### 2. Setup & Start

```bash
teleton setup --ui
```

The WebUI wizard walks you through everything: LLM provider, Telegram auth (QR code or phone), access policies, admin ID, TON wallet, and workspace files. Once done, the agent starts automatically.

To restart later with the dashboard:

```bash
teleton start --webui
```

### 3. Verify

Send a message to your agent on Telegram:

```
You: /ping
Agent: Pong! I'm alive.

You: /status
Agent: [Displays uptime, model, tool count, wallet balance]
```

> **Need more details?** See [GETTING_STARTED.md](GETTING_STARTED.md) for the full guide - admin commands, troubleshooting, workspace templates, plugins, and more.

---

## User Mode vs Bot Mode

Teleton can run as a **user account** (MTProto) or a **Telegram bot** (Bot API). Set `telegram.mode` in your config:

| | User Mode (default) | Bot Mode |
|---|---|---|
| **Auth** | Phone + api_id + api_hash | Bot token from @BotFather |
| **Protocol** | MTProto (GramJS) | Bot API (Grammy) |
| **Tools** | 128 base, up to 133 with optional system modules | Registry filtered automatically by bot-compatible capabilities |
| **Risk** | Account ban possible | No ban risk |
| **Dialogs/History** | Full access | Not available |
| **Media sending** | All types | Photos only (v1) |
| **Inline keyboards** | Via bot_token | Native |
| **Stars/Gifts** | Full access | Not available |
| **Profile editing** | Yes | No |
| **Scheduled tasks** | Yes | Not available |
| **Setup** | `telegram.mode: "user"` | `telegram.mode: "bot"` |

---

## Configuration

The `teleton setup` wizard generates a fully configured `~/.teleton/config.yaml` file. Manual editing is only necessary if you want to adjust settings after the initial setup.

```yaml
agent:
  provider: "anthropic"              # anthropic | codex | grok-build | openai | google | xai | groq | openrouter | moonshot | mistral | cerebras | zai | minimax | huggingface | gocoon | local
  api_key: "sk-ant-api03-..."
  model: "claude-haiku-4-5-20251001"
  utility_model: "claude-haiku-4-5-20251001"  # for summarization, compaction, vision
  max_agentic_iterations: 5
  session_reset_policy:
    daily_reset_enabled: true
    daily_reset_hour: 4
    idle_expiry_minutes: 1440  # 24h idle → new session

telegram:
  dm_policy: "admin-only"   # open | allowlist | admin-only | disabled
  group_policy: "open"      # open | allowlist | admin-only | disabled
  require_mention: true
  admin_ids: [123456789]
  owner_name: "Your Name"
  owner_username: "your_username"
  debounce_ms: 1500         # group message batching delay

  # Optional in user mode: plugin inline cards and callbacks
  bot_token: "123456:ABC-DEF..."
  bot_username: "your_bot"

webui:                       # Optional: Web dashboard
  enabled: false             # Enable WebUI server
  port: 7777                 # HTTP server port
  host: "127.0.0.1"          # Localhost only (security)
  # auth_token: "..."        # Auto-generated if omitted

ton_proxy:                   # Optional: .ton domain proxy
  enabled: false             # Enable Tonutils-Proxy
  port: 8080                 # HTTP proxy port
  # binary_path: "..."       # Custom binary path (auto-downloaded if omitted)

# capabilities:                # System execution (YOLO mode, off by default)
#   exec:
#     mode: "off"              # off | yolo
#     scope: "admin-only"      # admin-only | allowlist | all
```

### Supported Models

70+ models across 16 providers. Defined in `src/config/model-catalog.ts`, shared across CLI, WebUI, and Dashboard.

<table>
<tr>
<td align="center" width="20%"><br><b>Anthropic</b><br>Claude Opus 4.6<br><br></td>
<td align="center" width="20%"><br><b>Codex</b><br>Auto-detected<br><br></td>
<td align="center" width="20%"><br><b>OpenAI</b><br>GPT-5<br><br></td>
<td align="center" width="20%"><br><b>Google</b><br>Gemini 3 Pro<br><br></td>
<td align="center" width="20%"><br><b>xAI</b><br>Grok 4.1<br><br></td>
</tr>
<tr>
<td align="center"><br><b>Groq</b><br>Llama 4 Maverick<br><br></td>
<td align="center"><br><b>OpenRouter</b><br>Multi-provider<br><br></td>
<td align="center"><br><b>Moonshot</b><br>Kimi K2.6<br><br></td>
<td align="center"><br><b>Mistral</b><br>Devstral<br><br></td>
<td align="center"><br><b>Cerebras</b><br>Qwen 3 235B<br><br></td>
</tr>
<tr>
<td align="center"><br><b>ZAI</b><br>GLM-5<br><br></td>
<td align="center"><br><b>MiniMax</b><br>M2.5<br><br></td>
<td align="center"><br><b>Hugging Face</b><br>DeepSeek V3.2<br><br></td>
<td align="center"><br><b>Gocoon</b><br>Decentralized (TON)<br><br></td>
<td align="center"><br><b>Local</b><br>Ollama, vLLM, LM Studio<br><br></td>
<td align="center"><br><b>Grok Build</b><br>CLI auto-detected<br><br></td>
</tr>
</table>

### MCP Servers

Connect external tool servers via the [Model Context Protocol](https://modelcontextprotocol.io/). No code needed - tools are auto-discovered and registered at startup.

**Via CLI (recommended):**
```bash
teleton mcp add @modelcontextprotocol/server-filesystem /tmp
teleton mcp add @openbnb/mcp-server-airbnb
teleton mcp list
teleton mcp remove filesystem
```

**Via config.yaml:**
```yaml
mcp:
  servers:
    filesystem:
      command: npx -y @modelcontextprotocol/server-filesystem /tmp
    brave:
      command: npx -y @modelcontextprotocol/server-brave-search
      env:
        BRAVE_API_KEY: "sk-xxx"
    remote:
      url: http://localhost:3001/mcp
      scope: admin-only
```

**Via WebUI:**

When the WebUI is enabled, the **MCP Servers** page lets you add/remove servers, configure environment variables (API keys), and view connection status and tool lists - all from the browser.

Tools are namespaced as `mcp_<server>_<tool>` (e.g. `mcp_filesystem_read_file`). Each server supports `scope` (always, dm-only, group-only, admin-only) and `enabled` toggle.

### Environment Variables

All environment variables override the corresponding `config.yaml` value at startup - useful for Docker and CI:

| Variable | Description | Default |
|----------|-------------|---------|
| `TELETON_HOME` | Data directory (config, DB, session) | `~/.teleton` |
| `TELETON_API_KEY` | LLM API key | - |
| `TELETON_BASE_URL` | Custom LLM base URL | - |
| `TELETON_TG_API_ID` | Telegram API ID | - |
| `TELETON_TG_API_HASH` | Telegram API Hash | - |
| `TELETON_TG_PHONE` | Phone number | - |
| `TELETON_TAVILY_API_KEY` | Tavily API key for web tools | - |
| `TELETON_TONAPI_KEY` | TonAPI key | - |
| `TELETON_TONCENTER_API_KEY` | Toncenter API key | - |
| `TELETON_WEBUI_ENABLED` | Enable WebUI | `false` |
| `TELETON_WEBUI_PORT` | WebUI port | `7777` |
| `TELETON_WEBUI_HOST` | WebUI bind address | `127.0.0.1` |
| `TELETON_API_ENABLED` | Enable Management API | `false` |
| `TELETON_API_PORT` | Management API port | `7778` |
| `TELETON_LOG_LEVEL` | Log level (debug, info, warn, error) | `info` |

---

## WebUI Dashboard

Optional web dashboard, localhost only, token auth. Start with `teleton start --webui` or `teleton setup --ui`.

<table>
<tr>
<td align="center" width="25%"><br><b>Dashboard</b><br>Status, model, tokens, config<br><br></td>
<td align="center" width="25%"><br><b>Tools</b><br>Toggle, scope, per-module<br><br></td>
<td align="center" width="25%"><br><b>Plugins</b><br>Marketplace, install, secrets<br><br></td>
<td align="center" width="25%"><br><b>Soul Editor</b><br>SOUL, SECURITY, STRATEGY, MEMORY<br><br></td>
</tr>
<tr>
<td align="center"><br><b>Memory Search</b><br>Vector + keyword hybrid<br><br></td>
<td align="center"><br><b>Live Logs (in Dashboard)</b><br>Real-time SSE streaming<br><br></td>
<td align="center"><br><b>Workspace</b><br>File browser + editor<br><br></td>
<td align="center"><br><b>MCP Servers</b><br>Add, remove, configure<br><br></td>
</tr>
<tr>
<td align="center"><br><b>TON Proxy (in Config)</b><br>Start/stop, auto-install<br><br></td>
<td align="center"><br><b>Tasks</b><br>Schedule, dependencies, bulk<br><br></td>
<td align="center"><br><b>Setup Wizard</b><br>QR code + phone auth<br><br></td>
<td align="center"><br><b>Config</b><br>Provider switch, key validation<br><br></td>
</tr>
<tr>
<td align="center"><br><b>Hooks</b><br>Plugin hook registrations<br><br></td>
</tr>
</table>

Auth token is printed at startup. Stored as HttpOnly cookie for 7 days. For remote access:

```bash
ssh -L 7777:localhost:7777 user@remote-server
```

### Coding Agent

By default, the agent has a **sandboxed workspace** at `~/.teleton/workspace/` with 6 file tools (read, write, delete, rename, list, info). Path traversal protection, symlink detection, and 500 MB quota. Core files (`SOUL.md`, `STRATEGY.md`, `SECURITY.md`) are immutable. Write operations are DM-only.

**YOLO mode** unlocks full system access (off by default, Linux only):

| Tool | Description |
|------|-------------|
| `exec_run` | Execute any bash command |
| `exec_install` | Install packages (apt, pip, npm, docker) |
| `exec_service` | Manage systemd services |
| `exec_status` | Server health (disk, RAM, CPU, uptime) |

All commands are audit-logged with user, command, output, exit code, and duration. Configurable timeout (default 120s), scope (`admin-only`, `allowlist`, `all`), and output capture limit.

```yaml
capabilities:
  exec:
    mode: "yolo"          # off | yolo
    scope: "admin-only"   # admin-only | allowlist | all
    limits:
      timeout: 120        # seconds (1-3600)
```

### Admin Commands

All admin commands support `/`, `!`, or `.` prefix:

| Command | Description |
|---------|-------------|
| `/status` | Uptime, model, sessions, wallet, policies |
| `/model <name>` | Hot-swap LLM model at runtime |
| `/policy <dm\|group> <value>` | Change access policies live |
| `/loop <1-50>` | Set max agentic iterations |
| `/wallet` | Show wallet address + balance |
| `/approve <request_id>` / `/reject <request_id>` | Resolve a pending financial action |
| `/modules set\|info\|reset` | Per-group tool permissions |
| `/plugin set\|unset\|keys` | Manage plugin secrets |
| `/task <description>` | Assign a task to the agent |
| `/boot` | Run bootstrap template |
| `/pause` / `/resume` | Pause/resume agent |
| `/clear [chat_id]` | Clear conversation history |
| `/verbose` | Toggle debug logging |
| `/rag [status\|topk <n>]` | Toggle Tool RAG or view status |
| `/guest [on\|off]` | View or toggle bot guest mode |
| `/stop` | Emergency shutdown |
| `/ping` | Check responsiveness |
| `/help` | Show all commands |

---

## Plugins

Extend the agent with custom tools. Install from the WebUI marketplace in one click, or drop a `.js` file in `~/.teleton/plugins/`. Loaded at startup, no rebuild needed. See [official example plugins](https://github.com/TONresistor/teleton-plugins).

```
~/.teleton/plugins/
├── weather.js              # Single-file plugin
└── my-plugin/
    ├── index.js            # Folder plugin
    ├── package.json        # npm deps (auto-installed via npm ci)
    └── package-lock.json
```

Plugins export a `tools` function (recommended) or array, plus optional lifecycle hooks:

```js
// ~/.teleton/plugins/weather.js

export const manifest = {
  name: "weather",
  version: "1.0.0",
  sdkVersion: "^2.0.0",
};

// Optional: creates an isolated database at ~/.teleton/plugins/data/weather.db
export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS weather_cache (
    city TEXT PRIMARY KEY, data TEXT, cached_at INTEGER
  )`);
}

// Required: tools as a function receiving the Plugin SDK
export const tools = (sdk) => [
  {
    name: "weather_get",
    description: "Get current weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
    execute: async (params) => {
      sdk.log.info(`Fetching weather for ${params.city}`);
      const res = await fetch(`https://wttr.in/${params.city}?format=j1`);
      if (!res.ok) return { success: false, error: "City not found" };
      const data = await res.json();
      return { success: true, data: { temp: data.current_condition[0].temp_C } };
    },
  },
];
```

### Plugin SDK

The SDK provides namespaced access to core services:

| Namespace          | Methods                                                                                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sdk.ton`          | **Wallet**: `getAddress()`, `getBalance()`, `getPrice()`, `sendTON()`, `getTransactions()`, `verifyPayment()`                                                                                                                                                                                        |
|                    | **Jettons**: `getJettonBalances()`, `getJettonInfo()`, `sendJetton()`, `getJettonWalletAddress()`                                                                                                                                                                                                    |
|                    | **Analytics**: `getJettonPrice()`, `getJettonHolders()`, `getJettonHistory()`                                                                                                                                                                                                                        |
|                    | **NFT**: `getNftItems()`, `getNftInfo()`                                                                                                                                                                                                                                                             |
|                    | **DEX** (`sdk.ton.dex`): `quote()`, `swap()`, `quoteSTONfi()`, `quoteDeDust()`, `swapSTONfi()`, `swapDeDust()`                                                                                                                                                                                       |
|                    | **DNS** (`sdk.ton.dns`): `check()`, `resolve()`, `getAuctions()`, `startAuction()`, `bid()`, `link()`, `unlink()`, `setSiteRecord()`                                                                                                                                                                 |
|                    | **Signed Transfers**: `createTransfer()`, `createJettonTransfer()`, `getPublicKey()`, `getWalletVersion()`                                                                                                                                                                                           |
|                    | **Utils**: `toNano()`, `fromNano()`, `validateAddress()`                                                                                                                                                                                                                                             |
| `sdk.telegram`     | **Messages**: `sendMessage()`, `editMessage()`, `deleteMessage()`, `forwardMessage()`, `pinMessage()`, `searchMessages()`, `scheduleMessage()`, `getScheduledMessages()`, `deleteScheduledMessage()`, `sendScheduledNow()`, `getReplies()`                                                           |
|                    | **Media**: `sendPhoto()`, `sendVideo()`, `sendVoice()`, `sendFile()`, `sendGif()`, `sendSticker()`, `downloadMedia()`                                                                                                                                                                                |
|                    | **Chat & Users**: `getChatInfo()`, `getUserInfo()`, `resolveUsername()`, `getParticipants()`, `getDialogs()`, `getHistory()`                                                                                                                                                                         |
|                    | **Interactive**: `sendDice()`, `sendReaction()`, `createPoll()`, `createQuiz()`                                                                                                                                                                                                                      |
|                    | **Moderation**: `banUser()`, `unbanUser()`, `muteUser()`, `kickUser()`                                                                                                                                                                                                                               |
|                    | **Stars & Gifts**: `getStarsBalance()`, `sendGift()`, `getAvailableGifts()`, `getMyGifts()`, `getResaleGifts()`, `buyResaleGift()`, `getStarsTransactions()`, `transferCollectible()`, `setCollectiblePrice()`, `getCollectibleInfo()`, `getUniqueGift()`, `getUniqueGiftValue()`, `sendGiftOffer()` |
|                    | **Advanced**: `getMe()`, `getMessages()`, `isAvailable()`, `setTyping()`, `sendStory()`                                                                                                                                                                                                             |
| `sdk.bot`          | `onInlineQuery()`, `onCallback()`, `onChosenResult()`, `editInlineMessage()`, `keyboard()`, `isAvailable`, `username`                                                                                                                                                                                |
| `sdk.secrets`      | `get()`, `require()`, `has()`                                                                                                                                                                                                                                                                        |
| `sdk.storage`      | `get()`, `set()`, `delete()`, `has()`, `clear()` (KV with TTL)                                                                                                                                                                                                                                       |
| `sdk.db`           | Raw `better-sqlite3` database, isolated per plugin                                                                                                                                                                                                                                                   |
| `sdk.config`       | Sanitized app config (no API keys)                                                                                                                                                                                                                                                                   |
| `sdk.pluginConfig` | Plugin-specific config from `config.yaml`                                                                                                                                                                                                                                                            |
| `sdk.log`          | `info()`, `warn()`, `error()`, `debug()`                                                                                                                                                                                                                                                             |
| `sdk.on()`         | Register hooks: `tool:before`, `tool:after`, `tool:error`, `prompt:before`, `prompt:after`, `session:start`, `session:end`, `message:receive`, `response:before`, `response:after`, `response:error`, `agent:start`, `agent:stop`                                                                    |

**Lifecycle hooks**: `migrate(db)`, `start(ctx)` (with `ctx.sdk`), `stop()`, `onMessage(event)`, `onCallbackQuery(event)`

**Security**: all SDK objects are frozen. Plugins never see API keys or other plugins' data.

---

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| LLM | Multi-provider via [pi-ai](https://github.com/mariozechner/pi-ai) (16 providers: Anthropic, Codex, Grok Build, OpenAI, Google, xAI, Groq, OpenRouter, Moonshot, Mistral, Cerebras, ZAI, MiniMax, Hugging Face, Gocoon, Local) |
| Telegram Userbot | [GramJS](https://gram.js.org/) Layer 223 fork (MTProto) |
| Inline Bot | [Grammy](https://grammy.dev/) (Bot API, plugin inline cards and callbacks) |
| Blockchain | [TON SDK](https://github.com/ton-org/ton) (W5R1 wallet) |
| DeFi | STON.fi SDK, DeDust SDK |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) with WAL mode |
| Vector Search | [sqlite-vec](https://github.com/asg017/sqlite-vec) (cosine similarity) |
| Full-Text Search | SQLite FTS5 (BM25 ranking) |
| Embeddings | [@huggingface/transformers](https://www.npmjs.com/package/@huggingface/transformers) (local ONNX) or Voyage AI |
| MCP Client | [@modelcontextprotocol/sdk](https://modelcontextprotocol.io/) (stdio + SSE + Streamable HTTP) |
| WebUI | [Hono](https://hono.dev/) (API) + React + Vite (frontend) |
| Language | TypeScript 5.7, Node.js 22.22.2+ LTS |

### Project Structure

```
src/
├── index.ts                # Entry point, TeletonApp lifecycle, graceful shutdown
├── agent/                  # Core agent runtime
│   ├── runtime.ts          # Agentic loop (5 iterations, tool calling, masking, compaction)
│   ├── client.ts           # Multi-provider LLM client
│   └── tools/              # 128 base tools plus 5 optional system tools
│       ├── register-all.ts # Central tool registration (9 categories)
│       ├── registry.ts     # Tool registry, scope filtering, provider limits
│       ├── module-loader.ts    # Built-in module loading (TON Proxy + exec)
│       ├── plugin-loader.ts    # External plugin discovery, validation, hot-reload
│       ├── mcp-loader.ts       # MCP client (stdio/SSE), tool discovery, lifecycle
│       ├── telegram/       # Telegram operations (83 tools)
│       ├── ton/            # TON blockchain + jettons + DEX router (15 tools)
│       ├── stonfi/         # STON.fi DEX (5 tools)
│       ├── dedust/         # DeDust DEX (5 tools)
│       ├── dns/            # TON DNS (8 tools)
│       ├── exec/           # System execution — YOLO mode (4 tools)
│       ├── journal/        # Business journal (3 tools)
│       └── workspace/      # File operations (6 tools)
├── bot/                    # Plugin inline-query and callback routing
│   ├── inline-router.ts    # Namespaced plugin inline handlers
│   ├── callback-router.ts  # Nonce-based callback dispatch
│   ├── gramjs-bot.ts       # Userbot-to-bot inline transport
│   └── services/           # Shared inline transport
├── telegram/               # Telegram integration layer
│   ├── bridge.ts           # GramJS wrapper (peer cache, message parsing, keyboards)
│   ├── handlers.ts         # Message routing, rate limiting, ChatQueue, feed storage
│   ├── admin.ts            # Runtime admin commands
│   ├── debounce.ts         # Message batching for groups
│   ├── formatting.ts       # Markdown → Telegram HTML
│   ├── task-executor.ts    # Scheduled task runner
│   ├── task-dependency-resolver.ts  # DAG-based task chains
│   └── callbacks/          # Inline button routing
├── memory/                 # Storage and knowledge
│   ├── schema.ts           # 16 tables, 42 indexes/triggers, FTS5, vec0, semver migrations
│   ├── database.ts         # SQLite + WAL + sqlite-vec
│   ├── search/             # RAG system (hybrid vector + BM25 fusion via RRF)
│   ├── embeddings/         # Local ONNX + Voyage AI + caching provider
│   ├── compaction.ts       # Context auto-compaction with AI summarization
│   ├── observation-masking.ts  # Tool result compression (~90% savings)
│   └── daily-logs.ts       # Automatic session summaries
├── ton/                    # TON blockchain
│   ├── wallet-service.ts   # W5R1 wallet, PBKDF2 key caching, encrypted storage
│   ├── transfer.ts         # TON send operations
│   └── payment-verifier.ts # On-chain payment verification with replay protection
├── ton-proxy/             # TON Proxy module (Tonutils-Proxy lifecycle)
│   ├── manager.ts         # Binary download, start/stop, PID file, health checks
│   ├── module.ts          # Module lifecycle integration
│   └── tools.ts           # ton_proxy_status tool
├── sdk/                    # Plugin SDK (v2.1.0)
│   ├── index.ts            # SDK factory (createPluginSDK, all objects frozen)
│   ├── ton.ts              # TON service for plugins
│   ├── telegram.ts         # Telegram service for plugins
│   ├── secrets.ts          # 3-tier secret resolution (env → file → config)
│   └── storage.ts          # KV store with TTL
├── session/                # Session management
│   ├── store.ts            # Session persistence (SQLite, daily reset, idle expiry)
│   └── transcript.ts       # JSONL conversation transcripts
├── soul/                   # System prompt assembly
│   └── loader.ts           # 10 sections: soul + security + strategy + memory + context + ...
├── config/                 # Configuration
│   ├── schema.ts           # Zod schemas + validation
│   ├── providers.ts        # Multi-provider LLM registry (16 providers)
│   └── model-catalog.ts    # Shared model catalog (70+ models across all providers)
├── webui/                  # Optional web dashboard
│   ├── server.ts           # Hono server, auth middleware, static serving
│   └── routes/             # 14 route groups (status, tools, logs, memory, soul, plugins, mcp, tasks, workspace, config, marketplace, hooks, ton-proxy, setup)
├── api/                    # Management API (HTTPS control plane)
│   ├── server.ts           # Hono HTTPS server, TLS, middleware stack
│   ├── bootstrap.ts        # API-only mode (no config needed)
│   ├── middleware/          # Auth, rate-limit, audit, request-id
│   └── routes/             # Agent lifecycle, system, logs, memory, auth
├── constants/              # Centralized limits, timeouts, API endpoints
├── utils/                  # Logger, sanitize, retry, fetch
├── workspace/              # Path validator (anti-traversal, anti-symlink)
├── templates/              # Workspace template files (SOUL.md, etc.)
└── cli/                    # CLI commands (setup, config, doctor, mcp)

web/                        # React + Vite frontend (11 pages)
packages/sdk/               # Published @teleton-agent/sdk
```

---

## Security

### Multi-Layer Defense

| Layer | Protection |
|-------|-----------|
| **Prompt injection** | `sanitizeForPrompt()` strips control chars, invisible unicode, markdown injection. `sanitizeForContext()` for RAG results |
| **Immutable config** | SOUL.md, STRATEGY.md, SECURITY.md cannot be modified by the agent |
| **Workspace sandbox** | Agent confined to `~/.teleton/workspace/`, recursive URL decoding blocks double-encoding attacks, symlinks detected and blocked |
| **Plugin isolation** | Frozen SDK objects, sanitized config (no API keys), isolated per-plugin databases, `npm ci --ignore-scripts` |
| **Wallet protection** | File permissions `0o600`, KeyPair cached (single PBKDF2), mnemonic never exposed to plugins |
| **Memory protection** | Memory writes blocked in group chats to prevent poisoning |
| **Payment security** | Verified payment hashes are recorded with `INSERT OR IGNORE`, preventing replay of the same transaction |
| **Exec audit** | All YOLO mode commands logged to `exec_audit` table with user, command, output, and timestamps |
| **Pino redaction** | Structured logging with automatic redaction of apiKey, password, secret, token, mnemonic fields |
| **Tool access control** | Per-tool access level (all, allow-list, admin, off), DM vs group gated by global policies, per-group module permissions, all runtime-configurable |

### Reporting Vulnerabilities

Do not open public issues for security vulnerabilities. Contact maintainers (t.me/zkproof) directly or use GitHub's private security advisory feature.

### Best Practices

1. Use a dedicated Telegram account
2. Backup your 24-word mnemonic securely offline
3. Start with restrictive policies (`admin-only` or `allowlist`)
4. Set file permissions: `chmod 600 ~/.teleton/wallet.json`
5. Never commit `config.yaml` to version control
6. Review `SECURITY.md` and customize for your use case

---

## Development

### Setup

```bash
git clone https://github.com/TONresistor/teleton-agent.git
cd teleton-agent
npm install
npm run setup
npm run dev  # Watch mode with auto-restart
```

### Commands

```bash
npm run build       # SDK → backend (tsup) → frontend (vite)
npm run start       # Start agent (compiled)
npm run dev         # Development mode (watch, tsx)
npm run dev:web     # Frontend dev server (port 5173, proxied to 7777)
npm run setup       # Run setup wizard
npm run doctor      # Health checks
npm run typecheck   # Type checking
npm run lint        # ESLint
npm run test        # Vitest
npm run format      # Prettier
```

---

## Documentation

Full documentation is available in the [`docs/`](docs/) directory:

| Section | Description |
|---------|-------------|
| [Configuration Guide](docs/configuration.md) | Complete reference for every config option |
| [Deployment Guide](docs/deployment.md) | Docker, systemd, docker-compose, VPS |
| [Plugin Development](docs/plugins.md) | Step-by-step plugin tutorial |
| [Telegram Setup](docs/telegram-setup.md) | API credentials, policies, 2FA, admin commands |
| [TON Wallet](docs/ton-wallet.md) | Wallet setup, DEX trading, security |
| [Management API](docs/management-api.md) | HTTPS API, bootstrap mode, authentication, endpoints |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Verify: `npm run typecheck && npm run lint && npm test`
5. Open a Pull Request against `main`

---

## Contributors

<a href="https://github.com/TONresistor/teleton-agent/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=TONresistor/teleton-agent" />
</a>

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Credits

### Built With

- [pi-ai](https://github.com/mariozechner/pi-ai) - Multi-provider LLM SDK
- [GramJS](https://gram.js.org/) - Telegram MTProto library
- [Grammy](https://grammy.dev/) - Telegram Bot API framework
- [TON SDK](https://github.com/ton-org/ton) - TON blockchain client
- [STON.fi SDK](https://www.npmjs.com/package/@ston-fi/sdk) - DEX integration
- [DeDust SDK](https://www.npmjs.com/package/@dedust/sdk) - DEX integration
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Model Context Protocol client
- [sqlite-vec](https://github.com/asg017/sqlite-vec) - Vector search for SQLite
- [Hono](https://hono.dev/) - Lightweight web framework
- [Tonutils-Proxy](https://github.com/xssnick/Tonutils-Proxy) - TON Proxy for .ton sites

---

## Support

- **Issues**: [GitHub Issues](https://github.com/TONresistor/teleton-agent/issues)
- **Channel**: [@teletonagents](https://t.me/teletonagents)
- **Group Chat**: [@teletonagentHQ](https://t.me/teletonagentHQ)
- **Contact**: [@zkproof](https://t.me/zkproof)
