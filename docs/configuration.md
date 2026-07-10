# Configuration Reference

Teleton Agent is configured through a single YAML file located at `~/.teleton/config.yaml`. This document describes every configuration option, its type, default value, and behavior.

Run `teleton setup` to generate a config file interactively, or copy `config.example.yaml` from the repository and edit it manually.

---

## Table of Contents

- [agent](#agent)
- [telegram](#telegram)
- [embedding](#embedding)
- [webui](#webui)
- [storage](#storage)
- [logging](#logging)
- [heartbeat](#heartbeat)
- [tool_rag](#tool_rag)
- [capabilities](#capabilities)
- [mcp](#mcp)
- [dev](#dev)
- [plugins](#plugins)
- [ton_proxy](#ton_proxy)
- [api](#api)
- [gocoon](#gocoon)
- [tonapi_key](#tonapi_key)
- [toncenter_api_key](#toncenter_api_key)
- [tavily_api_key](#tavily_api_key)
- [meta](#meta)
- [Environment Variable Overrides](#environment-variable-overrides)

---

## agent

LLM provider and agentic loop configuration.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `agent.provider` | `enum` | `"anthropic"` | LLM provider. One of: `anthropic`, `codex`, `grok-build`, `openai`, `google`, `xai`, `groq`, `openrouter`, `moonshot`, `mistral`, `cerebras`, `zai`, `minimax`, `huggingface`, `gocoon`, `local`. |
| `agent.api_key` | `string` | `""` | API key for the chosen provider. Can be overridden with `TELETON_API_KEY` env var. |
| `agent.model` | `string` | `"claude-haiku-4-5-20251001"` | Primary model ID. Auto-detected from provider if not set (only for non-Anthropic providers). |
| `agent.utility_model` | `string` | *auto-detected* | Cheap/fast model used for summarization and compaction. If omitted, the platform selects one based on the provider (e.g., `claude-haiku-4-5-20251001` for Anthropic, `gpt-4o-mini` for OpenAI). |
| `agent.base_url` | `string` | *optional* | Base URL for local LLM server (e.g., `http://localhost:11434/v1`). Must be a valid URL. |
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
  model: "claude-haiku-4-5-20251001"
  utility_model: "claude-haiku-4-5-20251001"
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
| `anthropic` | `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` |
| `codex` | `gpt-5.5` | `gpt-5.1-codex-mini` |
| `grok-build` | `grok-build` | `grok-build` |
| `openai` | `gpt-5.5` | `gpt-4o-mini` |
| `google` | `gemini-2.5-flash` | `gemini-2.0-flash-lite` |
| `xai` | `grok-3` | `grok-3-mini-fast` |
| `groq` | `llama-3.3-70b-versatile` | `llama-3.1-8b-instant` |
| `openrouter` | `anthropic/claude-opus-4.5` | `google/gemini-2.5-flash-lite` |
| `moonshot` | `k2p6` | `k2p6` |
| `mistral` | `devstral-small-2507` | `ministral-8b-latest` |
| `cerebras` | `qwen-3-235b-a22b-instruct-2507` | `llama3.1-8b` |
| `zai` | `glm-5.1` | `glm-4.5-air` |
| `minimax` | `MiniMax-M2.7` | `MiniMax-M2.7` |
| `huggingface` | `deepseek-ai/DeepSeek-V3.2` | `Qwen/Qwen3-Next-80B-A3B-Instruct` |
| `gocoon` | `Qwen/Qwen3-32B` | `Qwen/Qwen3-32B` |
| `local` | `auto` | `auto` |

`grok-build` reads the browser/OIDC session created by `grok login` from
`$GROK_HOME/auth.json` (default: `~/.grok/auth.json`) and connects directly to
the Grok Build CLI proxy. The session token is not stored in Teleton's config.

Codex model `gpt-5.6-luna` is hidden and rejected by default because the live
backend does not currently advertise it. Keep production on `gpt-5.6-terra`;
`TELETON_ENABLE_CODEX_LUNA=true` exists only for controlled backend revalidation.

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
| `telegram.dm_policy` | `enum` | `"allowlist"` | Who can interact via direct messages. See [DM Policies](#dm-policies) below. |
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
| `telegram.bot_token` | `string` | *optional in user mode* | Telegram Bot token from @BotFather. Required in bot mode; enables plugin inline cards and callbacks in user mode. |
| `telegram.bot_username` | `string` | *optional* | Bot username without `@` (e.g., `"teleton_agent_bot"`). Used with `bot_token` for inline queries. |

### DM Policies

| Value | Behavior |
|-------|----------|
| `"allowlist"` | Only users listed in `allow_from` can interact. Default. |
| `"open"` | Anyone can DM the agent. Use with caution. |
| `"admin-only"` | Only users in `admin_ids` can interact via DM. |
| `"disabled"` | DMs are completely ignored. |

### Group Policies

| Value | Behavior |
|-------|----------|
| `"open"` | Agent responds in any group it is a member of. Default. |
| `"allowlist"` | Only responds in groups listed in `group_allow_from`. |
| `"admin-only"` | Only responds when triggered by users in `admin_ids`. |
| `"disabled"` | Group messages are completely ignored. |

### Example

```yaml
telegram:
  api_id: 12345678
  api_hash: "0123456789abcdef0123456789abcdef"
  phone: "+1234567890"
  dm_policy: "allowlist"
  group_policy: "open"
  require_mention: true
  admin_ids: [123456789]
  owner_name: "Alex"
  owner_username: "zkproof"
  debounce_ms: 1500
  # bot_token: "123456:ABC-DEF..."
  # bot_username: "my_agent_bot"
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
| `storage.sessions_file` | `string` | `"~/.teleton/sessions.json"` | Path to the sessions file (legacy, superseded by SQLite in v0.5+). |
| `storage.memory_file` | `string` | `"~/.teleton/memory.json"` | Path to the memory file (legacy, superseded by SQLite in v0.5+). |

### Example

```yaml
storage:
  history_limit: 100
```

---

## logging

Structured logging configuration (Pino).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `logging.level` | `enum` | `"info"` | Log level. One of: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |
| `logging.pretty` | `boolean` | `true` | Enable pino-pretty formatting (human-readable, colored output). |

### Example

```yaml
logging:
  level: "info"
  pretty: true
```

---

## heartbeat

Periodic heartbeat timer that triggers the agent to check for pending tasks.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `heartbeat.enabled` | `boolean` | `true` | Enable the periodic heartbeat timer. |
| `heartbeat.interval_ms` | `number` | `3600000` | Heartbeat interval in milliseconds. Minimum `60000` (60 seconds), default `3600000` (60 minutes). |
| `heartbeat.prompt` | `string` | `"Execute your HEARTBEAT.md checklist now. Work through each item using tool calls."` | Prompt sent to the agent on each heartbeat tick. |
| `heartbeat.self_configurable` | `boolean` | `false` | Allow the agent to modify heartbeat config at runtime via `config_set`. |

### Example

```yaml
heartbeat:
  enabled: true
  interval_ms: 3600000
  prompt: "Execute your HEARTBEAT.md checklist now. Work through each item using tool calls."
  self_configurable: false
```

---

## tool_rag

Semantic tool retrieval configuration. When enabled, the agent uses embedding-based search to select the most relevant tools for each LLM call, reducing prompt size and improving performance.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tool_rag.enabled` | `boolean` | `true` | Enable semantic tool retrieval (Tool RAG). |
| `tool_rag.top_k` | `number` | `35` | Maximum number of tools to retrieve per LLM call. |
| `tool_rag.always_include` | `string[]` | `["journal_*", "workspace_*", "web_*"]` | Tool name patterns always included regardless of relevance score. Supports prefix glob with `*`. Telegram send tools remain searchable but are excluded by default to prevent duplicate replies and progress messages. |
| `tool_rag.skip_unlimited_providers` | `boolean` | `false` | Skip Tool RAG for providers with no tool limit (e.g., Anthropic). When `true`, all tools are sent to those providers. |

### Example

```yaml
tool_rag:
  enabled: true
  top_k: 35
  always_include:
    - "journal_*"
    - "workspace_*"
    - "web_*"
  skip_unlimited_providers: false
```

---

## capabilities

Controls optional agent capabilities that require explicit opt-in.

### capabilities.exec

System command execution (shell access). Disabled by default for security.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `capabilities.exec.mode` | `enum` | `"off"` | Exec mode: `off` (disabled) or `yolo` (full system access). |
| `capabilities.exec.scope` | `enum` | `"admin-only"` | Who can trigger exec tools. One of: `admin-only`, `allowlist`, `all`. |
| `capabilities.exec.allowlist` | `number[]` | `[]` | Telegram user IDs allowed to use exec (when `scope` is `"allowlist"`). |
| `capabilities.exec.limits.timeout` | `number` | `120` | Max seconds per command execution (1-3600). |
| `capabilities.exec.limits.max_output` | `number` | `50000` | Max characters of stdout/stderr captured per command (1000-500000). |
| `capabilities.exec.audit.log_commands` | `boolean` | `true` | Log every command to SQLite audit table. |

### Example

```yaml
capabilities:
  exec:
    mode: "yolo"
    scope: "admin-only"
    limits:
      timeout: 120
      max_output: 50000
    audit:
      log_commands: true
```

---

## mcp

Model Context Protocol (MCP) server configuration. Supports both stdio (command-based) and SSE/HTTP (URL-based) transports.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mcp.servers` | `record` | `{}` | Map of server name to server configuration. Each server needs either `command` (stdio) or `url` (SSE/HTTP). |

Each server entry supports:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `command` | `string` | *optional* | Stdio command (e.g., `npx @modelcontextprotocol/server-filesystem /tmp`). |
| `args` | `string[]` | *optional* | Explicit args array (overrides command splitting). |
| `env` | `record` | *optional* | Environment variables for stdio server. |
| `url` | `string` | *optional* | SSE/HTTP endpoint URL (alternative to `command`). |
| `scope` | `enum` | `"always"` | Tool scope. One of: `always`, `dm-only`, `group-only`, `admin-only`. |
| `enabled` | `boolean` | `true` | Enable/disable this server. |

### Example

```yaml
mcp:
  servers:
    filesystem:
      command: "npx @modelcontextprotocol/server-filesystem /tmp"
      scope: "admin-only"
    remote-api:
      url: "https://mcp.example.com/sse"
      enabled: true
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

## ton_proxy

Optional TON Proxy configuration. When enabled, the agent runs a Tonutils-Proxy instance for accessing TON Sites and ADNL resources.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `ton_proxy.enabled` | `boolean` | `false` | Enable the TON Proxy module. When `true`, the proxy starts with the agent. |
| `ton_proxy.port` | `number` | `8080` | Local HTTP proxy port (1-65535). |
| `ton_proxy.binary_path` | `string` | *optional* | Custom path to `tonutils-proxy-cli` binary. If omitted, the binary is auto-downloaded on first run. |

### Example

```yaml
ton_proxy:
  enabled: true
  port: 8080
  # binary_path: "/usr/local/bin/tonutils-proxy-cli"
```

---

## api

HTTPS Management API for remote agent administration. See the full [Management API documentation](management-api.md) for endpoint details, authentication, and examples.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `api.enabled` | `boolean` | `false` | Enable the HTTPS Management API server. |
| `api.port` | `number` | `7778` | HTTPS server port (1-65535). |
| `api.key_hash` | `string` | `""` | SHA-256 hash of the API key. Auto-generated on first start — do not set manually. |
| `api.allowed_ips` | `string[]` | `[]` | IP whitelist. Empty array allows all authenticated requests. |

### Example

```yaml
api:
  enabled: true
  port: 7778
  allowed_ips:
    - "203.0.113.10"
```

---

## gocoon

Gocoon configuration. Gocoon is a pure-Go COCOON client: a decentralized LLM that pays in TON. It exposes a native OpenAI-compatible API (with function calling) and requires the `gocoon-runner` process running on the specified port.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `gocoon.port` | `number` | `10000` | HTTP port of the `gocoon-runner` OpenAI-compatible API (1-65535). |

The `gocoon` section is optional. Only needed when `agent.provider` is set to `"gocoon"`.

### Example

```yaml
gocoon:
  port: 10000
```

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

## toncenter_api_key

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `toncenter_api_key` | `string` | *optional* | TonCenter API key for a dedicated RPC endpoint. Free at [toncenter.com](https://toncenter.com). |

### Example

```yaml
toncenter_api_key: "abc123..."
```

---

## tavily_api_key

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tavily_api_key` | `string` | *optional* | Tavily API key for web search and extract tools. Free at [tavily.com](https://tavily.com). |

### Example

```yaml
tavily_api_key: "tvly-..."
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
| `TELETON_LOG` | _(unset)_ | Set to `"verbose"` to enable verbose logging (maps to `debug` level). Can also be toggled at runtime via `/verbose`. |
| `TELETON_LOG_LEVEL` | _(unset)_ | Explicit log level override. One of: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Takes priority over `TELETON_LOG`. |

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
| `TELETON_API_ENABLED` | `api.enabled` | Enable Management API (`"true"` or `"false"`). |
| `TELETON_API_PORT` | `api.port` | Management API HTTPS port. |
| `TELETON_BASE_URL` | `agent.base_url` | Base URL for local LLM server (must be a valid URL). |
| `TELETON_TAVILY_API_KEY` | `tavily_api_key` | Tavily API key for web search tools. |
| `TELETON_TONAPI_KEY` | `tonapi_key` | TonAPI key for blockchain queries. |
| `TELETON_TONCENTER_API_KEY` | `toncenter_api_key` | TonCenter API key for RPC endpoint. |

### LLM Provider API Keys

Each provider has a dedicated environment variable. Only the key for the configured provider is needed.

| Variable | Provider | Key Format |
|----------|----------|------------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) | `sk-ant-...` |
| `OPENAI_API_KEY` | OpenAI (GPT-5.5) | `sk-proj-...` |
| `GOOGLE_API_KEY` | Google (Gemini) | `AIza...` |
| `XAI_API_KEY` | xAI (Grok) | `xai-...` |
| `GROQ_API_KEY` | Groq | `gsk_...` |
| `OPENROUTER_API_KEY` | OpenRouter | `sk-or-...` |
| `MOONSHOT_API_KEY` | Moonshot | `sk-...` |
| `MISTRAL_API_KEY` | Mistral | -- |
| `CEREBRAS_API_KEY` | Cerebras | `csk-...` |
| `ZAI_API_KEY` | ZAI | -- |
| `MINIMAX_API_KEY` | MiniMax | -- |
| `HF_TOKEN` | HuggingFace | `hf_...` |

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

1. **CLI flags** (`--webui`, `--webui-port`, `-c`) (highest)
2. **Environment variables** (`TELETON_*` overrides)
3. **Config file** (`config.yaml`)
4. **Schema defaults** (Zod schema default values, lowest)

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
  model: "claude-haiku-4-5-20251001"
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
  dm_policy: "allowlist"
  group_policy: "open"
  require_mention: true
  admin_ids: [123456789]
  owner_name: "Alex"
  owner_username: "zkproof"
  debounce_ms: 1500

embedding:
  provider: "local"

webui:
  enabled: false
  port: 7777
  host: "127.0.0.1"

logging:
  level: "info"
  pretty: true

heartbeat:
  enabled: true
  interval_ms: 3600000

tool_rag:
  enabled: true
  top_k: 35

dev:
  hot_reload: false

plugins:
  casino:
    enabled: true
    min_bet: 0.1

# ton_proxy:
#   enabled: false
#   port: 8080

# tonapi_key: "AF..."
# toncenter_api_key: "abc123..."
# tavily_api_key: "tvly-..."
```
