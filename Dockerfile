# ---- Build stage ----
FROM node:20-slim AS build

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files first (layer caching)
COPY package.json package-lock.json ./

# Install all deps (including devDependencies for build)
RUN npm ci

# Copy source and build
COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN npm run build

# ---- Runtime stage ----
FROM node:20-slim

WORKDIR /app

# Runtime deps for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Install playwright chromium (for market scraper)
RUN npx playwright install --with-deps chromium

# Remove build tools (no longer needed)
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

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

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["start"]
