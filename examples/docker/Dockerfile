# ---------------------------------------------------------------------------
# NovaPM Docker Example - Multi-stage Production Build
# ---------------------------------------------------------------------------
# Build:  docker build -t my-novapm-app .
# Run:    docker run -d -p 3000:3000 -p 9615:9615 --name my-app my-novapm-app
# ---------------------------------------------------------------------------

# =========================
# Stage 1 - Build
# =========================
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /build

# Install dependencies first (layer cache optimisation)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm run build

# Prune dev dependencies so only production deps remain
RUN pnpm prune --prod

# =========================
# Stage 2 - Production
# =========================
FROM node:20-alpine AS production

# Install tini for proper PID 1 signal handling inside containers
RUN apk add --no-cache tini curl

# Install NovaPM globally so the `nova` CLI is on the PATH
RUN npm install -g @novapm/cli

# Create a non-root user
RUN addgroup -S novapm && adduser -S novapm -G novapm

WORKDIR /app

# Copy production node_modules and built artefacts from the builder stage
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package.json ./

# Copy the NovaPM config and application entry point
COPY nova-pm.config.js ./
COPY app.js ./

# Create log directory and set ownership
RUN mkdir -p /app/logs && chown -R novapm:novapm /app

USER novapm

# Expose application and dashboard ports
EXPOSE 3000
EXPOSE 9615

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000

# Health check - verify that the NovaPM daemon is alive
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD nova-pm ping || exit 1

# Use tini as init to forward signals correctly to NovaPM
ENTRYPOINT ["/sbin/tini", "--"]

# Start all processes defined in nova-pm.config.js (--no-daemon keeps the
# container alive; NovaPM runs in the foreground)
CMD ["nova-pm", "start", "nova-pm.config.js", "--no-daemon"]
