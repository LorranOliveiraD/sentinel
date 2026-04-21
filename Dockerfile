# ─────────────────────────────────────────────
# Sentinel V3 — Multi-stage Dockerfile
# ─────────────────────────────────────────────

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built JavaScript
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite (dev)
RUN mkdir -p data

# Non-root user for security
RUN addgroup -g 1001 sentinel && \
    adduser -u 1001 -G sentinel -s /bin/sh -D sentinel && \
    chown -R sentinel:sentinel /app

USER sentinel

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
