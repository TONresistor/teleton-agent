<p align="center">
  <img src="./logo_dark.png" alt="Teleton Agent" width="700" />
</p>

<p align="center"><b>Autonomous AI agent platform for Telegram with native TON blockchain integration</b></p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.7-blue" alt="TypeScript"></a>
  <a href="https://teletonagent.dev"><img src="https://img.shields.io/badge/Website-teletonagent.dev-ff6600" alt="Website"></a>
  <a href="https://docs.teletonagent.dev"><img src="https://img.shields.io/badge/docs-Teleton%20Agents-blue" alt="Documentation"></a>
  <a href="https://ton.org"><img src="https://img.shields.io/badge/Built_on-TON-0098EA?logo=ton&logoColor=white" alt="Built on TON"></a>
</p>

---

<p align="center">Teleton is an autonomous AI agent platform that operates as a real Telegram user account (not a bot). It thinks through an agentic loop with tool calling, remembers conversations across sessions with hybrid RAG, and natively integrates the TON blockchain: send crypto, swap on DEXs, bid on domains, verify payments - all from a chat message. It can schedule tasks to run autonomously at any time. It ships with 125+ built-in tools, supports 11 LLM providers, and exposes a Plugin SDK so you can build your own tools on top of the platform.</p>

### Key Highlights

- **Full Telegram access** - Operates as a real user via MTProto (GramJS), not a limited bot
- **Agentic loop** - Up to 5 iterations of tool calling per message, the agent thinks, acts, observes, and repeats
- **Multi-Provider LLM** - Anthropic, Claude Code, OpenAI, Google Gemini, xAI Grok, Groq, OpenRouter, Moonshot, Mistral, Cocoon, Local (11 providers)
- **TON Blockchain** - Built-in W5R1 wallet, send/receive TON & jettons, swap on STON.fi and DeDust, NFTs, DNS domains
- **Persistent memory** - Hybrid RAG (sqlite-vec + FTS5), auto-compaction with AI summarization, daily logs
- **125+ built-in tools** - Messaging, media, blockchain, DEX trading, deals, DNS, exec, journaling, and more
- **Plugin SDK** - Extend the agent with custom tools, frozen SDK with isolated databases, secrets management, lifecycle hooks
- **MCP Client** - Connect external tool servers (stdio/SSE/Streamable HTTP) with 2 lines of YAML, no code, no rebuild
- **Secure by design** - Prompt injection defense, sandboxed workspace, plugin isolation, wallet encryption

---

## Features

### Tool Categories

| Category      | Tools | Description                                                                                                        |
| ------------- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| Telegram      | 77    | Messaging, media, chats, groups, polls, stickers, gifts, stars, stories, contacts, folders, profile, memory, tasks, voice transcription, scheduled messages |
| TON & Jettons | 15    | W5R1 wallet, send/receive TON & jettons, balances, prices, holders, history, charts, NFTs, smart DEX router        |
| STON.fi DEX   | 5     | Swap, quote, search, trending tokens, liquidity pools                                                              |
| DeDust DEX    | 5     | Swap, quote, pools, prices, token analytics (holders, top traders, buy/sell tax)                                   |
| TON DNS       | 8     | Domain auctions, bidding, linking/unlinking, TON Site hosting, resolution, availability checks                      |
| Deals         | 5     | P2P escrow with inline buttons, on-chain payment verification, anti double-spend                                   |
| Journal       | 3     | Trade/operation logging with P&L tracking and natural language queries                                             |
| Web           | 2     | Web search and page extraction via Tavily (search, fetch/extract)                                                  |
| Workspace     | 6     | Sandboxed file operations with path traversal protection                                                           |
| Exec          | 4     | System execution (YOLO mode) — shell commands, file read/write, process management (off by default, admin-only)    |

### Advanced Capabilities

| Capability              | Description                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Multi-Provider LLM**  | Switch between Anthropic, Claude Code, OpenAI, Google, xAI, Groq, OpenRouter, Moonshot, Mistral, Cocoon, or Local — Dashboard validates API key before switching |
| **RAG + Hybrid Search** | Local ONNX embeddings (384d) or Voyage AI (512d/1024d) with FTS5 keyword + sqlite-vec cosine similarity, fused via RRF      |
| **Auto-Compaction**     | AI-summarized context management prevents overflow, preserves key information in `memory/*.md` files                        |
| **Observation Masking** | Compresses old tool results to one-line summaries, saving ~90% context window                                               |
| **Plugin SDK**          | Frozen namespaced SDK (`sdk.ton`, `sdk.telegram`, `sdk.secrets`, `sdk.storage`) with isolated databases and lifecycle hooks |
| **Smart DEX Router**    | `dex_quote` compares STON.fi vs DeDust in parallel, recommends the best rate                                                |
| **Vision Analysis**     | Image understanding via multimodal LLM (utility model)                                                                      |
| **Scheduled Tasks**     | Time-based task execution with DAG dependency resolution                                                                    |
| **Message Debouncing**  | Intelligent batching of rapid group messages (DMs are always instant)                                                       |
| **Daily Logs**          | Automatic session summaries preserved across resets                                                                         |
| **Multi-Policy Access** | Configurable DM/group policies (open, allowlist, admin-only, disabled) with per-group module permissions                    |
| **Tool RAG**            | Semantic tool selection (enabled by default) - sends only the top-K most relevant tools per message (hybrid vector + FTS5, configurable `top_k`, `always_include` patterns) |
| **MCP Client**          | Connect external MCP tool servers (stdio, SSE, or Streamable HTTP) - auto-discovery, namespaced tools, managed via CLI or WebUI |
| **System Execution**    | YOLO mode — 4 system tools (shell, file read/write, process list) with audit logging, configurable timeout, admin-only scope (off by default) |
| **Sandboxed Workspace** | Secure file system with recursive URL decoding, symlink detection, and immutable config files                               |

---

## Prerequisites

- **Node.js 20.0.0+** - [Download](https://nodejs.org/)
- **LLM API Key** - One of: [Anthropic](https://console.anthropic.com/) (recommended), [OpenAI](https://platform.openai.com/), [Google](https://aistudio.google.com/), [xAI](https://console.x.ai/), [Groq](https://console.groq.com/), [OpenRouter](https://openrouter.ai/), [Moonshot](https://platform.moonshot.ai/), [Mistral](https://console.mistral.ai/) — or keyless: Claude Code (auto-detect), Cocoon (TON), Local (Ollama/vLLM)
- **Telegram Account** - Dedicated account recommended for security
- **Telegram API Credentials** - From [my.telegram.org/apps](https://my.telegram.org/apps)
- **Your Telegram User ID** - Message [@userinfobot](https://t.me/userinfobot)
- **Bot Token** *(optional)* - From [@BotFather](https://t.me/BotFather) for inline bot features (deals)

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

### 2. Setup

```bash
teleton setup
```

The wizard will configure:
- LLM provider selection (11 providers: Anthropic, Claude Code, OpenAI, Google, xAI, Groq, OpenRouter, Moonshot, Mistral, Cocoon, Local)
- Telegram authentication (API credentials, phone, login code)
- Access policies (DM/group response rules)
- Admin user ID
- TON wallet generation (W5R1 with 24-word mnemonic)
- Workspace initialization (SOUL.md, STRATEGY.md, SECURITY.md, MEMORY.md)

Configuration files created:
- `~/.teleton/config.yaml` - Main configuration
- `~/.teleton/wallet.json` - TON wallet (backup mnemonic securely)
- `~/.teleton/memory.db` - SQLite database (WAL mode, sqlite-vec, FTS5)
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

> **Need more details?** See [GETTING_STARTED.md](GETTING_STARTED.md) for the full guide - admin commands, troubleshooting, workspace templates, plugins, and more.

---

## Configuration

The `teleton setup` wizard generates a fully configured `~/.teleton/config.yaml` file. Manual editing is only necessary if you want to adjust settings after the initial setup.

```yaml
agent:
  provider: "anthropic"              # anthropic | claude-code | openai | google | xai | groq | openrouter | moonshot | mistral | cocoon | local
  api_key: "sk-ant-api03-..."
  model: "claude-opus-4-6"
  utility_model: "claude-haiku-4-5-20251001"  # for summarization, compaction, vision
  max_agentic_iterations: 5

telegram:
  dm_policy: "admin-only"   # open | allowlist | admin-only | disabled
  group_policy: "open"      # open | allowlist | admin-only | disabled
  require_mention: true
  admin_ids: [123456789]
  owner_name: "Your Name"
  owner_username: "your_username"
  debounce_ms: 1500         # group message batching delay

  # Optional: inline bot for interactive features (deals)
  bot_token: "123456:ABC-DEF..."
  bot_username: "your_bot"

  session_reset_policy:
    daily_reset_enabled: true
    daily_reset_hour: 4
    idle_expiry_minutes: 1440  # 24h idle → new session

webui:                       # Optional: Web dashboard
  enabled: false             # Enable WebUI server
  port: 7777                 # HTTP server port
  host: "127.0.0.1"          # Localhost only (security)
  # auth_token: "..."        # Auto-generated if omitted

# capabilities:                # System execution (YOLO mode, off by default)
#   exec:
#     mode: "off"              # off | yolo
#     scope: "admin-only"      # admin-only | allowlist | all
```

### Supported Models

All models are defined in `src/config/model-catalog.ts` and shared across the CLI setup, WebUI setup wizard, and Dashboard. To add a model, add it there — it will appear everywhere automatically.

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude Opus 4.6, Claude Opus 4.5, Claude Sonnet 4.6, Claude Haiku 4.5 |
| **Claude Code** | Same as Anthropic (auto-detected credentials) |
| **OpenAI** | GPT-5, GPT-5 Pro, GPT-5 Mini, GPT-5.1, GPT-4o, GPT-4.1, GPT-4.1 Mini, o4 Mini, o3, Codex Mini |
| **Google** | Gemini 3 Pro (preview), Gemini 3 Flash (preview), Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash Lite, Gemini 2.0 Flash |
| **xAI** | Grok 4.1 Fast, Grok 4 Fast, Grok 4, Grok Code, Grok 3 |
| **Groq** | Llama 4 Maverick, Qwen3 32B, DeepSeek R1 70B, Llama 3.3 70B |
| **OpenRouter** | Claude Opus/Sonnet, GPT-5, Gemini, DeepSeek R1/V3, Qwen3 Coder/Max/235B, Nemotron, Sonar Pro, MiniMax, Grok 4 |
| **Moonshot** | Kimi K2.5, Kimi K2 Thinking |
| **Mistral** | Devstral Small/Medium, Mistral Large, Magistral Small |
| **Cocoon** | Qwen/Qwen3-32B (decentralized, pays in TON) |
| **Local** | Auto-detected (Ollama, vLLM, LM Studio) |

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

### Web Search & Fetch

The agent has two built-in web tools powered by [Tavily](https://tavily.com/) (free tier available):

| Tool | Description |
|------|-------------|
| `web_search` | Search the web - returns titles, URLs, content snippets, relevance scores. Supports `topic`: general, news, finance |
| `web_fetch` | Extract readable text from a URL - articles, docs, links shared by users |

Both tools require a Tavily API key. Set it via CLI or config:

```bash
teleton config set tavily_api_key
```

Or in `config.yaml`:
```yaml
tavily_api_key: "tvly-..."
```

Once configured, the agent can autonomously search the web and read pages when needed to answer questions or verify information.

### Managing Config Keys

Use `teleton config` to manage optional keys without editing YAML manually:

```bash
# List all configurable keys and their status
teleton config list

# Set a key (prompts interactively if value omitted)
teleton config set tavily_api_key
teleton config set tonapi_key AFTWPHSLN3...

# View a key (sensitive values are masked)
teleton config get tavily_api_key

# Remove a key
teleton config unset tavily_api_key
```

Configurable keys: `tavily_api_key`, `tonapi_key`, `telegram.bot_token`, `telegram.bot_username`.

### Environment Variables

All environment variables override the corresponding `config.yaml` value at startup - useful for Docker and CI:

| Variable | Description | Default |
|----------|-------------|---------|
| `TELETON_HOME` | Data directory (config, DB, session) | `~/.teleton` |
| `TELETON_API_KEY` | LLM API key (overrides config) | - |
| `TELETON_TG_API_ID` | Telegram API ID (overrides config) | - |
| `TELETON_TG_API_HASH` | Telegram API Hash (overrides config) | - |
| `TELETON_TG_PHONE` | Phone number (overrides config) | - |
| `TELETON_TAVILY_API_KEY` | Tavily API key for web search | - |
| `TELETON_TONAPI_KEY` | TonAPI key for higher rate limits | - |
| `TELETON_WEBUI_ENABLED` | Enable WebUI (overrides config) | `false` |
| `TELETON_WEBUI_PORT` | WebUI port (overrides config) | `7777` |

---

## WebUI Dashboard

Teleton includes an **optional web dashboard** for monitoring and configuration. The WebUI is disabled by default and runs only on localhost for security.

### Features

- **Dashboard**: System status, uptime, model info, session count, memory stats, live token usage tracking, provider switching with API key validation
- **Tools Management**: View all tools grouped by module, toggle enable/disable, change scope per tool
- **Plugin Marketplace**: Install, update, and manage plugins from registry with secrets management
- **Soul Editor**: Edit SOUL.md, SECURITY.md, STRATEGY.md, MEMORY.md with unsaved changes warning
- **Memory Search**: Search knowledge base with hybrid vector+keyword search
- **Live Logs**: Real-time log streaming via Server-Sent Events
- **Workspace**: File browser with inline text editor
- **MCP Servers**: Add/remove external tool servers, manage API keys (env vars), view connection status
- **Tasks**: Scheduled task management with status, dependencies, and bulk actions

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
3. Token is stored as HttpOnly cookie (7 days) for subsequent visits

### Security

- **Localhost only**: Server binds to `127.0.0.1` by default (not accessible from network)
- **Bearer token auth**: All API routes require authentication (timing-safe comparison)
- **HttpOnly cookies**: SameSite=Strict, prevents XSS token theft
- **No persistence**: Runtime changes (like model switches via WebUI) are not saved to config.yaml
- **For remote access**: Use SSH tunneling or reverse proxy (nginx/caddy) with HTTPS

**SSH tunnel example:**
```bash
ssh -L 7777:localhost:7777 user@remote-server
# Then access http://localhost:7777 on your local machine
```

### Workspace Files

The agent's personality and rules are configured via markdown files in `~/.teleton/workspace/`. Default templates are generated during `teleton setup` - you can edit any of them to customize your agent:

| File | Purpose | Mutable by Agent |
|------|---------|-----------------|
| `SOUL.md` | Personality, tone, behavior guidelines | No |
| `STRATEGY.md` | Trading rules, buy/sell thresholds | No |
| `SECURITY.md` | Security principles, threat recognition | No |
| `MEMORY.md` | Persistent memory (facts, contacts, decisions) | Yes |
| `memory/*.md` | Session summaries, daily logs (auto-generated) | Yes |

> **Tip**: Templates are located in `src/templates/` if installing from source. Edit the workspace copies in `~/.teleton/workspace/` - not the source templates.

### Admin Commands

All admin commands support `/`, `!`, or `.` prefix:

| Command | Description |
|---------|-------------|
| `/status` | Uptime, model, sessions, wallet, policies |
| `/model <name>` | Hot-swap LLM model at runtime |
| `/policy <dm\|group> <value>` | Change access policies live |
| `/loop <1-50>` | Set max agentic iterations |
| `/strategy [buy\|sell <pct>]` | View/change trading thresholds |
| `/wallet` | Show wallet address + balance |
| `/modules set\|info\|reset` | Per-group tool permissions |
| `/plugin set\|unset\|keys` | Manage plugin secrets |
| `/task <description>` | Assign a task to the agent |
| `/boot` | Run bootstrap template |
| `/pause` / `/resume` | Pause/resume agent |
| `/clear [chat_id]` | Clear conversation history |
| `/verbose` | Toggle debug logging |
| `/rag [status\|topk <n>]` | Toggle Tool RAG or view status |
| `/stop` | Emergency shutdown |
| `/ping` | Check responsiveness |
| `/help` | Show all commands |

---

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| LLM | Multi-provider via [pi-ai](https://github.com/mariozechner/pi-ai) (11 providers: Anthropic, Claude Code, OpenAI, Google, xAI, Groq, OpenRouter, Moonshot, Mistral, Cocoon, Local) |
| Telegram Userbot | [GramJS](https://gram.js.org/) Layer 222 fork (MTProto) |
| Inline Bot | [Grammy](https://grammy.dev/) (Bot API, for deals) |
| Blockchain | [TON SDK](https://github.com/ton-org/ton) (W5R1 wallet) |
| DeFi | STON.fi SDK, DeDust SDK |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) with WAL mode |
| Vector Search | [sqlite-vec](https://github.com/asg017/sqlite-vec) (cosine similarity) |
| Full-Text Search | SQLite FTS5 (BM25 ranking) |
| Embeddings | [@huggingface/transformers](https://www.npmjs.com/package/@huggingface/transformers) (local ONNX) or Voyage AI |
| Token Counting | [js-tiktoken](https://github.com/dqbd/tiktoken) |
| MCP Client | [@modelcontextprotocol/sdk](https://modelcontextprotocol.io/) (stdio + SSE + Streamable HTTP) |
| WebUI | [Hono](https://hono.dev/) (API) + React + Vite (frontend) |
| Language | TypeScript 5.7, Node.js 20+ |

### Project Structure

```
src/
├── index.ts                # Entry point, TeletonApp lifecycle, graceful shutdown
├── agent/                  # Core agent runtime
│   ├── runtime.ts          # Agentic loop (5 iterations, tool calling, masking, compaction)
│   ├── client.ts           # Multi-provider LLM client
│   └── tools/              # 125+ built-in tools
│       ├── register-all.ts # Central tool registration (8 categories, 121 tools)
│       ├── registry.ts     # Tool registry, scope filtering, provider limits
│       ├── module-loader.ts    # Built-in module loading (deals + exec)
│       ├── plugin-loader.ts    # External plugin discovery, validation, hot-reload
│       ├── mcp-loader.ts       # MCP client (stdio/SSE), tool discovery, lifecycle
│       ├── telegram/       # Telegram operations (77 tools)
│       ├── ton/            # TON blockchain + jettons + DEX router (15 tools)
│       ├── stonfi/         # STON.fi DEX (5 tools)
│       ├── dedust/         # DeDust DEX (5 tools)
│       ├── dns/            # TON DNS (8 tools)
│       ├── exec/           # System execution — YOLO mode (4 tools)
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
│   ├── bridge.ts           # GramJS wrapper (peer cache, message parsing, keyboards)
│   ├── handlers.ts         # Message routing, rate limiting, ChatQueue, feed storage
│   ├── admin.ts            # 17 admin commands
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
├── sdk/                    # Plugin SDK (v1.0.0)
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
│   ├── providers.ts        # Multi-provider LLM registry (11 providers)
│   └── model-catalog.ts    # Shared model catalog (60+ models across all providers)
├── webui/                  # Optional web dashboard
│   ├── server.ts           # Hono server, auth middleware, static serving
│   └── routes/             # 11 API route groups (status, tools, logs, memory, soul, plugins, mcp, tasks, workspace, config, marketplace)
├── constants/              # Centralized limits, timeouts, API endpoints
├── utils/                  # Logger, sanitize, retry, fetch
├── workspace/              # Path validator (anti-traversal, anti-symlink)
├── templates/              # Workspace template files (SOUL.md, etc.)
└── cli/                    # CLI commands (setup, config, doctor, mcp)

web/                        # React + Vite frontend (10 pages)
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
| **Payment security** | `INSERT OR IGNORE` on tx hashes prevents double-spend, atomic status transitions prevent race conditions |
| **Exec audit** | All YOLO mode commands logged to `exec_audit` table with user, command, output, and timestamps |
| **Pino redaction** | Structured logging with automatic redaction of apiKey, password, secret, token, mnemonic fields |
| **Tool scoping** | Financial tools DM-only, moderation group-only, admin-only policies, per-chat permissions configurable at runtime |

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

### Plugins

Plugins extend the agent with custom tools. Drop a `.js` file or folder in `~/.teleton/plugins/` - loaded at startup, hot-reloaded in dev mode, no rebuild needed. See [official example plugins](https://github.com/TONresistor/teleton-plugins) for complete working examples.

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
  sdkVersion: "^1.0.0",
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
| | **Analytics**: `getJettonPrice()`, `getJettonHolders()`, `getJettonHistory()` |
| | **NFT**: `getNftItems()`, `getNftInfo()` |
| | **DEX** (`sdk.ton.dex`): `quote()`, `swap()`, `quoteSTONfi()`, `quoteDeDust()`, `swapSTONfi()`, `swapDeDust()` |
| | **DNS** (`sdk.ton.dns`): `check()`, `resolve()`, `getAuctions()`, `startAuction()`, `bid()`, `link()`, `unlink()`, `setSiteRecord()` |
| | **Utils**: `toNano()`, `fromNano()`, `validateAddress()` |
| `sdk.telegram` | **Messages**: `sendMessage()`, `editMessage()`, `deleteMessage()`, `forwardMessage()`, `pinMessage()`, `searchMessages()`, `scheduleMessage()`, `getScheduledMessages()`, `deleteScheduledMessage()`, `sendScheduledNow()`, `getReplies()` |
| | **Media**: `sendPhoto()`, `sendVideo()`, `sendVoice()`, `sendFile()`, `sendGif()`, `sendSticker()`, `downloadMedia()` |
| | **Chat & Users**: `getChatInfo()`, `getUserInfo()`, `resolveUsername()`, `getParticipants()`, `getDialogs()`, `getHistory()` |
| | **Interactive**: `sendDice()`, `sendReaction()`, `createPoll()`, `createQuiz()` |
| | **Moderation**: `banUser()`, `unbanUser()`, `muteUser()`, `kickUser()` |
| | **Stars & Gifts**: `getStarsBalance()`, `sendGift()`, `getAvailableGifts()`, `getMyGifts()`, `getResaleGifts()`, `buyResaleGift()`, `getStarsTransactions()`, `transferCollectible()`, `setCollectiblePrice()`, `getCollectibleInfo()`, `getUniqueGift()`, `getUniqueGiftValue()`, `sendGiftOffer()` |
| | **Advanced**: `getMe()`, `isAvailable()`, `getRawClient()`, `setTyping()`, `sendStory()` |
| `sdk.secrets` | `get()`, `require()`, `has()` - 3-tier resolution (env var → secrets file → plugin config) |
| `sdk.storage` | `get()`, `set()`, `delete()`, `has()`, `clear()` - KV store with TTL support |
| `sdk.db` | Raw `better-sqlite3` database - isolated per plugin at `~/.teleton/plugins/data/<name>.db` |
| `sdk.config` | Sanitized app config (no API keys exposed) |
| `sdk.pluginConfig` | Plugin-specific config from `config.yaml` `plugins:` section |
| `sdk.log` | `info()`, `warn()`, `error()`, `debug()` - Prefixed logger |

**Lifecycle hooks**: `migrate(db)`, `start(ctx)`, `stop()`, `onMessage(event)`, `onCallbackQuery(event)`

**Security**: all SDK objects are `Object.freeze()`-ed. Plugins never see API keys or other plugins' data.

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
✅ 115 tools loaded (1 from plugins)
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

---

## Support

- **Issues**: [GitHub Issues](https://github.com/TONresistor/teleton-agent/issues)
- **Channel**: [@teletonagents](https://t.me/teletonagents)
- **Group Chat**: [@teletonagentHQ](https://t.me/teletonagentHQ)
- **Contact**: [@zkproof](https://t.me/zkproof)
