# Contributing to Teleton Agent

Thank you for your interest in contributing to Teleton Agent. This guide covers everything you need to get started.

## Table of Contents

- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Development Setup](#development-setup)
- [Branch Strategy](#branch-strategy)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Plugin Development](#plugin-development)
- [Code of Conduct](#code-of-conduct)

## Reporting Bugs

Open a [GitHub Issue](https://github.com/TONresistor/teleton-agent/issues/new?template=bug_report.md) using the bug report template. Include:

- A clear description of the problem
- Steps to reproduce
- Expected vs. actual behavior
- Environment details (OS, Node.js version, teleton version, LLM provider)

Search [existing issues](https://github.com/TONresistor/teleton-agent/issues) first to avoid duplicates.

## Suggesting Features

Open a [GitHub Issue](https://github.com/TONresistor/teleton-agent/issues/new?template=feature_request.md) using the feature request template. Describe the use case, your proposed solution, and any alternatives you considered.

## Development Setup

```bash
git clone https://github.com/TONresistor/teleton-agent.git
cd teleton-agent
npm install
npm run dev
```

This starts the agent in watch mode with automatic restarts on file changes.

### Prerequisites

- **Node.js 20.0.0+** ([download](https://nodejs.org/))
- **npm 9+** (ships with Node.js)
- An LLM API key (Anthropic, OpenAI, Google, xAI, Groq, or OpenRouter)
- Telegram API credentials from [my.telegram.org/apps](https://my.telegram.org/apps)

### Useful Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in watch mode (tsx) |
| `npm run build` | Build backend (tsup) + frontend (vite) |
| `npm run typecheck` | Type checking (`tsc --noEmit`) |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format with Prettier |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |

## Branch Strategy

- **`main`** is the stable release branch. Tags and releases are cut from `main` only.
- **`dev`** is the integration branch for ongoing work.
- Feature branches are created from `dev` and merged back into `dev` via squash merge.
- `dev` is periodically squash-merged into `main` for releases.

```
feature/my-change  -->  dev  -->  main  -->  v0.6.0 (tag)
```

## Making Changes

1. **Fork** the repository and clone your fork.
2. **Create a branch** from `dev`:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/my-change
   ```
3. **Make your changes.** Keep commits focused on a single logical change.
4. **Write commit messages** in imperative mood, concise and descriptive:
   ```
   feat: add DNS record caching for faster lookups
   fix: prevent double-send on FloodWaitError retry
   docs: update plugin SDK examples
   ```
5. **Verify your changes** before pushing:
   ```bash
   npm run typecheck
   npm run lint:fix && npm run format
   npm test
   ```

## Pull Request Process

1. Push your branch to your fork.
2. Open a Pull Request **against `dev`** (not `main`).
3. Fill out the PR template completely.
4. Ensure all CI checks pass (type checking, linting, tests).
5. A maintainer will review your PR. Address any requested changes.
6. Once approved, your PR will be squash-merged into `dev`.

### PR Guidelines

- Keep PRs focused. One PR per feature or fix.
- Include tests for new functionality when applicable.
- Update documentation if you change user-facing behavior.
- Do not include unrelated formatting changes or refactors.

## Code Style

The project uses **ESLint** and **Prettier** with pre-configured rules. A pre-commit hook (via Husky + lint-staged) runs automatically on staged files.

To manually check and fix:

```bash
npm run lint:fix && npm run format
```

Key conventions:

- TypeScript strict mode
- ES modules (`import`/`export`, not `require`)
- Explicit return types on exported functions
- Use `zod` for runtime validation of external inputs

## Plugin Development

Plugins extend the agent with custom tools without modifying core code. See the [Plugin SDK documentation](plugins.md) for a complete guide, or refer to the plugin example in the [README](README.md#plugins).

Plugins are loaded from `~/.teleton/plugins/` at startup -- no rebuild required.

---

Questions? Reach out on Telegram: [@ResistanceForum](https://t.me/ResistanceForum) or open a [discussion](https://github.com/TONresistor/teleton-agent/issues).
