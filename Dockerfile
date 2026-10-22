# ---- Build stage ----
FROM node:22.23.4-slim AS build

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files and SDK workspace (needed for workspace resolution)
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/

# Install all deps (including devDependencies for build + SDK workspace)
RUN npm ci

# Copy source, build configs, and full SDK source
COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
COPY packages/ packages/

# Copy frontend source and install its deps
COPY web/ web/
RUN cd web && npm ci

# Build everything: SDK → backend (tsup) → frontend (vite)
RUN npm run build

# ---- Runtime stage ----
FROM node:22.23.4-slim

WORKDIR /app

# Copy package files and install production deps only.
# Keep a toolchain available during installation for native addons, then purge it.
COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm pkg delete scripts.prepare \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled code, bin wrapper, and templates
COPY --from=build /app/dist/ dist/
COPY bin/ bin/
COPY src/templates/ src/templates/

# Data directory for persistence
ENV TELETON_HOME=/data
VOLUME /data

# Run as non-root
RUN chown -R node:node /app
USER node

# Verify the installed production addons and CLI as the runtime user.
RUN node --input-type=module -e "import Database from 'better-sqlite3'; import * as vec from 'sqlite-vec'; const db = new Database(':memory:'); vec.load(db); if (!db.prepare('SELECT vec_version() AS version').get().version) throw new Error('sqlite-vec unavailable'); db.exec('CREATE TABLE smoke(value INTEGER)'); db.prepare('INSERT INTO smoke VALUES (?)').run(1); if (db.prepare('SELECT value FROM smoke').get().value !== 1) throw new Error('SQLite query failed'); db.close();" \
    && node dist/cli/index.js --help

# WebUI port (when enabled)
EXPOSE 7777

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["start"]
