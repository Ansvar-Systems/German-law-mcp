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

# Health check: verify HTTP server responds
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "dist/src/http-server.js"]
