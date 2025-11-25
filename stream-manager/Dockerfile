# Stream Manager Dockerfile
# Multi-stage build: build frontend and server, then create production image

# ==============================================================================
# Stage 1: Build
# ==============================================================================
FROM node:18-alpine AS builder

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm ci

# Copy source files
COPY tsconfig*.json ./
COPY vite.config.ts ./
COPY src/ ./src/

# Build server (TypeScript -> JavaScript)
RUN npm run build:server

# Build client (Vite -> dist/client)
RUN npm run build:client

# ==============================================================================
# Stage 2: Production
# ==============================================================================
FROM node:18-alpine AS production

WORKDIR /app

# Install wget for health check
RUN apk add --no-cache wget

# Create data directory for SQLite
RUN mkdir -p /data

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Note: Running as root is required to access Docker socket
# In production with proper security, use a dedicated user with docker group membership

# Environment defaults
ENV PORT=3001
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/stream-manager.db
ENV LOG_LEVEL=info

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:3001/api/health || exit 1

# Start the server
CMD ["node", "dist/server/index.js"]
