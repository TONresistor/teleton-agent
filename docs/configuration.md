# Configuration Reference

Teleton Agent is configured through a single YAML file located at `~/.teleton/config.yaml`. This document describes every configuration option, its type, default value, and behavior.

Run `teleton setup` to generate a config file interactively, or copy `config.example.yaml` from the repository and edit it manually.

---

## Table of Contents

- [agent](#agent)
- [telegram](#telegram)
- [embedding](#embedding)
- [deals](#deals)
- [webui](#webui)
- [storage](#storage)
- [dev](#dev)
- [plugins](#plugins)
- [tonapi_key](#tonapi_key)
- [meta](#meta)
- [Environment Variable Overrides](#environment-variable-overrides)

---

## agent

LLM provider and agentic loop configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `agent.provider` | `enum` | `"anthropic"` | LLM provider. One of: `anthropic`, `openai`, `google`, `xai`, `groq`, `openrouter`. |
| `agent.api_key` | `string` | **(required)** | API key for the chosen provider. Can be overridden with `TELETON_API_KEY` env var. |
| `agent.model` | `string` | `"claude-opus-4-5-20251101"` | Primary model ID. Auto-detected from provider if not set (only for non-Anthropic providers). |
| `agent.utility_model` | `string` | *auto-detected* | Cheap/fast model used for summarization and compaction. If omitted, the platform selects one based on the provider (e.g., `claude-3-5-haiku-20241022` for Anthropic, `gpt-4o-mini` for OpenAI). |
| `agent.max_tokens` | `number` | `4096` | Maximum tokens in each LLM response. |
| `agent.temperature` | `number` | `0.7` | Sampling temperature (0.0 = deterministic, 1.0 = creative). |
| `agent.system_prompt` | `string \| null` | `null` | Additional system prompt text appended to the default SOUL.md personality. Set to `null` to use only the built-in soul. |
| `agent.max_agentic_iterations` | `number` | `5` | Maximum number of agentic loop iterations per message. Each iteration is one tool-call-then-result cycle. Higher values allow more complex multi-step reasoning but increase cost and latency. |

### agent.session_reset_policy

Controls when conversation sessions are cleared, giving the agent a fresh memory context.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `agent.session_reset_policy.daily_reset_enabled` | `boolean` | `true` | Enable automatic daily session reset. |
| `agent.session_reset_policy.daily_reset_hour` | `number` | `4` | Hour of day (0-23, server timezone) to reset all sessions. |
| `agent.session_reset_policy.idle_expiry_enabled` | `boolean` | `true` | Enable session reset after a period of inactivity. |
| `agent.session_reset_policy.idle_expiry_minutes` | `number` | `1440` | Minutes of inactivity before a session resets. Default is 24 hours (1440 minutes). |

### Example

```yaml
agent:
  provider: "anthropic"
  api_key: "sk-ant-..."
  model: "claude-opus-4-5-20251101"
  utility_model: "claude-3-5-haiku-20241022"
  max_tokens: 4096
  temperature: 0.7
  max_agentic_iterations: 5
  session_reset_policy:
    daily_reset_enabled: true
    daily_reset_hour: 4
    idle_expiry_enabled: true
    idle_expiry_minutes: 1440
```

### Provider-Specific Default Models

When you change the `provider` and omit `model`, the platform auto-selects:

| Provider | Default Model | Default Utility Model |
|----------|--------------|----------------------|
| `anthropic` | `claude-opus-4-5-20251101` | `claude-3-5-haiku-20241022` |
| `openai` | `gpt-4o` | `gpt-4o-mini` |
| `google` | `gemini-2.5-flash` | `gemini-2.0-flash-lite` |
| `xai` | `grok-3` | `grok-3-mini-fast` |
| `groq` | `llama-3.3-70b-versatile` | `llama-3.1-8b-instant` |
| `openrouter` | `anthropic/claude-opus-4.5` | `google/gemini-2.5-flash-lite` |

---

## telegram

Telegram client and messaging behavior.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `telegram.api_id` | `number` | **(required)** | Telegram API ID from [my.telegram.org/apps](https://my.telegram.org/apps). |
| `telegram.api_hash` | `string` | **(required)** | Telegram API hash from [my.telegram.org/apps](https://my.telegram.org/apps). |
| `telegram.phone` | `string` | **(required)** | Phone number linked to the Telegram account, in international format (e.g., `"+1234567890"`). |
| `telegram.session_name` | `string` | `"teleton_session"` | Name of the GramJS session file (stored in `session_path`). |
| `telegram.session_path` | `string` | `"~/.teleton"` | Directory where the Telegram session file is stored. |
| `telegram.dm_policy` | `enum` | `"pairing"` | Who can interact via direct messages. See [DM Policies](#dm-policies) below. |
| `telegram.allow_from` | `number[]` | `[]` | List of Telegram user IDs allowed to DM the agent (used when `dm_policy` is `"allowlist"`). |
| `telegram.group_policy` | `enum` | `"open"` | Who can interact in groups. See [Group Policies](#group-policies) below. |
| `telegram.group_allow_from` | `number[]` | `[]` | List of group IDs the agent will respond in (used when `group_policy` is `"allowlist"`). |
| `telegram.require_mention` | `boolean` | `true` | In groups, only respond when the agent is mentioned by name or username. |
| `telegram.max_message_length` | `number` | `4096` | Maximum Telegram message length (Telegram's own limit). |
| `telegram.typing_simulation` | `boolean` | `true` | Show "typing..." indicator while the agent processes a message. |
| `telegram.rate_limit_messages_per_second` | `number` | `1.0` | Maximum outbound messages per second (flood protection). |
| `telegram.rate_limit_groups_per_minute` | `number` | `20` | Maximum outbound messages to groups per minute. |
| `telegram.admin_ids` | `number[]` | `[]` | Telegram user IDs with admin privileges (can use `/admin` commands). |
| `telegram.agent_channel` | `string \| null` | `null` | Channel username or ID for the agent's public feed. |
| `telegram.owner_name` | `string` | *optional* | Owner's first name (used in personality prompts, e.g., `"Alex"`). |
| `telegram.owner_username` | `string` | *optional* | Owner's Telegram username without `@` (e.g., `"zkproof"`). |
| `telegram.owner_id` | `number` | *optional* | Owner's Telegram user ID. |
| `telegram.debounce_ms` | `number` | `1500` | Debounce delay in milliseconds for group messages. When multiple messages arrive in quick succession, they are batched into a single processing cycle. Set to `0` to disable. |
| `telegram.bot_token` | `string` | *optional* | Telegram Bot token from @BotFather. Required for the deals system's inline buttons. |
| `telegram.bot_username` | `string` | *optional* | Bot username without `@` (e.g., `"teleton_deals_bot"`). Required when `bot_token` is set. |

### DM Policies

| Value | Behavior |
|-------|----------|
| `"pairing"` | Users must pair with the agent first (mutual consent). Default and recommended. |
| `"allowlist"` | Only users listed in `allow_from` can interact. |
| `"open"` | Anyone can DM the agent. Use with caution. |
| `"disabled"` | DMs are completely ignored. |

### Group Policies

| Value | Behavior |
|-------|----------|
| `"open"` | Agent responds in any group it is a member of. Default. |
| `"allowlist"` | Only responds in groups listed in `group_allow_from`. |
| `"disabled"` | Group messages are completely ignored. |

### Example

```yaml
telegram:
  api_id: 12345678
  api_hash: "0123456789abcdef0123456789abcdef"
  phone: "+1234567890"
  dm_policy: "pairing"
  group_policy: "open"
  require_mention: true
  admin_ids: [123456789]
  owner_name: "Alex"
  owner_username: "zkproof"
  debounce_ms: 1500
  # bot_token: "123456:ABC-DEF..."
  # bot_username: "my_deals_bot"
```

---

## embedding

Controls the vector embedding provider for the hybrid RAG (Retrieval-Augmented Generation) memory system.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `embedding.provider` | `enum` | `"local"` | Embedding provider. One of: `local` (ONNX, runs locally), `anthropic` (API-based), `none` (FTS5 full-text search only, no vectors). |
| `embedding.model` | `string` | *auto-detected* | Model override. Default for `local` is `Xenova/all-MiniLM-L6-v2`. |

### Example

```yaml
embedding:
  provider: "local"
  # model: "Xenova/all-MiniLM-L6-v2"  # default for local
```

The `"local"` provider uses ONNX Runtime with the `@huggingface/transformers` library and requires no external API calls. The `"none"` provider disables vector search entirely and uses only SQLite FTS5 for memory retrieval.

---

## deals

Configuration for the peer-to-peer deals/escrow system.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `deals.enabled` | `boolean` | `true` | Enable the deals module. |
| `deals.expiry_seconds` | `number` | `120` | Time in seconds before an unaccepted deal expires. |
| `deals.buy_max_floor_percent` | `number` | `100` | Maximum price as a percentage of floor price for buy deals. |
| `deals.sell_min_floor_percent` | `number` | `105` | Minimum price as a percentage of floor price for sell deals. |
| `deals.poll_interval_ms` | `number` | `5000` | How frequently (in milliseconds) the system polls for payment verification on active deals. |
| `deals.max_verification_retries` | `number` | `12` | Maximum number of payment verification attempts before timing out. |
| `deals.expiry_check_interval_ms` | `number` | `60000` | How frequently (in milliseconds) expired deals are cleaned up. |

### Example

```yaml
deals:
  enabled: true
  expiry_seconds: 120
  buy_max_floor_percent: 80
  sell_min_floor_percent: 115
  poll_interval_ms: 5000
```

---

## webui

Optional web dashboard for monitoring and management.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `webui.enabled` | `boolean` | `false` | Enable the WebUI server. Can also be enabled via `TELETON_WEBUI_ENABLED=true` env var or the `--webui` CLI flag. |
| `webui.port` | `number` | `7777` | HTTP server port. Override with `TELETON_WEBUI_PORT` env var. |
| `webui.host` | `string` | `"127.0.0.1"` | Bind address. Defaults to localhost only for security. Override with `TELETON_WEBUI_HOST` env var. Set to `"0.0.0.0"` to expose externally (not recommended without a reverse proxy). |
| `webui.auth_token` | `string` | *auto-generated* | Bearer token for API authentication. If omitted, a random token is generated at startup and printed to the console. |
| `webui.cors_origins` | `string[]` | `["http://localhost:5173", "http://localhost:7777"]` | Allowed CORS origins. Add your domain if accessing from a different host. |
| `webui.log_requests` | `boolean` | `false` | Log all HTTP requests to the WebUI server. |

### Example

```yaml
webui:
  enabled: true
  port: 7777
  host: "127.0.0.1"
  # auth_token: "my-secret-token"
  cors_origins:
    - "http://localhost:5173"
    - "http://localhost:7777"
  log_requests: false
```

---

## storage

Legacy file paths (sessions and memory are now stored in SQLite). These fields exist for backward compatibility with the Zod schema but are no longer actively used in v0.5+.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `storage.history_limit` | `number` | `100` | Maximum number of messages retained in a conversation session's history. |

### Example

```yaml
storage:
  history_limit: 100
```

---

## dev

Developer options.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `dev.hot_reload` | `boolean` | `false` | Enable plugin hot-reload. When enabled, the platform watches `~/.teleton/plugins/` for file changes and automatically reloads modified plugins without restarting. |

### Example

```yaml
dev:
  hot_reload: true
```

---

## plugins

Per-plugin configuration. Each key is the plugin name (with hyphens replaced by underscores), and the value is an arbitrary object passed to the plugin as `pluginConfig`.

Plugins access their configuration via `sdk.pluginConfig` in the tools factory, or via `pluginConfig` in the `start()` context.

### Example

```yaml
plugins:
  casino:
    enabled: true
    min_bet: 0.1
    cooldown_seconds: 30
  my_custom_plugin:
    api_endpoint: "https://api.example.com"
    max_results: 10
```

Plugin secrets (API keys, tokens) should NOT be stored here. Use the `/plugin set <name> <key> <value>` admin command instead, which stores secrets securely in `~/.teleton/plugins/data/<plugin>.secrets.json` with `0600` permissions.

---

## tonapi_key

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tonapi_key` | `string` | *optional* | TonAPI key for higher rate limits on blockchain queries. Obtain from [@tonapi_bot](https://t.me/tonapi_bot) on Telegram. |

### Example

```yaml
tonapi_key: "AF..."
```

---

## meta

Metadata section (mostly auto-managed).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `meta.version` | `string` | `"1.0.0"` | Config file schema version. |
| `meta.created_at` | `string` | *optional* | ISO 8601 timestamp of when the config was created. |
| `meta.last_modified_at` | `string` | *optional* | ISO 8601 timestamp of the last modification (auto-updated on save). |
| `meta.onboard_command` | `string` | `"teleton setup"` | Command shown to users for onboarding. |

---

## Environment Variable Overrides

Environment variables override values set in `config.yaml`. They are applied after the YAML file is loaded.

### Core Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TELETON_HOME` | `~/.teleton` | Root directory for all teleton data (config, wallet, session, workspace, plugins, secrets, database). |
| `TELETON_LOG` | _(unset)_ | Set to `"verbose"` to enable verbose logging. Can also be toggled at runtime via `/verbose`. |

### Config Overrides

| Variable | Config Path | Description |
|----------|-------------|-------------|
| `TELETON_API_KEY` | `agent.api_key` | Override the LLM provider API key. |
| `TELETON_TG_API_ID` | `telegram.api_id` | Override the Telegram API ID (integer). |
| `TELETON_TG_API_HASH` | `telegram.api_hash` | Override the Telegram API hash. |
| `TELETON_TG_PHONE` | `telegram.phone` | Override the phone number. |
| `TELETON_WEBUI_ENABLED` | `webui.enabled` | Enable WebUI (`"true"` or `"false"`). |
| `TELETON_WEBUI_PORT` | `webui.port` | WebUI server port. |
| `TELETON_WEBUI_HOST` | `webui.host` | WebUI bind address. |

### LLM Provider API Keys

Each provider has a dedicated environment variable. Only the key for the configured provider is needed.

| Variable | Provider | Key Format |
|----------|----------|------------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) | `sk-ant-...` |
| `OPENAI_API_KEY` | OpenAI (GPT-4o) | `sk-proj-...` |
| `GOOGLE_API_KEY` | Google (Gemini) | `AIza...` |
| `XAI_API_KEY` | xAI (Grok) | `xai-...` |
| `GROQ_API_KEY` | Groq | `gsk_...` |
| `OPENROUTER_API_KEY` | OpenRouter | `sk-or-...` |

> The `TELETON_API_KEY` override takes precedence over all provider-specific env vars.

### TTS Service Keys

Used by `telegram_send_voice` for text-to-speech. The default TTS provider (`piper`) is offline and needs no key.

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required for the `openai` TTS provider. |
| `ELEVENLABS_API_KEY` | Required for the `elevenlabs` TTS provider. |

### Debug & Development

| Variable | Description |
|----------|-------------|
| `DEBUG` | Enable debug logging in the Telegram client and plugin SDK. |
| `DEBUG_SQL` | Enable SQLite query logging to console. |

### Precedence Order

Configuration values are resolved in this order (highest priority first):

1. **Environment variables** (`TELETON_*` overrides)
2. **CLI flags** (`--webui`, `--webui-port`, `-c`)
3. **Config file** (`config.yaml`)
4. **Schema defaults** (Zod schema default values)

### Example (Docker)

```bash
docker run -d \
  -e TELETON_API_KEY="sk-ant-..." \
  -e TELETON_TG_API_ID="12345678" \
  -e TELETON_TG_API_HASH="0123456789abcdef" \
  -e TELETON_TG_PHONE="+1234567890" \
  -e TELETON_WEBUI_ENABLED="true" \
  -v teleton-data:/data \
  ghcr.io/tonresistor/teleton-agent
```

---

## Complete Example

```yaml
meta:
  version: "1.0.0"

agent:
  provider: "anthropic"
  api_key: "sk-ant-..."
  model: "claude-opus-4-5-20251101"
  max_tokens: 4096
  temperature: 0.7
  max_agentic_iterations: 5
  session_reset_policy:
    daily_reset_enabled: true
    daily_reset_hour: 4
    idle_expiry_enabled: true
    idle_expiry_minutes: 1440

telegram:
  api_id: 12345678
  api_hash: "0123456789abcdef0123456789abcdef"
  phone: "+1234567890"
  dm_policy: "pairing"
  group_policy: "open"
  require_mention: true
  admin_ids: [123456789]
  owner_name: "Alex"
  owner_username: "zkproof"
  debounce_ms: 1500

embedding:
  provider: "local"

deals:
  enabled: true
  expiry_seconds: 120

webui:
  enabled: false
  port: 7777
  host: "127.0.0.1"

dev:
  hot_reload: false

plugins:
  casino:
    enabled: true
    min_bet: 0.1

# tonapi_key: "AF..."
```
