# Telegram Setup Guide

This guide covers obtaining Telegram API credentials, configuring the agent's messaging policies, and setting up admin controls.

---

## Table of Contents

- [Getting API Credentials](#getting-api-credentials)
- [Phone Number Format](#phone-number-format)
- [First-Time Authentication](#first-time-authentication)
- [2FA Handling](#2fa-handling)
- [Bot Token (Optional)](#bot-token-optional)
- [DM Policies](#dm-policies)
- [Group Policies](#group-policies)
- [Admin IDs](#admin-ids)
- [Mention Settings for Groups](#mention-settings-for-groups)
- [Owner Configuration](#owner-configuration)
- [Rate Limiting and Debounce](#rate-limiting-and-debounce)

---

## Getting API Credentials

Teleton Agent connects to Telegram as a **user client** (userbot) via the MTProto protocol, using the GramJS library. This requires Telegram API credentials, not a regular bot token.

### Step-by-Step

1. Open [my.telegram.org](https://my.telegram.org) in your browser
2. Log in with your phone number (the same one you will use for the agent)
3. Navigate to **API development tools**
4. Fill in the form:
   - **App title**: Any name (e.g., "Teleton Agent")
   - **Short name**: A short identifier (e.g., "teleton")
   - **Platform**: Can be left as default
   - **Description**: Optional
5. Click **Create application**
6. Note your **api_id** (a number) and **api_hash** (a hex string)

These credentials are permanent and do not expire. Store them securely.

### Configuration

```yaml
telegram:
  api_id: 12345678                              # Your numeric API ID
  api_hash: "0123456789abcdef0123456789abcdef"   # Your 32-character hex hash
  phone: "+1234567890"                           # Your phone number
```

Or via the setup wizard:

```bash
teleton setup
```

---

## Phone Number Format

The phone number must be in full international format with the country code prefix:

| Country | Format | Example |
|---------|--------|---------|
| United States | `+1XXXXXXXXXX` | `"+12125551234"` |
| United Kingdom | `+44XXXXXXXXXX` | `"+447911123456"` |
| Germany | `+49XXXXXXXXXXX` | `"+4915112345678"` |
| Russia | `+7XXXXXXXXXX` | `"+79161234567"` |
| France | `+33XXXXXXXXX` | `"+33612345678"` |

Always include the `+` prefix and the country code. Do not include spaces, dashes, or parentheses.

```yaml
telegram:
  phone: "+1234567890"  # Correct
  # phone: "1234567890"  # Wrong: missing +
  # phone: "+1 (234) 567-890"  # Wrong: contains formatting
```

---

## First-Time Authentication

On the first startup, Teleton Agent will prompt you for a verification code that Telegram sends to your phone (or to another active Telegram session):

```
Enter the code you received from Telegram: _____
```

After successful authentication, a session file is saved to `~/.teleton/` (or the path specified by `telegram.session_path`). Subsequent launches use this saved session and do not require re-authentication.

### Session Persistence

The session file is stored at:
```
~/.teleton/<session_name>/
```

Where `session_name` defaults to `teleton_session`. If you delete or lose this file, you will need to re-authenticate.

### Headless/Docker Environments

For Docker or other environments without an interactive terminal, run the setup step interactively first:

```bash
# Docker
docker run -it --rm -v teleton-data:/data ghcr.io/tonresistor/teleton-agent setup

# Then start normally
docker run -d -v teleton-data:/data ghcr.io/tonresistor/teleton-agent
```

---

## 2FA Handling

If your Telegram account has Two-Factor Authentication (2FA) enabled, you will be prompted for your password after entering the verification code:

```
Enter the code you received from Telegram: 12345
Enter your 2FA password: ________
```

The password is not stored. It is only used during the initial authentication to establish the session. Once the session is established, 2FA is not prompted again unless the session is invalidated.

If you change your 2FA password after establishing a session, you do not need to re-authenticate -- the existing session remains valid.

---

## Bot Token (Optional)

A regular Telegram Bot token (from @BotFather) is optionally used alongside the user client for specific features:

- **Inline keyboard buttons** in the deals system
- **Callback query handling** for interactive UI elements

The bot token is NOT used for the primary message sending/receiving -- that is handled by the user client.

### Setup

1. Open [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Note the bot token (format: `123456:ABC-DEF...`)
4. Note the bot username

```yaml
telegram:
  bot_token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
  bot_username: "my_teleton_bot"   # Without @
```

The bot must be added to any groups where you want inline buttons to work.

---

## DM Policies

The `dm_policy` setting controls who can interact with the agent via direct messages.

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `"pairing"` | Users must mutually pair with the agent before interaction. The agent and user must both consent. | **Default**. Recommended for most deployments. Prevents spam. |
| `"allowlist"` | Only user IDs listed in `allow_from` can send DMs. | Restricted access for known users. |
| `"open"` | Anyone can DM the agent. | Public-facing agents. Use with caution -- can lead to high API costs. |
| `"disabled"` | All DMs are ignored. | Group-only deployments. |

### Allowlist Example

```yaml
telegram:
  dm_policy: "allowlist"
  allow_from:
    - 123456789    # Alice's user ID
    - 987654321    # Bob's user ID
```

### Finding Your User ID

Send a message to [@userinfobot](https://t.me/userinfobot) on Telegram. It will reply with your numeric user ID.

---

## Group Policies

The `group_policy` setting controls which groups the agent responds in.

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `"open"` | Agent responds in any group it is added to. | **Default**. Convenient for small, trusted groups. |
| `"allowlist"` | Only responds in group IDs listed in `group_allow_from`. | Controlled access -- the agent is silent in groups not on the list. |
| `"disabled"` | All group messages are ignored. | DM-only deployments. |

### Allowlist Example

```yaml
telegram:
  group_policy: "allowlist"
  group_allow_from:
    - -1001234567890    # Allowed group chat ID
    - -1009876543210    # Another allowed group
```

Group chat IDs are negative numbers starting with `-100`.

---

## Admin IDs

Admin IDs grant special privileges to specific users. Admins can:

- Use `/admin` commands to control the agent
- Use admin-only tools (scope: `"admin-only"`)
- Manage plugins via `/plugin` commands
- View system status and diagnostics

```yaml
telegram:
  admin_ids:
    - 123456789    # Primary admin
    - 987654321    # Secondary admin
```

At minimum, add your own Telegram user ID to `admin_ids`. Without any admin IDs configured, admin commands are inaccessible.

---

## Mention Settings for Groups

The `require_mention` setting controls whether the agent responds to all messages in a group or only when specifically mentioned.

```yaml
telegram:
  require_mention: true   # Default: only respond when mentioned
```

When `require_mention` is `true` (the default), the agent only processes group messages that:
- Mention the agent by username (e.g., `@agent_name`)
- Reply to a previous message from the agent
- Contain the agent's first name

When `require_mention` is `false`, the agent processes all messages in allowed groups. This can be expensive in active groups and is not recommended for most deployments.

---

## Owner Configuration

Optional fields that personalize the agent's behavior. The owner information is included in the system prompt, allowing the LLM to reference its owner naturally.

```yaml
telegram:
  owner_name: "Alex"           # Your first name
  owner_username: "zkproof"    # Your Telegram @username (without @)
  owner_id: 123456789          # Your Telegram user ID
```

These fields are informational and do not affect access control. Use `admin_ids` for privilege management.

---

## Rate Limiting and Debounce

Teleton Agent includes built-in protections against Telegram's flood limits.

### Rate Limits

```yaml
telegram:
  rate_limit_messages_per_second: 1.0    # Max outbound messages per second
  rate_limit_groups_per_minute: 20       # Max outbound group messages per minute
```

The GramJS client also has a built-in `floodSleepThreshold` of 60 seconds, which automatically handles Telegram's `FLOOD_WAIT` errors for waits of 60 seconds or less.

### Debounce

```yaml
telegram:
  debounce_ms: 1500   # Group message batching delay
```

When multiple messages arrive in quick succession in a group, the debouncer batches them into a single processing cycle. This:
- Reduces API costs (fewer LLM calls)
- Produces more coherent responses (the agent sees the full context)
- Prevents the agent from responding to each message individually

Set to `0` to disable debouncing.

### Typing Simulation

```yaml
telegram:
  typing_simulation: true   # Default
```

When enabled, the agent shows a "typing..." indicator while processing a message. This provides a more natural user experience.

---

## Admin Commands

All admin commands require the sender's Telegram user ID to be listed in `admin_ids`. Commands can be prefixed with `/`, `!`, or `.` (e.g., `/status`, `!status`, `.status`).

### Command Summary

| # | Command | Syntax | Description |
|---|---------|--------|-------------|
| 1 | `/status` | `/status` | View agent status: active conversations, provider, model, policies, paused state. |
| 2 | `/model` | `/model [model_name]` | View or switch the LLM model at runtime. |
| 3 | `/loop` | `/loop [1-50]` | View or set max agentic loop iterations. |
| 4 | `/policy` | `/policy <dm\|group> <value>` | View or change access policies. |
| 5 | `/strategy` | `/strategy [buy\|sell <percent>]` | View or change trading strategy thresholds. |
| 6 | `/modules` | `/modules [set\|info\|reset] ...` | Manage per-group module permissions (group-only). |
| 7 | `/plugin` | `/plugin <set\|unset\|keys> ...` | Manage plugin secrets (API keys, tokens). |
| 8 | `/wallet` | `/wallet` | Check TON wallet balance and address. |
| 9 | `/verbose` | `/verbose` | Toggle verbose debug logging on/off. |
| 10 | `/pause` | `/pause` | Pause the agent (ignores non-admin messages). |
| 11 | `/resume` | `/resume` | Resume the agent after pause. |
| 12 | `/stop` | `/stop` | Emergency shutdown (terminates process). |
| 13 | `/clear` | `/clear [chat_id]` | Clear conversation history for a chat. |
| 14 | `/ping` | `/ping` | Health check (returns "Pong!"). |
| 15 | `/help` | `/help` | Display all available commands. |

> `/task <description>` and `/boot` are also available but handled by the message handler layer, not AdminHandler directly.

### /model

Switch the LLM model at runtime without restarting. The model must be compatible with the configured provider.

```
/model gpt-4o
/model claude-opus-4-5-20251101
```

### /loop

Set max agentic iterations per message (1-50). Higher values allow longer reasoning chains but cost more tokens.

```
/loop 10
```

### /policy

Change DM or group access policies at runtime.

**DM policies:** `open`, `allowlist`, `pairing`, `disabled`
**Group policies:** `open`, `allowlist`, `disabled`

```
/policy dm allowlist
/policy group disabled
```

### /strategy

Adjust trading thresholds for the deals module.

- **Buy threshold (50-150):** Max % of floor price the agent will pay.
- **Sell threshold (100-200):** Min % of floor price the agent will accept.

```
/strategy buy 90
/strategy sell 130
```

### /modules

Manage per-group module permissions (group-only command).

| Subcommand | Syntax | Description |
|------------|--------|-------------|
| _(none)_ | `/modules` | List all modules with current levels |
| `set` | `/modules set <module> <level>` | Set a module's permission (`open`, `admin`, `disabled`) |
| `info` | `/modules info <module>` | Show module's tools list |
| `reset` | `/modules reset [module]` | Reset module(s) to default `open` level |

```
/modules set ton admin
/modules info telegram
/modules reset
```

### /plugin

Manage secrets for external plugins. Secrets are stored in `~/.teleton/secrets/<plugin_name>/`.

| Subcommand | Syntax | Description |
|------------|--------|-------------|
| `set` | `/plugin set <name> <key> <value>` | Store a secret |
| `unset` | `/plugin unset <name> <key>` | Remove a secret |
| `keys` | `/plugin keys <name>` | List configured secret keys |

```
/plugin set casino API_KEY sk-abc123
/plugin keys casino
```

### /pause and /resume

`/pause` stops the agent from processing non-admin messages. Admin commands still work. `/resume` restores normal operation. Useful for maintenance or debugging.

### /stop

Emergency shutdown. Terminates the process after a 1-second delay. The agent must be manually restarted.

### /clear

Clear conversation history. Without arguments, clears the current chat. With a chat_id, clears that specific chat remotely.

```
/clear
/clear -1001234567890
```
