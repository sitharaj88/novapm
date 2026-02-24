<div align="center">
  <h1>NovaPM</h1>
  <p><strong>Next-generation AI-powered process manager</strong></p>
  <p>A modern, production-grade replacement for PM2 with AI-driven insights, a beautiful web dashboard, multi-server management, and a plugin ecosystem.</p>

  <p>
    <a href="#installation">Installation</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#features">Features</a> •
    <a href="#cli-commands">CLI Commands</a> •
    <a href="#configuration">Configuration</a> •
    <a href="#web-dashboard">Dashboard</a> •
    <a href="#ai-features">AI Features</a> •
    <a href="#plugins">Plugins</a>
  </p>

  <p>
    <a href="https://github.com/sitharaj88/novapm/actions/workflows/ci.yml"><img src="https://github.com/sitharaj88/novapm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://www.npmjs.com/package/novapm"><img src="https://img.shields.io/npm/v/novapm.svg" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/novapm"><img src="https://img.shields.io/npm/dm/novapm.svg" alt="npm downloads" /></a>
    <a href="https://github.com/sitharaj88/novapm/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
    <a href="https://novapm.dev"><img src="https://img.shields.io/badge/docs-novapm.dev-purple.svg" alt="Documentation" /></a>
  </p>
</div>

---

## Features

- **Process Management** — Start, stop, restart, scale, and monitor Node.js (and other) applications
- **Cluster Mode** — Zero-downtime reloads with Node.js cluster for maximum performance
- **Web Dashboard** — Beautiful, real-time web UI with charts, logs, and process management
- **AI-Powered** — Anomaly detection, auto-scaling, log analysis, and natural language ops
- **Multi-Server** — Manage processes across multiple servers from a single dashboard
- **Plugin Ecosystem** — Extensible with plugins for Slack, Prometheus, Docker, GitHub, and more
- **Health Checks** — HTTP, TCP, and script-based health monitoring with auto-restart
- **Structured Logging** — JSON logging, log rotation, real-time streaming
- **Metrics & APM** — CPU, memory, event loop, with time-series storage and downsampling
- **PM2 Compatible** — Reads `ecosystem.config.js` files for easy migration
- **TypeScript First** — Built entirely in TypeScript with strict mode

## Installation

```bash
npm install -g novapm
# or
pnpm add -g novapm
```

## Quick Start

```bash
# Start a process
nova start app.js

# Start with options
nova start server.js --name api --instances 4 --exec-mode cluster

# Start from config file
nova start nova.config.js

# List all processes
nova list

# Monitor in real-time
nova monit

# Open web dashboard
nova dashboard --open

# View logs
nova logs api --follow

# Stop a process
nova stop api

# Restart all processes
nova restart all
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `nova start <script\|config>` | Start a process or processes from config |
| `nova stop <name\|id\|all>` | Stop a process |
| `nova restart <name\|id\|all>` | Restart a process |
| `nova delete <name\|id\|all>` | Delete a process |
| `nova list` | List all processes |
| `nova info <name\|id>` | Detailed process information |
| `nova logs [name\|id]` | View process logs |
| `nova monit` | Real-time terminal monitoring |
| `nova scale <name\|id> <n>` | Scale process instances |
| `nova save` | Save current process list |
| `nova resurrect` | Restore saved processes |
| `nova startup [platform]` | Generate OS startup script |
| `nova dashboard` | Open web dashboard |
| `nova init` | Generate config file |
| `nova doctor` | Diagnose installation |
| `nova ping` | Check daemon status |

### Start Options

```bash
nova start app.js \
  --name my-app \
  --instances 4 \
  --exec-mode cluster \
  --watch \
  --max-memory 512M \
  --port 3000 \
  --env production \
  --cron "0 0 * * *" \
  --no-autorestart \
  --interpreter python3
```

## Configuration

Create a `nova.config.js` (or `.ts`, `.json`, `.yaml`) file:

```javascript
export default {
  apps: [
    {
      name: 'api-server',
      script: './src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      port: 3000,
      autorestart: true,
      max_restarts: 16,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      health_check: {
        type: 'http',
        path: '/health',
        port: 3000,
        interval: '30s',
        timeout: '5s',
        retries: 3,
      },
      scaling: {
        min: 2,
        max: 16,
        cpu_threshold: 70,
        cooldown: '5m',
        ai_enabled: true,
      },
      logs: {
        format: 'json',
        rotate: { size: '100M', keep: 10, compress: true },
      },
    },
    {
      name: 'worker',
      script: './src/worker.js',
      instances: 2,
      exec_mode: 'fork',
    },
  ],
  dashboard: {
    enabled: true,
    port: 9615,
  },
  ai: {
    enabled: true,
    anomaly_detection: true,
    auto_scaling: true,
  },
  plugins: [
    { name: '@novapm/plugin-slack', options: { webhookUrl: 'https://...' } },
    { name: '@novapm/plugin-prometheus' },
  ],
};
```

## Web Dashboard

Launch the web dashboard:

```bash
nova dashboard --open
```

The dashboard runs on `http://localhost:9615` and provides:

- **Overview** — System stats, process list, recent logs, AI insights
- **Processes** — Full process management with sorting, filtering, actions
- **Logs** — Real-time log viewer with search and filtering
- **Metrics** — CPU, memory, and custom metrics charts
- **Servers** — Multi-server topology and management
- **AI Insights** — Anomaly timeline, performance recommendations
- **Plugins** — Plugin management and marketplace
- **Settings** — Dashboard and system configuration

## AI Features

NovaPM includes built-in AI capabilities:

### Anomaly Detection
Automatically detects:
- Memory leaks (sustained memory growth)
- CPU spikes (sudden or sustained high CPU)
- Error rate increases
- Latency degradation
- Restart loops

Uses statistical methods: Z-Score, IQR, Moving Average, Rate of Change.

### Auto-Scaling
Dynamically adjusts process instances based on:
- CPU utilization thresholds
- Memory usage
- Historical traffic patterns (time-of-day)
- Predictive scaling

### LLM Integration
Connect to OpenAI, Anthropic, or local Ollama for:
- Natural language infrastructure queries
- Root cause analysis
- Log analysis and summarization
- Performance recommendations

## Plugins

### Official Plugins

| Plugin | Description |
|--------|-------------|
| `@novapm/plugin-slack` | Slack notifications via webhooks |
| `@novapm/plugin-discord` | Discord webhook notifications |
| `@novapm/plugin-prometheus` | Prometheus metrics exporter |
| `@novapm/plugin-docker` | Docker container awareness |
| `@novapm/plugin-github-deploy` | GitHub webhook deployments |
| `@novapm/plugin-email` | Email notifications |

### Install a Plugin

```bash
nova plugin install @novapm/plugin-slack
```

### Create a Plugin

```bash
nova plugin create my-plugin
```

## Multi-Server Management

Manage processes across multiple servers:

```bash
# On each server, start the agent
nova agent start --controller host:9616

# On the controller
nova server list
nova server status web-01
```

Supports deployment strategies:
- **Rolling** — Deploy one server at a time
- **Canary** — Deploy to subset, monitor, then roll out
- **Blue-Green** — Deploy to standby set, switch traffic

## API

NovaPM exposes a REST API at `http://localhost:9615/api/v1/`:

```
GET    /api/v1/processes          # List processes
GET    /api/v1/processes/:id      # Process details
POST   /api/v1/processes          # Start process
PUT    /api/v1/processes/:id/restart
PUT    /api/v1/processes/:id/stop
DELETE /api/v1/processes/:id
GET    /api/v1/metrics            # All metrics
GET    /api/v1/metrics/:id        # Process metrics
GET    /api/v1/system             # System info
GET    /api/v1/logs/:id           # Process logs
GET    /api/v1/health             # Health check
```

WebSocket endpoints for real-time data:
- `ws://localhost:9615/ws/logs` — Log streaming
- `ws://localhost:9615/ws/metrics` — Metrics streaming
- `ws://localhost:9615/ws/events` — Event streaming

## Architecture

```
packages/
├── shared/       # Types, constants, utilities, Zod schemas
├── core/         # Daemon, process manager, IPC, HTTP API, metrics, logs
├── cli/          # Command-line interface (16 commands)
├── dashboard/    # Next.js web dashboard
├── ai-engine/    # Anomaly detection, auto-scaling, LLM integration
├── agent/        # Multi-server agent-controller
└── plugin-sdk/   # Plugin development SDK
plugins/
├── plugin-slack/
├── plugin-discord/
├── plugin-prometheus/
├── plugin-docker/
├── plugin-github-deploy/
└── plugin-email/
```

## PM2 Migration

NovaPM reads PM2 `ecosystem.config.js` files:

```bash
# Use your existing PM2 config
nova start ecosystem.config.js
```

## Development

```bash
# Clone and install
git clone https://github.com/sitharaj88/novapm.git
cd novapm
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Development mode
pnpm dev
```

## Requirements

- Node.js 20+
- pnpm 9+

## License

[MIT](LICENSE) - Copyright (c) 2025-present Sitharaj Seenviasan
