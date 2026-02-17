# Deployment Guide

This guide covers every method of deploying Teleton Agent, from a quick global install to production-grade Docker and systemd setups.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Method 1: npm Global Install](#method-1-npm-global-install)
- [Method 2: Docker](#method-2-docker)
- [Method 3: Docker Compose](#method-3-docker-compose)
- [Method 4: From Source](#method-4-from-source)
- [systemd Service (VPS)](#systemd-service-vps)
- [Environment Variables](#environment-variables)
- [Health Check](#health-check)
- [Backup Strategy](#backup-strategy)
- [Updating](#updating)

---

## Prerequisites

Before deploying, make sure you have:

1. **Node.js 20+** (required by the `engines` field in `package.json`)
2. **npm** (ships with Node.js)
3. **Telegram API credentials** -- obtain `api_id` and `api_hash` from [my.telegram.org/apps](https://my.telegram.org/apps)
4. **LLM API key** -- from your chosen provider (Anthropic, OpenAI, Google, xAI, Groq, or OpenRouter)
5. **Build tools** (only for source/Docker builds) -- `python3`, `make`, `g++` for native modules (`better-sqlite3`)

---

## Method 1: npm Global Install

The simplest deployment path. Suitable for personal use and quick testing.

```bash
# Install globally
npm install -g teleton

# Run the interactive setup wizard
teleton setup

# Start the agent
teleton start
```

The setup wizard will:
- Prompt for your Telegram API credentials
- Prompt for your LLM provider and API key
- Generate a TON wallet (or let you import one)
- Create `~/.teleton/config.yaml`

### First Run Authentication

On first launch, Telegram will send a login code to your phone. Enter it when prompted. If you have 2FA enabled, you will also be prompted for your password. After successful authentication, a session file is saved at `~/.teleton/` and subsequent launches will not require re-authentication.

---

## Method 2: Docker

The official Docker image is available on GitHub Container Registry.

### Pull and Run

```bash
docker run -d \
  --name teleton \
  --restart unless-stopped \
  -v teleton-data:/data \
  -p 7777:7777 \
  ghcr.io/tonresistor/teleton-agent
```

### Image Details

The Docker image uses a multi-stage build:

- **Build stage**: Node.js 20-slim with build tools (`python3`, `make`, `g++`), compiles the full project (SDK, backend via tsup, frontend via Vite)
- **Runtime stage**: Node.js 20-slim with production dependencies only. Build tools are purged after native module compilation
- **Data volume**: Mounted at `/data` (set via `TELETON_HOME=/data` in the image)
- **Entrypoint**: `node dist/cli/index.js`
- **Default command**: `start`
- **Exposed port**: `7777` (WebUI, when enabled)
- **Runs as**: non-root `node` user

### Interactive Setup with Docker

Since the first run requires interactive authentication with Telegram, run setup interactively first:

```bash
# Run setup interactively
docker run -it --rm \
  -v teleton-data:/data \
  ghcr.io/tonresistor/teleton-agent setup

# Then start the agent
docker run -d \
  --name teleton \
  --restart unless-stopped \
  -v teleton-data:/data \
  -p 7777:7777 \
  ghcr.io/tonresistor/teleton-agent
```

### Passing Configuration via Environment

For CI/CD and container orchestration, pass credentials as environment variables rather than baking them into a config file:

```bash
docker run -d \
  --name teleton \
  --restart unless-stopped \
  -e TELETON_API_KEY="sk-ant-..." \
  -e TELETON_TG_API_ID="12345678" \
  -e TELETON_TG_API_HASH="0123456789abcdef" \
  -e TELETON_TG_PHONE="+1234567890" \
  -e TELETON_WEBUI_ENABLED="true" \
  -v teleton-data:/data \
  -p 7777:7777 \
  ghcr.io/tonresistor/teleton-agent
```

Note: A `config.yaml` must still exist in the data volume with at minimum the non-overridden fields. Run `setup` first to create it.

---

## Method 3: Docker Compose

A practical `docker-compose.yml` for production deployment:

```yaml
version: "3.8"

services:
  teleton:
    image: ghcr.io/tonresistor/teleton-agent:latest
    container_name: teleton
    restart: unless-stopped
    ports:
      - "7777:7777"  # WebUI (remove if not using)
    volumes:
      - teleton-data:/data
    environment:
      - TELETON_WEBUI_ENABLED=true
      - TELETON_WEBUI_HOST=0.0.0.0  # Bind to all interfaces inside container
      # Optionally override credentials via env vars:
      # - TELETON_API_KEY=sk-ant-...
      # - TELETON_TG_API_ID=12345678
      # - TELETON_TG_API_HASH=0123456789abcdef
      # - TELETON_TG_PHONE=+1234567890

volumes:
  teleton-data:
    driver: local
```

### Using a Host Directory Instead of a Named Volume

If you prefer direct access to the data directory (for easier backups or config editing):

```yaml
volumes:
  - ~/.teleton:/data
```

### Commands

```bash
# Initial setup (interactive)
docker compose run --rm teleton setup

# Start in background
docker compose up -d

# View logs
docker compose logs -f teleton

# Stop
docker compose down

# Update to latest image
docker compose pull && docker compose up -d
```

---

## Method 4: From Source

For development or when you need to customize the agent.

```bash
# Clone the repository
git clone https://github.com/TONresistor/teleton-agent.git
cd teleton-agent

# Install dependencies (includes SDK workspace)
npm install

# Install frontend dependencies
cd web && npm install && cd ..

# Build everything: SDK -> backend (tsup) -> frontend (Vite)
npm run build

# Run setup wizard
node dist/cli/index.js setup

# Start the agent
node dist/cli/index.js start
```

### Development Mode

For active development with auto-reload:

```bash
# Backend with tsx watch
npm run dev

# Frontend dev server (separate terminal)
npm run dev:web
```

### Build Structure

The build process (`npm run build`) runs three steps in sequence:

1. `build:sdk` -- Compiles the `@teleton-agent/sdk` package in `packages/sdk/`
2. `build:backend` -- Compiles the main application with `tsup` to `dist/`
3. `build:web` -- Compiles the React frontend with Vite to `dist/web/`

The backend must build before the frontend because tsup cleans the output folder.

---

## systemd Service (VPS)

For running Teleton Agent as a persistent service on a Linux VPS.

### Create the Service File

```ini
# /etc/systemd/system/teleton.service

[Unit]
Description=Teleton AI Agent for Telegram
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=teleton
Group=teleton
WorkingDirectory=/home/teleton

# Using global npm install
ExecStart=/usr/bin/teleton start

# Or using source install:
# ExecStart=/usr/bin/node /home/teleton/teleton-agent/dist/cli/index.js start

Restart=on-failure
RestartSec=10

# Environment
Environment=NODE_ENV=production
Environment=TELETON_HOME=/home/teleton/.teleton
# Environment=TELETON_WEBUI_ENABLED=true

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/teleton/.teleton
PrivateTmp=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=teleton

[Install]
WantedBy=multi-user.target
```

### Enable and Start

```bash
# Create a dedicated user
sudo useradd -r -m -s /bin/bash teleton

# Copy config to the user's home
sudo -u teleton mkdir -p /home/teleton/.teleton
sudo cp ~/.teleton/config.yaml /home/teleton/.teleton/
sudo chown -R teleton:teleton /home/teleton/.teleton

# Install teleton globally (as root or with sudo)
sudo npm install -g teleton

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable teleton
sudo systemctl start teleton

# Check status
sudo systemctl status teleton

# View logs
sudo journalctl -u teleton -f
```

---

## Environment Variables

Complete list of environment variables recognized by Teleton Agent:

| Variable | Purpose | Default |
|----------|---------|---------|
| `TELETON_HOME` | Root data directory | `~/.teleton` |
| `TELETON_API_KEY` | LLM provider API key | from config |
| `TELETON_TG_API_ID` | Telegram API ID | from config |
| `TELETON_TG_API_HASH` | Telegram API hash | from config |
| `TELETON_TG_PHONE` | Telegram phone number | from config |
| `TELETON_WEBUI_ENABLED` | Enable WebUI (`"true"` / `"false"`) | from config |
| `TELETON_WEBUI_PORT` | WebUI port | `7777` |
| `TELETON_WEBUI_HOST` | WebUI bind address | `127.0.0.1` |
| `DEBUG` | Enable debug logging | unset |
| `VERBOSE` | Enable verbose logging | unset |
| `NODE_ENV` | Node.js environment | `"development"` |

Environment variables always take precedence over `config.yaml` values.

---

## Health Check

When the WebUI is enabled, a health endpoint is available:

```bash
curl http://localhost:7777/health
```

This can be used in Docker health checks:

```yaml
services:
  teleton:
    # ...
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7777/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

Or in Kubernetes liveness/readiness probes.

---

## Backup Strategy

All persistent data is stored in the `~/.teleton/` directory (or `TELETON_HOME`). Regular backups of this directory are sufficient for full recovery.

### Critical Files

| Path | Contents | Sensitivity |
|------|----------|-------------|
| `config.yaml` | All configuration | Contains API keys |
| `wallet.json` | TON wallet mnemonic + keys | **Highly sensitive** (0600 perms) |
| `teleton_session/` | Telegram session | Grants account access |
| `memory.db` | Conversation memory + sessions (SQLite) | Contains chat history |
| `plugins/` | Installed plugins | Reproducible |
| `plugins/data/` | Plugin databases + secrets | May contain sensitive data |
| `workspace/` | Agent workspace files | User content |

### Backup Commands

```bash
# Simple backup
tar -czf teleton-backup-$(date +%Y%m%d).tar.gz ~/.teleton/

# Exclude transient files
tar -czf teleton-backup-$(date +%Y%m%d).tar.gz \
  --exclude='*.db-wal' \
  --exclude='*.db-shm' \
  ~/.teleton/

# Restore
tar -xzf teleton-backup-20260216.tar.gz -C ~/
```

### Docker Volume Backup

```bash
# Stop the container first for consistency
docker compose stop teleton

# Backup the volume
docker run --rm \
  -v teleton-data:/data \
  -v $(pwd):/backup \
  alpine tar -czf /backup/teleton-backup-$(date +%Y%m%d).tar.gz -C /data .

# Restart
docker compose start teleton
```

---

## Updating

### npm Global Install

```bash
npm update -g teleton
# Or install a specific version:
npm install -g teleton@0.5.2
```

### Docker

```bash
docker pull ghcr.io/tonresistor/teleton-agent:latest
docker stop teleton && docker rm teleton
docker run -d \
  --name teleton \
  --restart unless-stopped \
  -v teleton-data:/data \
  -p 7777:7777 \
  ghcr.io/tonresistor/teleton-agent
```

Or with Docker Compose:

```bash
docker compose pull
docker compose up -d
```

### From Source

```bash
cd teleton-agent
git pull origin main
npm install
cd web && npm install && cd ..
npm run build
# Restart the agent
```

### Version Pinning

For production stability, pin to a specific version tag:

```bash
# Docker
ghcr.io/tonresistor/teleton-agent:v0.5.2

# npm
npm install -g teleton@0.5.2
```
