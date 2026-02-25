# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/TONresistor/teleton-agent/compare/v0.7.1...HEAD
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
