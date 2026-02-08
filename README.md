<h1 align="center">Teleton Agent</h1>

<p align="center"><b>Autonomous AI agent for Telegram with native TON blockchain integration</b></p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.7-blue" alt="TypeScript"></a>
</p>

---

## Overview

Teleton is a production-grade autonomous AI agent that operates as a real Telegram user account (not a bot), powered by multi-provider LLM support. It provides full access to the Telegram API with deep TON blockchain integration for cryptocurrency trading, NFT marketplace operations, and decentralized finance.

### Key Highlights

- **Full Telegram access**: Operates as a real user with the full API, not a limited bot
- **Multi-Provider LLM**: Anthropic, OpenAI, Google Gemini, xAI Grok, Groq, OpenRouter
- **TON Blockchain**: Built-in wallet, send/receive TON, swap jettons on STON.fi and DeDust, NFT auctions
- **Gift trading**: Buy and sell Telegram collectible gifts with real-time floor prices and strategy enforcement
- **Persistent memory**: Remembers context across restarts with automatic context management
- **121 tools**: Messaging, media, blockchain transactions, DEX swaps, market analysis, deals, and more
- **Plugin system**: Drop a `.js` file in a folder and restart, no rebuild needed
- **Secure by design**: Sandboxed workspace, immutable config, strategy rules enforced in code

---

## Features

### Tool Categories

| Category | Tools | Description |
|----------|-------|-------------|
| Telegram | 59 | Full API: messaging, media, groups, polls, stickers, gifts, stories, contacts |
| TON Blockchain | 17 | W5R1 wallet, send/receive TON, transaction history, price tracking |
| Jettons (Tokens) | 11 | Balances, swaps, prices, holders, trending tokens, liquidity pools |
| DeFi | 5 | STON.fi and DeDust DEX integration, smart routing for best swap rates |
| Deals | 5 | Secure gift/TON trading with inline bot, strategy enforcement, verification |
| TON DNS | 7 | Domain availability, auctions, bidding, resolution |
| Gift Marketplace | 4 | Floor prices, search, price history for Telegram collectible gifts |
| Business Journal | 3 | Track trades/gifts/operations with reasoning and P&L analysis |
| Memory | 2 | Persistent memory management, RAG-powered context retrieval |
| Workspace | 6 | Sandboxed file operations with security validation |

### Advanced Capabilities

| Capability | Description |
|-----------|-------------|
| **Multi-Provider LLM** | Switch between Anthropic, OpenAI, Google, xAI, Groq, OpenRouter with one config change |
| **RAG Search** | Hybrid keyword (FTS5) + semantic (vector) search for context-aware responses |
| **Auto-Compaction** | AI-summarized context management prevents overflow, preserves key information |
| **Observation Masking** | Compresses old tool results to save ~90% context window |
| **Casino System** | Provably fair slot machine and dice games with TON payments, jackpot, and leaderboard |
| **Deals System** | Secure gift/TON trading with code-enforced strategy rules and inline bot confirmations |
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
- **Bot Token** *(optional, for deals)* - From [@BotFather](https://t.me/BotFather)

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
docker run -it -v ~/.teleton:/data ghcr.io/tonresistor/teleton:latest setup
```

**From source (development):**
```bash
git clone https://github.com/TONresistor/teleton-agent.git
cd teleton
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

  # Optional: inline bot for deals system
  bot_token: "123456:ABC-DEF..."
  bot_username: "your_deals_bot"

  session_reset_policy:
    daily_reset_enabled: true
    daily_reset_hour: 4
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELETON_HOME` | Data directory (config, DB, session) | `~/.teleton` |
| `TELETON_API_KEY` | LLM API key (overrides config) | - |
| `TELETON_TG_API_ID` | Telegram API ID (overrides config) | - |
| `TELETON_TG_API_HASH` | Telegram API Hash (overrides config) | - |
| `TELETON_TG_PHONE` | Phone number (overrides config) | - |

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
| Inline Bot | [Grammy](https://grammy.dev/) (Bot API, for deal confirmations) |
| Blockchain | [TON SDK](https://github.com/ton-org/ton) (W5R1 wallet) |
| DeFi | STON.fi SDK, DeDust SDK |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) with WAL mode |
| Vector Search | [sqlite-vec](https://github.com/asg017/sqlite-vec) (optional) |
| Token Counting | [js-tiktoken](https://github.com/dqbd/tiktoken) |
| Language | TypeScript 5.7, Node.js 20+ |

### Project Structure

```
teleton-agent/
├── src/
│   ├── index.ts               # Main app, tool registry
│   ├── agent/                  # Core agent runtime
│   │   ├── runtime.ts          # Agentic loop orchestration
│   │   ├── client.ts           # Multi-provider LLM client
│   │   └── tools/              # 121 tool implementations
│   │       ├── telegram/       # Telegram tools (59)
│   │       ├── ton/            # TON blockchain (17)
│   │       ├── jetton/         # Token operations (11)
│   │       ├── deals/          # Deal management (5)
│   │       ├── dns/            # TON DNS (7)
│   │       ├── dedust/         # DeDust DEX (3)
│   │       ├── dex/            # Smart router (2)
│   │       ├── journal/        # Business journal (3)
│   │       └── workspace/      # File operations (6)
│   ├── telegram/               # Telegram integration
│   │   ├── bridge.ts           # GramJS wrapper
│   │   ├── handlers.ts         # Message processing
│   │   ├── admin.ts            # Admin commands
│   │   └── callbacks/          # Inline button routing
│   ├── bot/                    # Grammy inline bot (deals)
│   │   ├── index.ts            # DealBot class
│   │   └── services/           # Message builder, verification poller
│   ├── deals/                  # Deal engine
│   │   ├── strategy-checker.ts # STRATEGY.md enforcement
│   │   ├── executor.ts         # TON/gift transfers
│   │   └── gift-detector.ts    # Gift receipt verification
│   ├── memory/                 # Storage and knowledge
│   │   ├── schema.ts           # Database schema + migrations
│   │   ├── search/             # RAG system (FTS5 + vector)
│   │   └── compaction.ts       # Context auto-compaction
│   ├── ton/                    # TON blockchain
│   │   ├── wallet-service.ts   # W5R1 wallet
│   │   └── transfer.ts         # TON send operations
│   ├── soul/                   # System prompt assembly
│   │   └── loader.ts           # SOUL + STRATEGY + SECURITY + MEMORY
│   ├── workspace/              # Sandboxed file system
│   │   ├── validator.ts        # Path traversal protection
│   │   └── paths.ts            # Workspace constants
│   ├── config/                 # Configuration
│   │   ├── schema.ts           # Zod validation
│   │   └── providers.ts        # LLM provider registry
│   └── cli/                    # CLI commands
│       └── commands/           # setup, doctor
└── README.md
```

---

## Security

### Multi-Layer Defense

| Layer | Protection |
|-------|-----------|
| **SECURITY.md** | Identity-based security principles injected into every system prompt |
| **Strategy enforcement** | Trading rules (buy/sell thresholds) enforced in code, not prompts |
| **Immutable config** | SOUL.md, STRATEGY.md, SECURITY.md cannot be modified by the agent |
| **Memory protection** | Memory writes blocked in group chats to prevent poisoning |
| **Workspace sandbox** | Agent can only access `~/.teleton/workspace/`, path traversal blocked |
| **Deal verification** | Gift transfers require a verified deal with blockchain-confirmed payment |
| **Replay protection** | Used transactions table prevents double-spending |

### Reporting Vulnerabilities

Do not open public issues for security vulnerabilities. Contact maintainers (t.me/zkproof) directly or use GitHub's private security advisory feature.

### Best Practices

1. Use a dedicated Telegram account
2. Backup your 24-word mnemonic securely offline
3. Start with restrictive policies (`allowlist`)
4. Set file permissions: `chmod 600 ~/.teleton/wallet.json`
5. Never commit `config.yaml` to version control
6. Configure `STRATEGY.md` with conservative trading thresholds
7. Review `SECURITY.md` and customize for your use case

---

## Development

### Setup

```bash
git clone https://github.com/TONresistor/teleton-agent.git
cd teleton
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

Teleton supports external plugins loaded from `~/.teleton/plugins/`. Drop a `.js` file or a folder with `index.js`, and it's automatically loaded at startup — no rebuild needed.

```
~/.teleton/plugins/
├── weather.js              # Single file plugin
└── rss-reader/
    └── index.js            # Folder plugin
```

Each plugin exports a `tools` array:

```js
// ~/.teleton/plugins/weather.js
export const tools = [
  {
    name: "weather_get",
    description: "Get current weather for a city",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name" }
      },
      required: ["city"]
    },
    execute: async (params, context) => {
      const res = await fetch(`https://wttr.in/${params.city}?format=j1`);
      const data = await res.json();
      return { success: true, data: { temp: data.current_condition[0].temp_C } };
    }
  }
];
```

The `context` object gives access to `bridge` (Telegram), `db` (SQLite), `chatId`, `senderId`, `config`, and `marketService`.

At startup you'll see:
```
🔌 Plugin "weather.js": 1 tool registered
✅ 122 tools loaded (1 from plugins)
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
