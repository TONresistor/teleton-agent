<h1 align="center">Teleton Agent</h1>

<p align="center"><b>Autonomous AI agent for Telegram with native TON blockchain integration</b></p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.7-blue" alt="TypeScript"></a>
  <a href="https://teletonagent.dev"><img src="https://img.shields.io/badge/Website-teletonagent.dev-ff6600" alt="Website"></a>
</p>

---

<p align="center">Teleton is a production-grade autonomous AI agent that operates as a real Telegram user account (not a bot), powered by multi-provider LLM support. It provides full access to the Telegram API with deep TON blockchain integration for cryptocurrency operations, DEX trading, and decentralized finance.</p>

### Key Highlights

- **Full Telegram access**: Operates as a real user with the full API, not a limited bot
- **Multi-Provider LLM**: Anthropic, OpenAI, Google Gemini, xAI Grok, Groq, OpenRouter
- **TON Blockchain**: Built-in wallet, send/receive TON & jettons, swap on STON.fi and DeDust, NFTs
- **Persistent memory**: Remembers context across restarts with automatic context management
- **112 built-in tools**: Messaging, media, blockchain, DEX trading, deals, DNS, journaling, and more
- **Plugin SDK**: Extend the agent with custom tools — full access to TON and Telegram APIs via namespaced SDK
- **Secure by design**: Sandboxed workspace, immutable config, prompt injection defense

---

## Features

### Tool Categories

| Category | Tools | Description |
|----------|-------|-------------|
| Telegram | 66 | Messaging, media, chats, groups, polls, stickers, gifts, stars, stories, contacts, folders, profile, memory, tasks |
| TON & Jettons | 15 | W5R1 wallet, send/receive TON & jettons, balances, prices, holders, history, charts, NFTs, DEX quotes |
| STON.fi DEX | 5 | Swap, quote, search, trending tokens, liquidity pools |
| DeDust DEX | 5 | Swap, quote, pools, prices, token info |
| TON DNS | 7 | Domain auctions, bidding, linking, resolution, availability checks |
| Deals | 5 | Secure gift/TON trading with strategy enforcement and inline bot confirmations |
| Journal | 3 | Trade/operation logging with natural language queries |
| Workspace | 6 | Sandboxed file operations with path traversal protection |

### Advanced Capabilities

| Capability | Description |
|-----------|-------------|
| **Multi-Provider LLM** | Switch between Anthropic, OpenAI, Google, xAI, Groq, OpenRouter with one config change |
| **RAG + Hybrid Search** | Local embeddings with FTS5 keyword + sqlite-vec semantic search |
| **Auto-Compaction** | AI-summarized context management prevents overflow, preserves key information |
| **Observation Masking** | Compresses old tool results to save ~90% context window |
| **Plugin SDK** | Namespaced SDK (`sdk.ton`, `sdk.telegram`, `sdk.secrets`, `sdk.storage`) with 53 methods, isolated databases and lifecycle hooks |
| **Vision Analysis** | Image understanding via multimodal LLM |
| **Voice Synthesis** | Text-to-speech for voice messages |
| **Scheduled Tasks** | Time-based task execution with dependency resolution |
| **Message Debouncing** | Intelligent batching of rapid group messages |
| **Daily Logs** | Automatic session summaries preserved across resets |
| **Multi-Policy Access** | Configurable DM/group policies (open, allowlist, pairing, disabled) |
| **Sandboxed Workspace** | Secure file system with path traversal protection and immutable config files |

---

## Prerequisites

- **Node.js 20.0.0+** - [Download](https://nodejs.org/)
- **LLM API Key** - One of: [Anthropic](https://console.anthropic.com/) (recommended), [OpenAI](https://platform.openai.com/), [Google](https://aistudio.google.com/), [xAI](https://console.x.ai/), [Groq](https://console.groq.com/), [OpenRouter](https://openrouter.ai/)
- **Telegram Account** - Dedicated account recommended for security
- **Telegram API Credentials** - From [my.telegram.org/apps](https://my.telegram.org/apps)
- **Your Telegram User ID** - Message [@userinfobot](https://t.me/userinfobot)
- **Bot Token** *(optional)* - From [@BotFather](https://t.me/BotFather) for inline bot features

> **Security Warning**: The agent will have full control over the Telegram account. Use a dedicated account, not your main one.

---

## Quick Start

### 1. Installation

**One-liner (recommended):**
```bash
curl -fsSL https://raw.githubusercontent.com/TONresistor/teleton-agent/main/install.sh | bash
```

**npm:**
```bash
npm install -g teleton
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

### 2. Setup

```bash
teleton setup
```

The wizard will configure:
- LLM provider selection (Anthropic, OpenAI, Google, xAI, Groq, OpenRouter)
- Telegram authentication (API credentials, phone, login code)
- Access policies (DM/group response rules)
- Admin user ID
- TON wallet generation (W5R1 with 24-word mnemonic)
- Workspace initialization (SOUL.md, IDENTITY.md, STRATEGY.md, SECURITY.md, USER.md, BOOTSTRAP.md, MEMORY.md)

Configuration files created:
- `~/.teleton/config.yaml` - Main configuration
- `~/.teleton/wallet.json` - TON wallet (backup mnemonic securely)
- `~/.teleton/memory.db` - SQLite database
- `~/.teleton/workspace/` - Sandboxed file storage

### 3. Start

If setup completed without errors, your agent is ready to go:

```bash
teleton start
```

### 4. Verify

Send a message to your agent on Telegram:

```
You: /ping
Agent: Pong! I'm alive.

You: /status
Agent: [Displays uptime, model, tool count, wallet balance]
```

> **Need more details?** See [GETTING_STARTED.md](GETTING_STARTED.md) for the full guide — admin commands, troubleshooting, workspace templates, plugins, and more.

---

## Configuration

The `teleton setup` wizard generates a fully configured `~/.teleton/config.yaml` file. Manual editing is only necessary if you want to adjust settings after the initial setup.

```yaml
agent:
  provider: "anthropic"              # anthropic | openai | google | xai | groq | openrouter
  api_key: "sk-ant-api03-..."
  model: "claude-opus-4-5-20251101"
  utility_model: "claude-3-5-haiku-20241022"  # optional, for summarization
  max_agentic_iterations: 5

telegram:
  dm_policy: "open"         # open | allowlist | pairing | disabled
  group_policy: "open"      # open | allowlist | disabled
  require_mention: true
  admin_ids: [123456789]
  owner_name: "Your Name"
  owner_username: "your_username"

  # Optional: inline bot for interactive features
  bot_token: "123456:ABC-DEF..."
  bot_username: "your_bot"

  session_reset_policy:
    daily_reset_enabled: true
    daily_reset_hour: 4

webui:                       # Optional: Web dashboard
  enabled: false             # Enable WebUI server
  port: 7777                 # HTTP server port
  host: "127.0.0.1"          # Localhost only (security)
  # auth_token: "..."        # Auto-generated if omitted
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELETON_HOME` | Data directory (config, DB, session) | `~/.teleton` |
| `TELETON_API_KEY` | LLM API key (overrides config) | - |
| `TELETON_TG_API_ID` | Telegram API ID (overrides config) | - |
| `TELETON_TG_API_HASH` | Telegram API Hash (overrides config) | - |
| `TELETON_TG_PHONE` | Phone number (overrides config) | - |
| `TELETON_WEBUI_ENABLED` | Enable WebUI (overrides config) | `false` |
| `TELETON_WEBUI_PORT` | WebUI port (overrides config) | `7777` |

---

## WebUI Dashboard

Teleton includes an **optional web dashboard** for monitoring and configuration. The WebUI is disabled by default and runs only on localhost for security.

### Features

- **Dashboard**: System status, uptime, model info, session count
- **Tools Management**: View all 112+ tools grouped by module with scope badges
- **Plugins Browser**: List loaded plugins with manifests
- **Soul Editor**: Edit SOUL.md, SECURITY.md, STRATEGY.md, MEMORY.md files
- **Memory Search**: Search knowledge base with hybrid vector+keyword search
- **Live Logs**: Real-time log streaming via Server-Sent Events

### Usage

**Enable via config.yaml:**
```yaml
webui:
  enabled: true
  port: 7777
```

**Enable via CLI flag:**
```bash
teleton start --webui
# or specify custom port
teleton start --webui --webui-port 8080
```

**Enable via environment variable:**
```bash
TELETON_WEBUI_ENABLED=true teleton start
```

### Access

When WebUI is enabled, the agent will display:
```
🌐 WebUI: http://localhost:7777?token=your-token-here
🔑 Token: your-token-here
```

1. Click the URL (token is auto-filled) or visit `http://localhost:7777`
2. Paste the token from the console (displayed once at startup)
3. Token is stored in browser localStorage for subsequent visits

### Security

- **Localhost only**: Server binds to `127.0.0.1` by default (not accessible from network)
- **Bearer token auth**: All API routes require authentication
- **No persistence**: Runtime changes (like model switches via WebUI) are not saved to config.yaml
- **For remote access**: Use SSH tunneling or reverse proxy (nginx/caddy) with HTTPS

**SSH tunnel example:**
```bash
ssh -L 7777:localhost:7777 user@remote-server
# Then access http://localhost:7777 on your local machine
```

### Workspace Files

The agent's personality and rules are configured via markdown files in `~/.teleton/workspace/`. Default templates are generated during `teleton setup` — you can edit any of them to customize your agent:

| File | Purpose | Mutable by Agent |
|------|---------|-----------------|
| `SOUL.md` | Personality, tone, behavior guidelines | No |
| `IDENTITY.md` | Agent name, bio, public-facing identity | No |
| `STRATEGY.md` | Trading rules, buy/sell thresholds | No |
| `SECURITY.md` | Security principles, threat recognition | No |
| `USER.md` | Owner information and preferences | No |
| `BOOTSTRAP.md` | First-run instructions (read once at startup) | No |
| `MEMORY.md` | Persistent memory (facts, contacts, decisions) | Yes |

> **Tip**: Templates are located in `src/templates/` if installing from source. Edit the workspace copies in `~/.teleton/workspace/` — not the source templates.

### Admin Commands

| Command | Description |
|---------|-------------|
| `/task <description>` | Assign a task to the agent |
| `/status` | View agent status |
| `/clear [chat_id]` | Clear conversation history |
| `/ping` | Check responsiveness |
| `/help` | Show all commands |

---

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| LLM | Multi-provider via [pi-ai](https://github.com/mariozechner/pi-ai) (Anthropic, OpenAI, Google, xAI, Groq, OpenRouter) |
| Telegram Userbot | [GramJS](https://gram.js.org/) (MTProto) |
| Inline Bot | [Grammy](https://grammy.dev/) (Bot API) |
| Blockchain | [TON SDK](https://github.com/ton-org/ton) (W5R1 wallet) |
| DeFi | STON.fi SDK, DeDust SDK |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) with WAL mode |
| Vector Search | [sqlite-vec](https://github.com/asg017/sqlite-vec) (optional) |
| Token Counting | [js-tiktoken](https://github.com/dqbd/tiktoken) |
| Language | TypeScript 5.7, Node.js 20+ |

### Project Structure

```
src/
├── index.ts                # Entry point, lifecycle, module loading
├── agent/                  # Core agent runtime
│   ├── runtime.ts          # Agentic loop orchestration
│   ├── client.ts           # Multi-provider LLM client
│   └── tools/              # 112 built-in tools
│       ├── register-all.ts # Central tool registration
│       ├── registry.ts     # Tool registry + scope filtering
│       ├── module-loader.ts    # Built-in module loading (deals)
│       ├── plugin-loader.ts    # External plugin discovery
│       ├── telegram/       # Telegram operations (66 tools)
│       ├── ton/            # TON blockchain + jettons + DEX quote (15 tools)
│       ├── stonfi/         # STON.fi DEX (5 tools)
│       ├── dedust/         # DeDust DEX (5 tools)
│       ├── dns/            # TON DNS (7 tools)
│       ├── journal/        # Business journal (3 tools)
│       └── workspace/      # File operations (6 tools)
├── deals/                  # Deals module (5 tools, loaded via module-loader)
│   ├── module.ts           # Module definition + lifecycle
│   ├── executor.ts         # Deal execution logic
│   └── strategy-checker.ts # Trading strategy enforcement
├── bot/                    # Deals inline bot (Grammy + GramJS)
│   ├── index.ts            # DealBot (Grammy Bot API)
│   ├── gramjs-bot.ts       # GramJS MTProto for styled buttons
│   └── services/           # Message builder, styled keyboard, verification
├── telegram/               # Telegram integration layer
│   ├── bridge.ts           # GramJS wrapper (MTProto)
│   ├── handlers.ts         # Message routing and processing
│   ├── admin.ts            # Admin commands (/status, /clear, /modules)
│   ├── debounce.ts         # Message batching for groups
│   ├── formatting.ts       # Markdown → Telegram HTML
│   └── callbacks/          # Inline button routing
├── memory/                 # Storage and knowledge
│   ├── schema.ts           # Database schema + migrations
│   ├── database.ts         # SQLite + WAL + vec0
│   ├── search/             # RAG system (FTS5 + vector)
│   ├── embeddings/         # Local + Anthropic embedding providers
│   ├── compaction.ts       # Context auto-compaction
│   ├── observation-masking.ts  # Tool result compression (~90% savings)
│   └── daily-logs.ts       # Automatic session summaries
├── ton/                    # TON blockchain
│   ├── wallet-service.ts   # W5R1 wallet + KeyPair cache
│   ├── transfer.ts         # TON send operations
│   └── payment-verifier.ts # On-chain payment verification
├── sdk/                    # Plugin SDK (v1.0.0)
│   ├── index.ts            # SDK factory (createPluginSDK)
│   ├── ton.ts              # TON service for plugins
│   ├── telegram.ts         # Telegram service for plugins
│   └── types.ts            # Public SDK types
├── session/                # Session management
│   ├── store.ts            # Session persistence (SQLite)
│   └── transcript.ts       # Conversation transcripts
├── soul/                   # System prompt assembly
│   └── loader.ts           # SOUL + STRATEGY + SECURITY + MEMORY
├── config/                 # Configuration
│   ├── schema.ts           # Zod schemas + validation
│   └── providers.ts        # Multi-provider LLM registry
├── constants/              # Centralized limits, timeouts, API endpoints
├── services/               # Shared services (TTS)
├── utils/                  # Logger, sanitize, retry, fetch
├── workspace/              # Sandboxed file system
├── templates/              # Workspace template files (SOUL.md, etc.)
└── cli/                    # CLI commands (setup, doctor)
```

---

## Security

### Multi-Layer Defense

| Layer | Protection |
|-------|-----------|
| **SECURITY.md** | Identity-based security principles injected into every system prompt |
| **Immutable config** | SOUL.md, STRATEGY.md, SECURITY.md cannot be modified by the agent |
| **RAG sanitization** | Stored prompt injection defense on all retrieved context |
| **Memory protection** | Memory writes blocked in group chats to prevent poisoning |
| **Workspace sandbox** | Agent can only access `~/.teleton/workspace/`, path traversal blocked |
| **Plugin isolation** | Plugins get sanitized config (no API keys), isolated databases, frozen SDK objects |

### Reporting Vulnerabilities

Do not open public issues for security vulnerabilities. Contact maintainers (t.me/zkproof) directly or use GitHub's private security advisory feature.

### Best Practices

1. Use a dedicated Telegram account
2. Backup your 24-word mnemonic securely offline
3. Start with restrictive policies (`allowlist`)
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
npm run build       # Compile TypeScript to dist/
npm run start       # Start agent (compiled)
npm run dev         # Development mode (watch, tsx)
npm run setup       # Run setup wizard
npm run doctor      # Health checks
npm run typecheck   # Type checking
npm run lint        # ESLint
npm run format      # Prettier
```

### Plugins

Plugins extend the agent with custom tools. Drop a `.js` file or folder in `~/.teleton/plugins/` — loaded at startup, no rebuild needed.

```
~/.teleton/plugins/
├── weather.js              # Single-file plugin
└── my-plugin/
    └── index.js            # Folder plugin
```

Plugins export a `tools` function (recommended) or array, plus optional lifecycle hooks:

```js
// ~/.teleton/plugins/weather.js

export const manifest = {
  name: "weather",
  version: "1.0.0",
  sdkVersion: "1.0.0",
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

#### Plugin SDK

When `tools` is a function, the SDK provides namespaced access to core services:

| Namespace | Methods |
|-----------|---------|
| `sdk.ton` | **Wallet**: `getAddress()`, `getBalance()`, `getPrice()`, `sendTON()`, `getTransactions()`, `verifyPayment()` |
| | **Jettons**: `getJettonBalances()`, `getJettonInfo()`, `sendJetton()`, `getJettonWalletAddress()` |
| | **NFT**: `getNftItems()`, `getNftInfo()` |
| | **Utils**: `toNano()`, `fromNano()`, `validateAddress()` |
| `sdk.telegram` | **Messages**: `sendMessage()`, `editMessage()`, `deleteMessage()`, `forwardMessage()`, `pinMessage()`, `searchMessages()`, `scheduleMessage()`, `getReplies()` |
| | **Media**: `sendPhoto()`, `sendVideo()`, `sendVoice()`, `sendFile()`, `sendGif()`, `sendSticker()`, `downloadMedia()` |
| | **Chat & Users**: `getChatInfo()`, `getUserInfo()`, `resolveUsername()`, `getParticipants()` |
| | **Interactive**: `sendDice()`, `sendReaction()`, `createPoll()`, `createQuiz()` |
| | **Moderation**: `banUser()`, `unbanUser()`, `muteUser()` |
| | **Stars & Gifts**: `getStarsBalance()`, `sendGift()`, `getAvailableGifts()`, `getMyGifts()`, `getResaleGifts()`, `buyResaleGift()` |
| | **Advanced**: `getMe()`, `isAvailable()`, `getRawClient()`, `setTyping()`, `sendStory()` |
| `sdk.secrets` | `get()`, `require()`, `has()` — Multi-source secret resolution (env -> store -> config) |
| `sdk.storage` | `get()`, `set()`, `delete()`, `has()`, `clear()` — KV store with TTL support |
| `sdk.db` | Raw `better-sqlite3` database for custom SQL |
| `sdk.config` | Sanitized app config (no API keys exposed) |
| `sdk.pluginConfig` | Plugin-specific config from `config.yaml` `plugins:` section |
| `sdk.log` | `info()`, `warn()`, `error()`, `debug()` — Prefixed logger |

Plugin config in `config.yaml`:
```yaml
plugins:
  weather:
    api_key: "abc123"
```

Backward compatible: plugins can export `tools` as a static array without the SDK.

At startup:
```
🔌 Plugin "weather": 1 tool registered
✅ 117 tools loaded (1 from plugins)
```

---

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly (`npm run dev`)
5. Commit with clear messages
6. Open a Pull Request

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

---

## Support

- **Issues**: [GitHub Issues](https://github.com/TONresistor/teleton-agent/issues)
- **Channel**: [@ResistanceTools](https://t.me/ResistanceTools)
- **Group Chat**: [@ResistanceForum](https://t.me/ResistanceForum)
- **Contact**: [@zkproof](https://t.me/zkproof)
