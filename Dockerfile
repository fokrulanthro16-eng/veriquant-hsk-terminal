# ==============================================================================
# VeriQuant HSK Quant Terminal - Production Multi-Stage Dockerfile
# Optimized for HSK Chain Horizon Hackathon (Mumbai Edition)
# ==============================================================================

# STAGE 1: Builder & Dependency Resolver
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# STAGE 2: Lightweight Production Runtime
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HSK_MAINNET_RPC_URL=https://mainnet.hsk.xyz \
    CHAIN_ID=177

# Create non-root system user for institutional security compliance
RUN addgroup -S veriquant && adduser -S veriquant -G veriquant

# Copy installed production node_modules from builder
COPY --from=builder --chown=veriquant:veriquant /app/node_modules ./node_modules

# Copy application source code
COPY --chown=veriquant:veriquant package.json ./
COPY --chown=veriquant:veriquant server.js ./
COPY --chown=veriquant:veriquant contracts ./contracts
COPY --chown=veriquant:veriquant src ./src
COPY --chown=veriquant:veriquant public ./public
COPY --chown=veriquant:veriquant docs ./docs

# Use non-root user
USER veriquant

# Expose internal execution port
EXPOSE 3000

# Container healthcheck against live telemetry endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/status || exit 1

# Start institutional server
CMD ["node", "server.js"]
