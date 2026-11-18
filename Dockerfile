# syntax=docker/dockerfile:1.7

# ============================================================================
# Stage 1: Install dependencies & build Vite production frontend
# ============================================================================
FROM oven/bun:1-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src

RUN bun run build

# ============================================================================
# Stage 2: Production runtime dependencies only
# ============================================================================
FROM oven/bun:1-alpine AS prod-deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ============================================================================
# Stage 3: Minimal production runtime image
# ============================================================================
FROM oven/bun:1-alpine AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="OpenVolley" \
      org.opencontainers.image.description="Self-hosted real-time volleyball live score, symmetric tournament bracket, Arena TV display, and client-side broadcast Media Studio." \
      org.opencontainers.image.source="https://github.com/ardianryan/OpenVolley" \
      org.opencontainers.image.licenses="Apache-2.0 WITH Commons-Clause"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun package.json ./
COPY --chown=bun:bun public ./public
COPY --chown=bun:bun src/server ./src/server
COPY --chown=bun:bun src/shared ./src/shared

# Persistent volume directory for SQLite WAL database & local fallback uploads
RUN mkdir -p /app/data && chown bun:bun /app /app/data

USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/public/health').catch(() => null); process.exit(r && r.ok ? 0 : 1);"

CMD ["bun", "src/server/index.ts"]
