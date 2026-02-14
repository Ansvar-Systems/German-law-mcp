# ─────────────────────────────────────────────────────────────────────────────
# German Law MCP — multi-stage Dockerfile
# ─────────────────────────────────────────────────────────────────────────────
# Build:  docker build -t german-law-mcp .
# Run:    docker run --rm -i german-law-mcp
#
# The image expects a pre-built database at /app/data/database.db.
# Override with GERMAN_LAW_DB_PATH for a custom location.
# ─────────────────────────────────────────────────────────────────────────────

# --- Stage 1: Build TypeScript ---
FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# --- Stage 2: Production ---
FROM node:20-slim AS production

WORKDIR /app
ENV NODE_ENV=production
ENV GERMAN_LAW_DB_PATH=/app/data/database.db

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist/ dist/

# Copy pre-built database (must exist at build time)
COPY data/database.db data/database.db

# Non-root user for security
RUN addgroup --system --gid 1001 mcp && \
    adduser --system --uid 1001 --ingroup mcp mcp && \
    chown -R mcp:mcp /app
USER mcp

# Health check: verify database is readable
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const D=require('@ansvar/mcp-sqlite');const d=new D(process.env.GERMAN_LAW_DB_PATH||'/app/data/database.db',{readonly:true});d.prepare('SELECT 1').get();d.close();console.log('ok')"

ENTRYPOINT ["node", "dist/src/index.js"]
