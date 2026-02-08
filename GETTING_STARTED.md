# Getting Started with Teleton

Complete guide to installing, configuring, and running your Teleton AI agent.

---

## Prerequisites

| Requirement | Details |
|-------------|---------|
| **Node.js 20+** | [Download](https://nodejs.org/) - check with `node --version` |
| **LLM API Key** | [Anthropic](https://console.anthropic.com/) (recommended), [OpenAI](https://platform.openai.com/), [Google](https://aistudio.google.com/), [xAI](https://console.x.ai/), [Groq](https://console.groq.com/), or [OpenRouter](https://openrouter.ai/) |
| **Telegram Account** | Dedicated account recommended (agent has full control) |
| **Telegram API Credentials** | `api_id` + `api_hash` from [my.telegram.org/apps](https://my.telegram.org/apps) |
| **Telegram User ID** | Message [@userinfobot](https://t.me/userinfobot) to get yours |
| **Bot Token** *(optional)* | From [@BotFather](https://t.me/BotFather) - required for the deals system |
| **TonAPI Key** *(optional)* | From [@AntTonTechBot](https://t.me/AntTonTechBot) mini app - higher rate limits |

---

## Installation

**npm (recommended):**
```bash
npm install -g teleton
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

1. **LLM Provider** - Choose between 6 providers (Anthropic, OpenAI, Google, xAI, Groq, OpenRouter)
2. **Telegram Auth** - API credentials, phone number, login code, 2FA password
3. **Access Policies** - DM policy (open/allowlist/pairing/disabled), group policy, mention rules
4. **Admin** - Your Telegram User ID, owner name/username
5. **TON Wallet** - Generates a W5R1 wallet with 24-word mnemonic
6. **Deals** *(optional)* - Bot token for the deals system, trading thresholds
7. **Workspace** - Creates template files (SOUL.md, IDENTITY.md, STRATEGY.md, etc.)

**Files created:**
```
~/.teleton/
├── config.yaml            # Main configuration
├── wallet.json            # TON wallet (chmod 600 - backup mnemonic!)
├── memory.db              # SQLite database
├── gifts.db               # Gift market price cache
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
✅ Gifts Market: 107 collections, 6000+ models
✅ Telegram: @your_agent connected
✅ TON Blockchain: connected
✅ Agent is ready! (121 tools)
```

**Verify:** Send `/ping` to your agent on Telegram.

---

## Configuration

Configuration is in `~/.teleton/config.yaml`. The setup wizard generates everything, only edit manually to change settings.

### Key Settings

```yaml
agent:
  provider: "anthropic"              # anthropic | openai | google | xai | groq | openrouter
  model: "claude-sonnet-4-5-20250929"
  max_tokens: 4096
  temperature: 0.7

telegram:
  dm_policy: "open"        # open | allowlist | pairing | disabled
  group_policy: "open"     # open | allowlist | disabled
  require_mention: true    # Require @mention in groups
  admin_ids: [123456789]   # Your Telegram User ID
  debounce_ms: 1500        # Group message batching delay

deals:
  enabled: true
  buy_max_floor_percent: 100   # Buy at or below floor price
  sell_min_floor_percent: 105  # Sell at floor + 5% minimum

market:
  enabled: true
  cache_ttl_minutes: 15
  refresh_interval_minutes: 120
```

### Switching LLM Provider

Change `provider` and `api_key` in config.yaml:
```yaml
agent:
  provider: "openai"
  api_key: "sk-..."
  model: "gpt-4o"
```

Supported: `anthropic`, `openai`, `google`, `xai`, `groq`, `openrouter`

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
| `/strategy` | View or change trading thresholds |
| `/strategy buy 95` | Set buy threshold to 95% of floor |
| `/strategy sell 110` | Set sell threshold to 110% of floor |
| `/wallet` | Show wallet address and balance |
| `/policy dm open` | Change DM policy at runtime |
| `/pause` / `/resume` | Pause/resume agent responses |
| `/loop <iterations>` | Set max agentic iterations |
| `/stop` | Emergency shutdown |
| `/help` | List all commands |

---

## Tool Categories

Teleton has **121 tools** across these categories:

| Category | Count | Highlights |
|----------|-------|------------|
| **Telegram** | 59 | Messaging, media, groups, polls, stickers, gifts, stories, contacts, profile |
| **TON Blockchain** | 17 | W5R1 wallet, send/receive TON, transactions, price |
| **Jettons** | 11 | Balances, swap (STON.fi), prices, holders, trending |
| **DeFi** | 5 | STON.fi + DeDust DEX, smart routing for best rates |
| **Deals** | 5 | Secure gift/TON trading with inline bot confirmations |
| **TON DNS** | 7 | Domain check, auctions, bidding, resolution |
| **Gift Market** | 4 | Floor prices, search, cheapest, price history |
| **Journal** | 3 | Log trades/operations with reasoning and P&L |
| **Memory** | 2 | Read/write persistent memory (RAG-indexed) |
| **Workspace** | 6 | Sandboxed file operations |
| **Casino** | 8 | Slot machine, dice, leaderboard, jackpot |

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

## Deals System

The deals system enables secure gift/TON trading with strategy enforcement.

**Requirements:** Bot token configured, deals enabled in config.

**How it works:**
1. Agent proposes a deal (buy/sell gift)
2. Strategy rules are enforced automatically (buy below floor, sell above floor +5%)
3. Inline bot shows deal card with Accept/Decline buttons
4. User sends TON first, agent verifies on-chain
5. Gift is transferred after payment verification

**Customize thresholds:**
```
/strategy buy 90    # Only buy at 90% of floor or less
/strategy sell 115  # Only sell at 115% of floor or more
```

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

### Gift Prices Null
- Check if Playwright is installed: `npx playwright install chromium`
- Scraper runs every 2 hours - use `/task refresh market data` to trigger manually
- Database location: `~/.teleton/gifts.db`

### Health Check
```bash
teleton doctor
```
Verifies config, Telegram session, wallet, database, and Playwright.

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
✅ 122 tools loaded (1 from plugins)
```

Plugins receive the same `context` as built-in tools: `bridge`, `db`, `chatId`, `senderId`, `config`.

### Adding Tools (from source)

For contributors, create a TypeScript tool in `src/agent/tools/` and register it in `src/agent/tools/register-all.ts`.

### Project Structure

```
src/
├── agent/          # LLM runtime, tool registry, tool implementations
├── telegram/       # GramJS bridge, message handlers, admin commands, debouncing
├── memory/         # SQLite database, RAG search, knowledge indexing
├── ton/            # Wallet operations, TON blockchain
├── market/         # Gift price scraper (Playwright) and cache service
├── deals/          # Deal proposals, strategy checker, config
├── casino/         # Payment verification, slot machine, dice, jackpot
├── bot/            # GramJS MTProto bot for styled inline buttons
├── session/        # Session management, transcripts, compaction
├── config/         # Zod schema, YAML loader, provider registry
├── workspace/      # Sandboxed file system with security validation
├── cli/            # Setup wizard, doctor, start command
├── constants/      # Centralized limits, timeouts, API endpoints
├── templates/      # Workspace template files (SOUL.md, etc.)
└── index.ts        # Main application entry point
```

---

## Support

- **GitHub Issues**: [github.com/TONresistor/teleton-agent/issues](https://github.com/TONresistor/teleton-agent/issues)
- **Group Chat**: [@ResistanceForum](https://t.me/ResistanceForum)

---

## License

MIT - See [LICENSE](LICENSE) for details.
