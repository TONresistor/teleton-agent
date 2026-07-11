# Getting Started with Teleton

Complete guide to installing, configuring, and running your Teleton AI agent.

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **Node.js 22.22.2+ LTS** | [Download](https://nodejs.org/) - Node 24 requires 24.15.0+; check with `node --version` |
| **LLM API Key** | [Anthropic](https://console.anthropic.com/) (recommended), [OpenAI](https://platform.openai.com/), [Google](https://aistudio.google.com/), [xAI](https://console.x.ai/), [Groq](https://console.groq.com/), [OpenRouter](https://openrouter.ai/), or any of 16 supported providers |
| **Telegram Account** | Dedicated account recommended (agent has full control) |
| **Telegram API Credentials** | `api_id` + `api_hash` from [my.telegram.org/apps](https://my.telegram.org/apps) |
| **Telegram User ID** | Message [@userinfobot](https://t.me/userinfobot) to get yours |
| **Bot Token** *(optional in user mode)* | From [@BotFather](https://t.me/BotFather) for plugin inline cards and callbacks; required in bot mode |
| **TonAPI Key** *(optional)* | From [@AntTonTechBot](https://t.me/AntTonTechBot) mini app - higher rate limits |

---

## Installation

**npm (recommended):**
```bash
npm install -g teleton@latest
```

**One-liner:**
```bash
curl -fsSL https://raw.githubusercontent.com/TONresistor/teleton-agent/main/install.sh | bash
```

**Docker:**
```bash
docker run -it -v ~/.teleton:/data ghcr.io/tonresistor/teleton:latest setup
```

**From source:**
```bash
git clone https://github.com/TONresistor/teleton-agent.git
cd teleton-agent
npm install && npm run build
```

---

## Setup

```bash
teleton setup
```

The interactive wizard configures everything:

1. **LLM Provider** - Choose between 16 providers (Anthropic, Codex, Grok Build, OpenAI, Google, xAI, Groq, OpenRouter, Moonshot, Mistral, Cerebras, ZAI, MiniMax, Hugging Face, and more)
2. **Telegram Auth** - API credentials, phone number, login code, 2FA password
3. **Access Policies** - DM policy (open/allowlist/pairing/disabled), group policy, mention rules
4. **Admin** - Your Telegram User ID, owner name/username
5. **TON Wallet** - Generates a W5R1 wallet with 24-word mnemonic
6. **Optional Integrations** - Bot token, TonAPI, Toncenter, and Tavily credentials
7. **Workspace** - Creates template files (SOUL.md, IDENTITY.md, STRATEGY.md, etc.)

**Files created:**
```
~/.teleton/
├── config.yaml            # Main configuration
├── wallet.json            # TON wallet (chmod 600 - backup mnemonic!)
├── memory.db              # SQLite database
├── telegram_session.txt   # Telegram session
├── plugins/               # Custom plugins (auto-loaded at startup)
└── workspace/             # Sandboxed agent workspace
    ├── SOUL.md            # Personality and behavior
    ├── IDENTITY.md        # Agent identity
    ├── BOOTSTRAP.md       # First-run instructions
    ├── MEMORY.md          # Persistent memory (RAG-indexed)
    ├── STRATEGY.md        # Trading rules and thresholds
    ├── USER.md            # User information
    ├── SECURITY.md        # Security rules
    ├── memory/            # Daily logs
    ├── downloads/         # Downloaded files
    ├── uploads/           # Uploaded files
    └── temp/              # Temporary files
```

---

## Start

```bash
teleton start
```

You should see:
```
🤖 Starting Teleton AI Agent...
✅ Config loaded from ~/.teleton/config.yaml
✅ SOUL.md loaded
✅ Knowledge indexed
✅ Telegram: @your_agent connected
✅ TON Blockchain: connected
✅ Agent is ready! (128 base tools)
```

**Verify:** Send `/ping` to your agent on Telegram.

---

## Configuration

Configuration is in `~/.teleton/config.yaml`. The setup wizard generates everything, only edit manually to change settings.

### Key Settings

```yaml
agent:
  provider: "anthropic"              # anthropic | codex | grok-build | openai | google | xai | groq | openrouter | moonshot | mistral | cerebras | zai | minimax | huggingface | gocoon | local
  model: "claude-opus-4-5-20251101"
  max_tokens: 4096
  temperature: 0.7

telegram:
  dm_policy: "open"        # open | allowlist | pairing | disabled
  group_policy: "open"     # open | allowlist | disabled
  require_mention: true    # Require @mention in groups
  admin_ids: [123456789]   # Your Telegram User ID
  debounce_ms: 1500        # Group message batching delay

```

### Switching LLM Provider

Change `provider` and `api_key` in config.yaml:
```yaml
agent:
  provider: "openai"
  api_key: "sk-..."
  model: "gpt-4o"
```

Supported: `anthropic`, `codex`, `grok-build`, `openai`, `google`, `xai`, `groq`, `openrouter`, `moonshot`, `mistral`, `cerebras`, `zai`, `minimax`, `huggingface`, `gocoon`, `local`

---

## Admin Commands

Admin commands are only available to users listed in `admin_ids`. All commands work with `/`, `!`, or `.` prefix.

| Command | Description |
|---------|-------------|
| `/ping` | Check if agent is alive |
| `/status` | Uptime, model, tool count, memory stats |
| `/task <description>` | Give agent a task to execute |
| `/clear` | Clear current chat history |
| `/clear <chat_id>` | Clear specific chat history |
| `/model <name>` | Switch LLM model at runtime |
| `/wallet` | Show wallet address and balance |
| `/approve <request_id>` / `/reject <request_id>` | Resolve a pending financial action |
| `/policy dm open` | Change DM policy at runtime |
| `/modules set\|info\|reset` | Manage per-group tool permissions |
| `/plugin set\|unset\|keys` | Manage plugin secrets |
| `/pause` / `/resume` | Pause/resume agent responses |
| `/loop <iterations>` | Set max agentic iterations |
| `/verbose` | Toggle debug logging |
| `/rag [status\|topk <n>]` | Toggle Tool RAG or view status |
| `/guest [on\|off]` | View or toggle bot guest mode |
| `/stop` | Emergency shutdown |
| `/help` | List all commands |

---

## Tool Categories

Teleton has **128 always-registered tools**, plus 5 optional system tools:

| Category | Count | Highlights |
|----------|-------|------------|
| **Telegram** | 83 | Messaging, media, chats, groups, polls, stickers, gifts, stars, stories, contacts, folders, profile, memory, tasks |
| **TON & Jettons** | 15 | W5R1 wallet, send/receive TON & jettons, balances, prices, holders, history, charts, NFTs, DEX quotes |
| **STON.fi DEX** | 5 | Swap, quote, search, trending tokens, liquidity pools |
| **DeDust DEX** | 5 | Swap, quote, pools, prices, token info |
| **TON DNS** | 8 | Domain check, auctions, bidding, resolution, TON Sites |
| **Journal** | 3 | Log trades/operations with reasoning and P&L |
| **Workspace** | 6 | Sandboxed file operations |
| **Web** | 2 | Search and page extraction |
| **Tool Search** | 1 | Semantic retrieval across the registry |
| **System** *(optional)* | 5 | Exec (4) and TON Proxy status (1) |

---

## TON Wallet

During setup, a **W5R1 wallet** is generated with a 24-word mnemonic stored in `~/.teleton/wallet.json`.

**CRITICAL: Backup your mnemonic immediately.** It's the only way to recover your wallet.

### Fund Your Wallet

1. Ask the agent: *"What's my wallet address?"*
2. Send TON from an exchange or another wallet
3. Minimum ~0.5 TON for gas fees, 10+ TON recommended for trading

### Import Existing Wallet

During setup, you can import a wallet instead of generating a new one.

---

## Memory & RAG

The agent uses a hybrid search system for context-aware responses:

- **MEMORY.md** - Persistent memory the agent writes to (RAG-indexed)
- **Daily Logs** - Auto-generated session summaries in `workspace/memory/`
- **Telegram Feed** - Past messages across all chats
- **Knowledge Base** - All `.md` files in workspace

**Auto-Compaction:** When context approaches the provider's limit, the agent summarizes the conversation, archives the transcript, and continues with a fresh context. Nothing is lost.

---

## Security

### Wallet
- Mnemonic stored locally in `~/.teleton/wallet.json` (chmod 600)
- Use a dedicated wallet with limited funds
- The agent can send transactions - only fund what you're willing to risk

### Workspace Sandbox
- All file operations restricted to `~/.teleton/workspace/`
- Path traversal, URL encoding, null byte, and unicode attacks are blocked
- Protected files (config.yaml, wallet.json) are inaccessible to the agent

### Access Control
- Admin commands require your User ID in `admin_ids`
- DM/group policies control who can interact
- Non-admins cannot clear history, view status, or execute tasks

### Best Practices
- Use a dedicated Telegram account (not your main)
- Enable 2FA on the Telegram account
- Start with restrictive policies, open gradually
- Monitor the journal and daily logs

---

## Troubleshooting

### Telegram Login Fails
- Use international phone format: `+1234567890`
- If 2FA is enabled, enter the password when prompted
- Session expired: `rm ~/.teleton/telegram_session.txt` then `teleton setup`
- API credentials: `api_id` is a number, `api_hash` is a string

### Agent Not Responding
- Check `dm_policy` / `group_policy` in config
- In groups with `require_mention: true`, you must @mention the agent
- Verify your User ID is in `admin_ids`
- Check if agent is paused (`/resume`)

### API Errors
- **401**: Invalid API key - check provider and key format
- **429**: Rate limited - wait and retry, or switch to a different model
- **Context overflow**: Reduce `max_tokens` or `max_agentic_iterations`

### Health Check
```bash
teleton doctor
```
Verifies config, Telegram session, wallet, and database.

---

## Development

### From Source

```bash
git clone https://github.com/TONresistor/teleton-agent.git
cd teleton-agent
npm install
npm run build
npm run dev    # Watch mode with auto-restart
```

### Plugins

Add custom tools without touching the source code. Drop a `.js` file in `~/.teleton/plugins/`:

```js
// ~/.teleton/plugins/hello.js
export const tools = [
  {
    name: "hello_world",
    description: "Say hello to someone",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name to greet" }
      },
      required: ["name"]
    },
    execute: async (params, context) => {
      return { success: true, data: { message: `Hello, ${params.name}!` } };
    }
  }
];
```

Restart the agent — the plugin is auto-loaded:
```
🔌 Plugin "hello.js": 1 tool registered
✅ Tool registry loaded (including 1 plugin tool)
```

Plugins receive a full SDK with 108 methods across 9 namespaces: `sdk.ton`, `sdk.telegram`, `sdk.bot`, `sdk.secrets`, `sdk.storage`, `sdk.log`, and more. This includes TON wallet operations like `createTransfer`, `createJettonTransfer`, `getPublicKey`, and `getWalletVersion` for signing transactions without broadcasting.

### Adding Tools (from source)

For contributors, create a TypeScript tool in `src/agent/tools/` and register it in `src/agent/tools/register-all.ts`.

### Project Structure

```
src/
├── index.ts        # Main application entry point (TeletonApp)
├── agent/          # LLM runtime and tool registry
│   └── tools/      # telegram/, ton/, stonfi/, dedust/, dns/, journal/, workspace/
├── telegram/       # GramJS bridge, message handlers, admin commands, debouncing
├── memory/         # SQLite database, RAG search (FTS5 + vector), compaction
├── ton/            # Wallet operations, payment verification, TON blockchain
├── bot/            # Plugin inline-query and callback routing
├── sdk/            # Plugin SDK (v1.0.0) — TON, Telegram services for plugins
├── ton-proxy/      # TON Proxy module (Tonutils-Proxy integration)
├── session/        # Session persistence, transcripts
├── soul/           # System prompt assembly (SOUL + STRATEGY + SECURITY)
├── config/         # Zod schema, YAML loader, provider registry
├── constants/      # Centralized limits, timeouts, API endpoints
├── services/       # Shared services (TTS voice synthesis)
├── utils/          # Logger, sanitization, retry, fetch
├── workspace/      # Sandboxed file system with security validation
├── templates/      # Workspace template files (SOUL.md, IDENTITY.md, etc.)
└── cli/            # Setup wizard, doctor command
```

---

## Support

- **GitHub Issues**: [github.com/TONresistor/teleton-agent/issues](https://github.com/TONresistor/teleton-agent/issues)
- **Group Chat**: [@ResistanceForum](https://t.me/ResistanceForum)

---

## License

MIT - See [LICENSE](LICENSE) for details.
