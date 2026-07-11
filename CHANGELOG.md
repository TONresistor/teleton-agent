# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0] - 2026-07-11

### Added

- **GPT-5.6 Codex support** with Sol and Terra model resolution. Luna support is available only behind `TELETON_ENABLE_CODEX_LUNA=true` for controlled backend revalidation.
- **Validated Grok Build provider** with CLI authentication and runtime checks.
- **Claude Opus 4.8** in the shared model catalog.
- **Plugin SDK 2.1** with typed capability contracts, protected low-level TON sends, get-method execution, DeDust/STON.fi brokers, inline-bot operations, Highload Wallet support, isolated storage/secrets/database access, and explicit approval metadata for external actions.
- SDK package verification, coverage enforcement, and independent npm publication through the release workflow.

### Changed

- Migrated the LLM client from deprecated `@mariozechner/pi-ai` to maintained `@earendil-works/pi-ai`.
- Refactored the agent loop, application startup, onboarding, WebUI contracts, provider policy, DEX/DNS adapters, and SDK type surface into smaller shared modules.
- **Breaking:** raised the supported runtime baseline to Node.js `^22.22.2`, `^24.15.0`, or `>=26.0.0`.
- **Breaking:** removed the obsolete Deals trading module and its stale CLI/WebUI surfaces.
- Plugin execution now enforces SDK capability boundaries, channel scopes, minimum access floors, creator authority for scheduled tasks, and approval gates for external actions.
- CI Telegram notifications now batch every pushed commit into one expandable message.

### Fixed

- Provider quota and runtime failures now produce a clear Telegram error instead of leaving the user without a response.
- Prevented Telegram self-replies, duplicate sends, and false send confirmations; restored bot inline runtime wiring.
- Serialized side-effect operations and bounded stalled MCP/tool calls without retrying non-cancellable financial actions.
- Hardened workspace symlink containment, exec sender allowlists, plugin databases, private reads, log redaction, TON Proxy lifecycle, DEX/DNS transactions, and remote MCP tool trust.
- Bound gift purchases to the approved live price and protected owner-only financial data.
- Replaced eval-based Lottie rendering and pinned patched dependency versions.

### Removed

- Dead helpers, exports, row/media duplicates, and the redundant tool-error wrapper.

## [0.9.0] - 2026-06-19

### Added

- **Native `gocoon` provider**: an OpenAI-compatible, pure-Go COCOON client ([gocoon](https://github.com/TONresistor/gocoon)). Turnkey lifecycle — auto-install and integrity-verify the runner binary, supervise it, and set up / top-up / withdraw the TON payment channel from the CLI (`teleton gocoon`) or the WebUI Gocoon page. Runner pinned to v0.2.0, default model `Qwen/Qwen3-32B`.
- **WebUI Gocoon page**: channel status (including the fund address), top-up, withdraw, unstake, and wallet reset.
- **Codex** in the WebUI provider selector.

### Changed

- **Replaced the `cocoon` provider with `gocoon`** (**Breaking**). Tool-calling now uses the model's native `tools`/`tool_calls` instead of the old XML-injection shim, which has been removed (`src/cocoon/` deleted). Set `agent.provider: gocoon` and rename the `cocoon:` config block to `gocoon:` (`gocoon.port`, default `10000`); legacy `cocoon` configs are auto-migrated on load.
- **ToolSearch mode enabled by default.**
- **Local SSE proxy** fronts the gocoon runner — fixes the pi-ai "empty response / zero tokens" issue and surfaces runner errors to the client.
- **Auto-start is non-fatal**: an unfunded channel keeps the agent and WebUI running so it can be funded from the Gocoon page (requires ≥2 TON free in the fund wallet).
- Re-verify the runner binary integrity on every launch, not only on install.

### Fixed

- **Unstake / withdraw**: `withdrawAll` scanned the owner wallet instead of the fund wallet, so the channel close was skipped and the staked TON stayed locked while only the liquid balance was swept. Now scans the fund address and reads channel state.
- Harden withdraw against transient errors and re-runs (idempotent, re-broadcast-safe).
- Hold the wallet tx-lock during the agent-wallet sweep to prevent a concurrent send from stealing the seqno.
- Gate top-up on a running runner; show the fund address in status.
- CI: lowercase the ghcr.io path in the release-notes Docker step.

### Removed

- The `cocoon` provider and its XML tool-adapter (`src/cocoon/`).
- Dead code: `events/bus`, `memory/agent/sessions`, `telegram/callbacks/*`, web `SearchInput`, `lib/a11y`, and assorted unused helpers.

## [0.8.1] - 2026-03-05

### Added
- **TON Proxy module**: Built-in Tonutils-Proxy lifecycle manager — auto-download binary from GitHub, start/stop, health checks, auto-restart on crash, PID-based orphan cleanup, WebUI API routes for hot-toggle
- **SDK signed transfers**: `createTransfer()`, `createJettonTransfer()`, `getPublicKey()`, `getWalletVersion()` — sign TON/jetton transfers without broadcasting for x402 payment protocol
- **Plugin hooks system**: 13 typed hooks via `sdk.on()` — `message:receive`, `response:before/after/error`, `tool:error`, `prompt:after`, `agent:start/stop`, plus 5 original lifecycle hooks with configurable priority
- **User-configurable hooks**: Keyword blocklist and context triggers for automated responses
- **QR code login**: WebUI setup wizard supports QR code authentication as alternative to phone+code
- **Two-phase observation masking**: Old tool results fully masked, previous iteration results truncated at 4K while preserving summary fields, current iteration intact

### Changed
- **WebUI Config page**: Reorganized into dedicated tabs (Agent, Telegram, TON Proxy, Sessions, Tool RAG)
- **RAG performance**: Knowledge + feed hybrid searches run concurrently via `Promise.all` (~200-500ms saved per message); parsed transcripts cached in memory with invalidation on delete/archive
- **15 LLM providers**: Documentation updated across all `.md` files to reflect Cerebras, ZAI, MiniMax, Hugging Face additions
- **70+ models** in shared catalog (up from 60+)

### Fixed
- **Tool RAG scoring**: Keyword search scores normalized to 1.0 weight when no embedding provider is configured (was incorrectly using 0.4)
- **Transcript deduplication**: `loadContextFromTranscript()` deduplicates `toolResult` messages by `toolCallId`, preventing API 400 errors on corrupted transcripts
- **TON Proxy orphan process**: Manager now writes PID file and checks port occupancy before start, killing orphan processes from previous sessions
- **Security**: Sanitize hook context, fix `effectiveIsGroup` self-reference crash (TDZ)
- **CI**: Coverage thresholds lowered with margin for Node 20 CI variance
- **ESLint**: Strict config with quality tooling and CI hardening

## [0.8.0] - 2026-03-02

### Added
- **4 new LLM providers** (11 → 15): Cerebras (ultra-fast inference, free tier), ZAI/Zhipu (2 free models), MiniMax (M2.5, 204K ctx), Hugging Face (routing to 18 models via single token)
- **Bot SDK for plugins**: `sdk.bot` with inline query handling, callback routing, colored/styled buttons (success/danger/primary), lazy-loaded, rate-limited, namespace-isolated per plugin
- **29 new SDK methods**: Full Telegram surface (77 tools), TON jetton analytics, dual DEX aggregator, .ton DNS management, scheduled messages, Stars/gift marketplace, `getDialogs`/`getHistory`, `kickUser`
- **`dns.setSiteRecord()`**: Set ADNL records on .ton domains for TON Site hosting
- **GramJS Layer 223**: Participant ranks and message `from_rank` surfaced in agent display

### Changed
- **Moonshot provider**: Refactored from hardcoded model dict to pi-ai native `kimi-coding` provider (30 lines removed). Backward-compat alias maps `kimi-k2.5` → `k2p5`
- **Configurable keys**: Provider list derived from `getSupportedProviders()` instead of hardcoded copy

### Fixed
- **Docker build**: Remove deleted `scripts/` references from Dockerfile; skip husky prepare in runtime stage
- **Release workflow**: Publish-npm and create-release skip gracefully when version already published (idempotent re-push)
- **Security**: NFKC normalization + Unicode Tag Block filtering, SQL comment stripping on plugin DB proxy, download size guard (50MB), deep-clone frozenConfig
- **Performance**: Single shared embedding for context + tool RAG, edges-first chunk reordering, feed truncation (2000 chars)
- **UTC session reset**, transcript permissions, masked API key display

## [0.7.5] - 2026-02-28

### Added
- **YOLO Mode** (Coding Agent): 4 new exec tools for full system access on Linux — `exec_run` (bash commands), `exec_install` (apt/pip/npm/docker), `exec_service` (systemd management), `exec_status` (server health). Disabled by default (`mode: off`), requires explicit `mode: yolo` opt-in. Admin-only scope, configurable timeout (120s), output limit (50KB), full audit trail in SQLite
- **`admin-only` access policy**: New DM and group policy option — only Telegram admins can interact with the agent. Now the default for new installations (previously `open`)
- **DNS set-site tool**: `dns_set_site` links a `.ton` domain to a TON Site via ADNL address for decentralized website hosting
- **GramJS Layer 222 fork**: Switch from npm `telegram` to TONresistor/gramjs fork — native Layer 222 constructors, no more TL schema patching
- **4 NFT marketplace tools** (73 → 77): `get-unique-gift`, `get-unique-gift-value`, `send-gift-offer`, `resolve-gift-offer`
- **Gift service messages**: Real-time handling of gift offers received/declined and gifts received — agent can react automatically
- **TON balance query**: `telegram_get_stars_balance` now supports `ton=true` for internal TON ledger balance
- **Live token usage tracking**: WebUI dashboard displays real-time token consumption with cache hit rates
- **Channel username tools** (70 → 73): `check-channel-username`, `set-channel-username`, `create-channel-username`
- **Toncenter API key**: Centralized TonClient caching with optional Toncenter API key for higher rate limits
- **DB migration 1.12.0**: `exec_audit` table for command execution history (indexed by timestamp, user)
- **DB migration 1.13.0**: Per-session token usage tracking (input/output tokens accumulated per chat)
- **Session auto-pruning**: Sessions older than 30 days are automatically cleaned up at startup

### Changed
- **Tool RAG enabled by default**: Semantic tool selection now active for all providers, reducing ~120 tools to ~25 per LLM call
- **35+ tool descriptions enriched**: Cross-references and clearer context for better RAG matching accuracy
- **Default access policy**: DM and group policies default to `admin-only` instead of `open` — secure by default
- **CLI wizard**: New "Coding Agent" setup question, policy choices reordered (Admin Only first)
- **WebUI wizard**: New "System Execution" select with YOLO mode + VPS warning
- **Dashboard**: Policy selects updated with `admin-only` option and clearer labels
- **Gift catalog rework**: `get-available-gifts` now supports pagination, sorting (price, resale count), search by title, and resale filter
- **Resale identifiers**: `buy-resale-gift` migrated from `odayId` to `slug`, `set-collectible-price` from `odayId` to `msgId`
- **Resale error handling**: `STARGIFT_RESELL_TOO_EARLY` parsed with human-readable wait time, `STARGIFT_INVALID` with guidance
- **Styled keyboard**: Native Layer 222 constructors for `KeyboardButtonStyle`, `KeyboardButtonCopy`, `KeyboardButtonCallback` — no more `(Api as any)` casts
- **WebUI dashboard**: Redesigned with provider switch, tools & plugins panels
- **WebUI config page**: Harmonized UX across all settings panels
- **Ston.fi DEX**: Migrated to SDK v2 with hardened SendMode and transaction locking

### Fixed
- **Typing indicator**: Persistent typing during agent processing with retry and dedup hardening
- **Auth flow**: Guard `SentCodePaymentRequired` type (Layer 222 narrowing) in both CLI and WebUI auth
- **send-gift**: Use `getInputEntity()` instead of `getEntity()` for correct InputPeer type

### Removed
- **Postinstall patch system**: `scripts/patch-gramjs.sh` and `scripts/postinstall.mjs` — no longer needed with Layer 222 fork

## [0.7.4] - 2026-02-25

### Added
- **Configurable keys overhaul**: Array type support (admin_ids, allow_from, group_allow_from), labels and option labels on all keys, new keys for Telegram rate limits, Deals params, Embedding model, Cocoon port, Agent base_url
- **ArrayInput component**: Tag-style input for managing array config values in the dashboard
- **Memory sources browser**: List indexed knowledge sources with entry counts, expand to view individual chunks with line ranges
- **Workspace image preview**: Serve raw images with correct MIME type, 5MB limit, SVG sandboxing
- **Tool RAG persistence**: RAG config (enabled, topK, alwaysInclude, skipUnlimitedProviders) now persists to YAML
- **Tasks bulk clean**: Clean tasks by terminal status (done, failed, cancelled) instead of just done
- **GramJS bot session persistence**: Save/load MTProto session string to avoid re-auth on restart

### Changed
- **Remove "pairing" DM policy**: Simplified to open/allowlist/disabled — pairing was unused
- Dashboard Config page reorganized with Telegram settings section, Cocoon port panel, extended Tool RAG controls
- Setup wizard flow reordered, wallet and modules steps cleaned up
- Dashboard and Config pages restructured for better UX
- Soul editor textarea fills available height

### Fixed
- Select dropdown renders via portal (z-index stacking fix)
- Model selection moved into Provider step (no longer separate Config step)
- Async log pollution during CLI setup suppressed
- Telegram commit notification extra blank lines removed
- owner_id auto-syncs to admin_ids on save

## [0.7.3] - 2026-02-24

### Added
- **Claude Code provider**: Auto-detect OAuth tokens from local Claude Code installation (~/.claude/.credentials.json on Linux/Windows, macOS Keychain) with intelligent caching and 401 retry
- **Reply-to context**: Inject quoted message context into LLM prompt when user replies to a message
- **Fragment auth**: Support Telegram anonymous numbers (+888) via Fragment.com verification
- **7 new Telegram tools** (66 → 73): transcribe-audio, get/delete-scheduled-messages, send-scheduled-now, get-collectible-info, get-admined-channels, set-personal-channel
- **Voice auto-transcription**: Automatic transcription of voice/audio messages in handler
- **Gated provider switch**: Dashboard provider change requires API key validation before applying
- **Shared model catalog**: 60+ models across 11 providers, extracted to `model-catalog.ts` (eliminates ~220 duplicated lines)

### Fixed
- **TEP-74 encoding**: Correct jetton transfer payload encoding and infrastructure robustness
- Replace deprecated `claude-3-5-haiku` with `claude-haiku-4-5`
- Seed phrase display in CLI setup
- Bump pi-ai 0.52 → 0.54, hono 4.11.9 → 4.12.2, ajv 8.17.1 → 8.18.0

## [0.7.2] - 2026-02-23

### Fixed
- **Plugins route**: WebUI now reflects runtime-loaded plugins instead of static config

## [0.7.1] - 2026-02-23

### Added
- **Agent Run/Stop control**: Separate agent lifecycle from WebUI — start/stop the agent at runtime without killing the server. New `AgentLifecycle` state machine (`stopped/starting/running/stopping`), REST endpoints (`POST /api/agent/start`, `/stop`, `GET /api/agent/status`), SSE endpoint (`GET /api/agent/events`) for real-time state push, `useAgentStatus` hook (SSE + polling fallback), and `AgentControl` sidebar component with confirmation dialog
- **MCP Streamable HTTP transport**: `StreamableHTTPClientTransport` as primary transport for URL-based MCP servers, with automatic fallback to `SSEClientTransport` on failure. `mcpServers` list is now a lazy function for live status. Resource cleanup (AbortController, sockets) on fallback. Improved error logging with stack traces

### Fixed
- **WebUI setup wizard**: Neutralize color accent overuse — selection states, warning cards, tag pills, step dots all moved to neutral white/grey palette; security notice collapsed into `<details>`; "Optional Integrations" renamed to "Optional API Keys"; bot token marked as "(recommended)"
- **Jetton send**: Wrap entire `sendJetton` flow in try/catch for consistent `PluginSDKError` propagation; remove `SendMode.IGNORE_ERRORS` (errors are no longer silently swallowed); fix `||` → `??` on jetton decimals (prevents `0` decimals being replaced by `9`)

## [0.7.0] - 2026-02-21

### Added
- **WebUI Setup Wizard**: 6-step guided onboarding flow (Welcome, Provider, Telegram, Config, Wallet, Connect) with shared Shell sidebar layout, React context state management, server-side validation mirror, and "Start Agent" button with seamless setup-to-dashboard transition
- **Local LLM Provider**: New "local" provider for OpenAI-compatible servers (Ollama, vLLM, LM Studio, llama.cpp) with auto-model discovery from `/models` endpoint, CLI `--base-url` option, and WebUI provider card
- `getEffectiveApiKey()` helper for consistent API key resolution across all LLM call sites
- ASCII banner for `teleton setup --ui` matching `teleton start`
- 86 setup route tests + 39 validation tests (898 total tests)

### Fixed
- **Security audit remediation (27 fixes)**: MCP env var blocklist, sendStory symlink-safe path validation (realpathSync), DB ATTACH/DETACH proxy for plugin isolation, BigInt float precision (string-based decimals), debounce clamp, SendMode.IGNORE_ERRORS removed, URL quote escaping, wallet JSON validation, pino redact, and more
- `fetchWithTimeout` (10s) + http/https scheme validation on local model discovery
- Model array capped to 500 entries to prevent unbounded growth
- Early exit when provider=local but `base_url` missing
- Non-interactive onboarding: relaxed `--api-key` for local/cocoon providers
- WebUI UX: CSS specificity fixes, bot token inline field, wallet address prominent display, TonAPI/Tavily as plain optional fields

## Note — 2026-02-21

Git history rewritten to fix commit attribution (email update from `tonresistor@github.com` to the account owner's actual email). All commit hashes changed; code, dates, and messages are identical. Tags re-pointed to new hashes. Force-pushed to origin. No code or functionality was affected.

## [0.6.0] - 2026-02-20

### Added
- **Cocoon Network** proxy-only LLM provider with XML tool injection
- **Moonshot** (Kimi K2.5 / K2 Thinking) LLM provider
- **Mistral** LLM provider
- **Pino structured logging** — migrated from console.* across entire codebase
- **MCP client support** with CLI management commands (`teleton mcp add/remove/list`)
- **Plugin Marketplace** with secrets management and download functionality
- **WebUI**: Config + MCP pages, custom Select component, centralized CSS
- **WebUI**: accordion UI, dashboard settings
- **Tool RAG**, web tools, and admin enhancements

### Changed
- Type safety overhaul: reduced `as any` from 135 to 32 instances
- Setup wizard migrated to `@inquirer/prompts` with auto-resolve owner
- All dependencies upgraded to latest versions

### Fixed
- Data integrity and cleanup from full audit

## [0.5.2] - 2026-02-16

### Added
- Auto-install npm dependencies for plugins on load

### Fixed
- Robust local embedding model loading (ONNX cache dir fix for global installs)

### Removed
- Dead dependencies from package.json
- Obsolete TGAPI.md documentation file

## [0.5.1] - 2026-02-16

### Changed
- CI/CD pipelines for SDK, WebUI, and Docker builds

## [0.5.0] - 2026-02-16

### Added
- Data-bearing tool categories with strict DB row types
- Plugin event hooks: `onMessage` and `onCallbackQuery`
- WebUI: inline dropdown task details with overflow fix
- WebUI: auth system, dashboard, tool config, plugins page, and documentation pages
- Plugin SDK expansion to 53 methods

### Changed
- RAG rebalancing for improved search relevance
- Core hardening and open-source cleanup
- Plugin SDK extraction to standalone package

### Fixed
- Key caching, transaction reliability, debouncer, and market extraction

## [0.4.0] - 2026-02-14

### Added
- Plugin SDK with namespaced services (`sdk.ton`, `sdk.telegram`, `sdk.db`)
- DeDust prices and token-info tools
- `/task` admin command connected to scheduled task system
- Local embeddings with hybrid vector search (sqlite-vec + FTS5)
- Casino extracted as external plugin

### Changed
- DEX tools reorganized by provider with scope security enforcement
- Memory init deduplicated, using `isVectorSearchReady()`
- System prompts hardened with memory size management
- Crypto-safe `randomId` used across codebase

### Fixed
- sqlite-vec startup logs no longer print before ASCII banner
- ChatId validation prevents entity resolution crashes on display names
- `DELETE+INSERT` for vec0 tables (upsert is unsupported)
- Auto-migrate legacy plugin data from `memory.db` on first startup
- Plugin SDK hardened: escape hatch removed, timeouts and cleanup added
- Sender ID always included for unambiguous user identification

### Removed
- Built-in casino module (replaced by external plugin)

## [0.3.0] - 2026-02-13

### Added
- Local ONNX embeddings (`Xenova/all-MiniLM-L6-v2`)
- Hybrid vector + FTS5 search for RAG

### Fixed
- Docker image name corrected in README
- Guard against undefined model from `pi-ai getModel()`
- Bot messages ignored in DMs to prevent bot-to-bot loops

## [0.2.5] - 2026-02-12

### Added
- Per-group module permissions with `/modules` admin command
- Swap tools allowed in groups with module level display

### Fixed
- `/clear` command crashing on missing vec0 table
- Post-audit hardening: timeouts, seqno race, cached endpoints
- Bot token made mandatory when deals module is enabled

### Removed
- Unused `@tonkite/highload-wallet-v3` dependency

## [0.2.4] - 2026-02-10

### Fixed
- Memory database properly closed on shutdown
- Atomic deal state guards prevent race conditions

## [0.2.3] - 2026-02-10

### Fixed
- MarketPriceService crash on fresh installs

## [0.2.2] - 2026-02-10

### Fixed
- Peer cache used in `bridge.getMessages` for reliable entity resolution

## [0.2.1] - 2026-02-10

### Changed
- Tool registration decentralized into co-located `ToolEntry` arrays

### Fixed
- Cached peer entity used in get-history for reliable channel resolution
- Mention detection fallback and duplicate message guard

## [0.2.0] - 2026-02-10

### Changed
- Deals and market extracted into standalone modules
- Gemini schema sanitizer for Google provider compatibility
- Casino extracted into self-contained plugin module

### Removed
- Dead casino files (game-executor, validators)

## [0.1.21] - 2026-02-09

### Added
- Prompt injection defense and tool context scoping

### Fixed
- `clearHistory` order, cached endpoint, tasks index
- `install.sh` reads from `/dev/tty` and uses lowercase Docker image name

### Removed
- Jackpot system removed entirely

## [0.1.20] - 2026-02-09

### Added
- `getTonPrice()` caching with 30-second TTL
- Completed deals logged to business journal
- Transcript files older than 30 days cleaned up at startup

### Fixed
- Shallow copy returned from `getTonPrice` cache

## [0.1.19] - 2026-02-08

### Fixed
- Folder IDs start at 2 (IDs 0-1 reserved by Telegram)
- `GetDialogFilters` returning object instead of array
- `DialogFilter` title wrapped in `TextWithEntities` for GramJS layer 222+
- Atomic status preconditions added to deal verify-payment

## [0.1.18] - 2026-02-08

### Added
- Optimized runtime logs and TonAPI rate limiting

## [0.1.17] - 2026-02-08

### Added
- `/boot` admin command for agent bootstrap

### Fixed
- Deals and Market merged into single module option
- Imperative placeholders removed from MEMORY.md template

## [0.1.16] - 2026-02-08

### Fixed
- Agent empty response when `memory_write` is the only tool call
- @ston-fi bundled with all transitive deps via external blacklist

## [0.1.15] - 2026-02-08

### Fixed
- @ston-fi bundled with all transitive dependencies

## [0.1.10 - 0.1.14] - 2026-02-08

### Fixed
- Repeated @ston-fi bundling and dependency resolution fixes
- `postinstall` script removed to avoid preinstall blocker

## [0.1.9] - 2026-02-08

### Fixed
- @ston-fi/api bundled to avoid pnpm-only install blocker

## [0.1.8] - 2026-02-08

### Fixed
- `scripts/` directory copied in Dockerfile build stage

## [0.1.7] - 2026-02-08

### Fixed
- Docker build issues resolved

## [0.1.6] - 2026-02-08

### Added
- First public npm release with Docker support

### Fixed
- Docker build failing due to husky in production install
- Docker tags lowercased, release decoupled from Docker

## [0.1.4 and earlier] - 2026-02-08

### Added
- Initial release of Teleton Agent
- Autonomous Telegram AI agent with TON blockchain integration
- Multi-provider LLM support (Anthropic, OpenAI, Google, xAI, Groq, OpenRouter)
- Deals system with inline bot, payment verification, and auto-execution
- Styled inline buttons and custom emoji via MTProto layer 222 patch
- Interactive setup wizard with wallet safety and model selection
- Admin commands: `/model`, `/policy`, `/pause`, `/resume`, `/wallet`, `/stop`, `/loop`
- TonAPI key support for higher rate limits
- Professional distribution (npm, Docker, CI/CD)
- Pre-commit hooks and linting infrastructure

[Unreleased]: https://github.com/TONresistor/teleton-agent/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/TONresistor/teleton-agent/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/TONresistor/teleton-agent/compare/v0.8.6...v0.9.0
[0.8.6]: https://github.com/TONresistor/teleton-agent/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/TONresistor/teleton-agent/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/TONresistor/teleton-agent/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/TONresistor/teleton-agent/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/TONresistor/teleton-agent/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/TONresistor/teleton-agent/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/TONresistor/teleton-agent/compare/v0.7.5...v0.8.0
[0.7.5]: https://github.com/TONresistor/teleton-agent/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/TONresistor/teleton-agent/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/TONresistor/teleton-agent/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/TONresistor/teleton-agent/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/TONresistor/teleton-agent/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/TONresistor/teleton-agent/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/TONresistor/teleton-agent/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/TONresistor/teleton-agent/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/TONresistor/teleton-agent/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/TONresistor/teleton-agent/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/TONresistor/teleton-agent/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TONresistor/teleton-agent/compare/v0.2.5...v0.3.0
[0.2.5]: https://github.com/TONresistor/teleton-agent/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/TONresistor/teleton-agent/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/TONresistor/teleton-agent/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/TONresistor/teleton-agent/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/TONresistor/teleton-agent/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/TONresistor/teleton-agent/compare/v0.1.21...v0.2.0
[0.1.21]: https://github.com/TONresistor/teleton-agent/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/TONresistor/teleton-agent/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/TONresistor/teleton-agent/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/TONresistor/teleton-agent/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/TONresistor/teleton-agent/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/TONresistor/teleton-agent/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/TONresistor/teleton-agent/compare/v0.1.14...v0.1.15
[0.1.10 - 0.1.14]: https://github.com/TONresistor/teleton-agent/compare/v0.1.9...v0.1.14
[0.1.9]: https://github.com/TONresistor/teleton-agent/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/TONresistor/teleton-agent/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/TONresistor/teleton-agent/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/TONresistor/teleton-agent/releases/tag/v0.1.6
[0.1.4 and earlier]: https://github.com/TONresistor/teleton-agent/releases/tag/v0.1.6
