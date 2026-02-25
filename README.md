<div align="center">
  <h1>NovaPM</h1>
  <p><strong>Next-generation AI-powered process manager for Node.js</strong></p>
  <p>A modern, production-grade replacement for PM2 with AI-driven insights, a beautiful web dashboard, multi-server management, and a plugin ecosystem.</p>

  <p>
    <a href="https://github.com/sitharaj88/novapm/actions/workflows/ci.yml"><img src="https://github.com/sitharaj88/novapm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://www.npmjs.com/package/@novapm/cli"><img src="https://img.shields.io/npm/v/@novapm/cli.svg?color=6c5ce7" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@novapm/cli"><img src="https://img.shields.io/npm/dm/@novapm/cli.svg?color=22d3ee" alt="npm downloads" /></a>
    <a href="https://github.com/sitharaj88/novapm/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-00d68f.svg" alt="License" /></a>
    <a href="https://sitharaj88.github.io/novapm"><img src="https://img.shields.io/badge/docs-novapm.dev-6c5ce7.svg" alt="Documentation" /></a>
    <a href="https://github.com/sitharaj88/novapm"><img src="https://img.shields.io/badge/TypeScript-strict-3b82f6.svg" alt="TypeScript" /></a>
  </p>

  <p>
    <a href="#installation">Installation</a> &bull;
    <a href="#quick-start">Quick Start</a> &bull;
    <a href="#features">Features</a> &bull;
    <a href="#web-dashboard">Dashboard</a> &bull;
    <a href="#cli-commands">CLI</a> &bull;
    <a href="#configuration">Config</a> &bull;
    <a href="#ai-features">AI</a> &bull;
    <a href="#plugins">Plugins</a> &bull;
    <a href="#api">API</a>
  </p>
</div>

---

## Why NovaPM?

| Feature | PM2 | NovaPM |
|---------|-----|--------|
| Process Management | Yes | Yes |
| Cluster Mode | Yes | Yes |
| Log Management | Yes | Enhanced (JSON, rotation, streaming) |
| Web Dashboard | Basic | Real-time, mobile-responsive, dark/light theme |
| AI Anomaly Detection | No | Yes (Z-Score, IQR, Pattern, Rate-of-Change) |
| Auto-Scaling | No | Yes (predictive + threshold-based) |
| Natural Language Ops | No | Yes (OpenAI, Anthropic, Ollama) |
| Plugin System | No | Yes (6 official plugins) |
| Multi-Server | Limited | Full agent-controller architecture |
| Health Checks | Basic | HTTP, TCP, Script-based |
| TypeScript | Partial | Full strict mode |
| Metrics Storage | None | SQLite time-series with downsampling |

## Features

- **Process Management** -- Start, stop, restart, scale, and monitor Node.js (and other) applications
- **Cluster Mode** -- Zero-downtime reloads with Node.js cluster for maximum performance
- **Web Dashboard** -- Beautiful, real-time web UI with charts, logs, dark/light theme, and mobile-responsive design
- **AI-Powered** -- Anomaly detection, auto-scaling, root cause analysis, and natural language ops
- **Multi-Server** -- Manage processes across multiple servers with agent-controller architecture
- **Plugin Ecosystem** -- Extensible with plugins for Slack, Discord, Prometheus, Docker, GitHub, and Email
- **Health Checks** -- HTTP, TCP, and script-based health monitoring with auto-restart
- **Structured Logging** -- JSON logging, log rotation, real-time streaming via WebSocket
- **Metrics & APM** -- CPU, memory, event loop latency with time-series storage and downsampling
- **REST API & WebSocket** -- Full HTTP API and real-time WebSocket endpoints
- **PM2 Compatible** -- Reads `ecosystem.config.js` files for easy migration
- **TypeScript First** -- Built entirely in TypeScript with strict mode

## Installation

```bash
npm install -g @novapm/cli
```

Or with pnpm:

```bash
pnpm add -g @novapm/cli
```

Verify installation:

```bash
nova-pm --version
nova-pm doctor
```

### Requirements

- Node.js 20+
- npm, pnpm, or yarn

## Quick Start

```bash
# Start a process
nova-pm start app.js

# Start with options
nova-pm start server.js --name api --instances 4 --exec-mode cluster

# Start from config file
nova-pm start nova-pm.config.js

# List all processes
nova-pm list

# Monitor in real-time
nova-pm monit

# Open web dashboard
nova-pm dashboard --open

# View logs
nova-pm logs api --follow

# Stop a process
nova-pm stop api

# Restart all processes
nova-pm restart all

# Save and restore processes across reboots
nova-pm save
nova-pm resurrect
```

## Web Dashboard

NovaPM includes a built-in web dashboard with real-time monitoring.

```bash
nova-pm dashboard --open
```

The dashboard runs at `http://localhost:9615` and includes:

- **Dashboard** -- System stats (CPU, memory, uptime), process overview, recent logs
- **Processes** -- Full process management with start, stop, restart, delete actions and confirmation dialogs
- **Logs** -- Real-time log viewer with process filtering and auto-scroll
- **Metrics** -- CPU and memory charts per process with time-range selection
- **Servers** -- Multi-server topology view with health indicators
- **Settings** -- Theme toggle (dark/light), refresh interval, connection status, log viewer lines

### Dashboard Features

- Real-time data via WebSocket
- Dark and light theme with system-aware defaults
- Mobile-responsive layout
- Toast notifications for all actions
- Delete confirmation dialogs
- Live API connection status indicator

## CLI Commands

| Command | Description |
|---------|-------------|
| `nova-pm start <script\|config>` | Start a process or processes from config |
| `nova-pm stop <name\|id\|all>` | Stop a process |
| `nova-pm restart <name\|id\|all>` | Restart a process |
| `nova-pm delete <name\|id\|all>` | Delete a process |
| `nova-pm list` | List all processes |
| `nova-pm info <name\|id>` | Detailed process information |
| `nova-pm logs [name\|id]` | View process logs |
| `nova-pm monit` | Real-time terminal monitoring |
| `nova-pm scale <name\|id> <n>` | Scale process instances |
| `nova-pm save` | Save current process list |
| `nova-pm resurrect` | Restore saved processes |
| `nova-pm startup [platform]` | Generate OS startup script |
| `nova-pm dashboard` | Open web dashboard |
| `nova-pm init` | Generate config file |
| `nova-pm doctor` | Diagnose installation |
| `nova-pm ping` | Check daemon status |

### Start Options

```bash
nova-pm start app.js \
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

Create a `nova-pm.config.js` (or `.ts`, `.json`, `.yaml`) file:

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

NovaPM also supports PM2 `ecosystem.config.js` files for easy migration.

## AI Features

NovaPM includes built-in AI capabilities:

### Anomaly Detection

Automatically detects unusual patterns using multiple statistical methods:

- **Z-Score Detection** -- Flags values >3 standard deviations from rolling mean
- **IQR (Interquartile Range)** -- Robust outlier detection using Q1/Q3 boundaries
- **Moving Average Deviation** -- Detects sudden spikes against exponential moving average
- **Rate of Change** -- Catches rapid increases like memory leaks
- **Pattern Detection** -- Identifies memory leaks, restart loops, error rate spikes

### Auto-Scaling

Dynamically adjusts process instances based on:

- CPU utilization thresholds
- Memory usage patterns
- Historical traffic patterns (time-of-day)
- Predictive scaling using trend analysis

### Performance Advisor

Analyzes application metrics and recommends:

- Optimal instance counts
- Memory limit settings
- Scaling configuration
- Resource allocation

### LLM Integration

Connect to OpenAI, Anthropic, or local Ollama for:

- Natural language infrastructure queries
- Root cause analysis on crashes
- Log analysis and summarization
- Performance recommendations

```bash
nova ask "why did my api server crash at 3am?"
nova ask "what is causing high memory usage on the worker process?"
```

## Plugins

### Official Plugins

| Plugin | Description |
|--------|-------------|
| `@novapm/plugin-slack` | Slack notifications via webhooks |
| `@novapm/plugin-discord` | Discord webhook notifications with rich embeds |
| `@novapm/plugin-email` | Email notifications for critical events |
| `@novapm/plugin-prometheus` | Prometheus metrics exporter |
| `@novapm/plugin-docker` | Docker container awareness |
| `@novapm/plugin-github-deploy` | GitHub webhook deployments |

### Install a Plugin

```bash
nova-pm plugin install @novapm/plugin-slack
```

### Create a Plugin

```bash
nova-pm plugin create my-plugin
```

```typescript
import type { NovaPMPlugin } from '@novapm/plugin-sdk';

const myPlugin: NovaPMPlugin = {
  name: 'my-plugin',
  version: '1.0.0',

  async onInit(context) {
    context.logger.info('Plugin initialized');
  },

  async onProcessCrash(event) {
    // Handle crash notification
  },

  async onMetricsCollected(metrics) {
    // Process metrics
  },
};

export default myPlugin;
```

## Multi-Server Management

Manage processes across multiple servers with agent-controller architecture:

```
┌─────────────────────────┐
│    Controller (Primary)  │
│  - Aggregates metrics    │
│  - Coordinates deploys   │
│  - Serves dashboard      │
└──────────┬──────────────┘
           │
    ┌──────┼──────┐
    │      │      │
  Agent 1  Agent 2  Agent 3
  Server   Server   Server
```

```bash
# On each server, start the agent
nova-pm agent start --controller host:9616

# On the controller
nova-pm server list
nova-pm server status web-01
```

### Deployment Strategies

- **Rolling** -- Deploy one server at a time with health checks
- **Canary** -- Deploy to subset, monitor, then roll out
- **Blue-Green** -- Deploy to standby set, switch traffic

## API

NovaPM exposes a REST API at `http://localhost:9615/api/v1/`:

```
GET    /api/v1/health             # Health check
GET    /api/v1/processes           # List processes
GET    /api/v1/processes/:id       # Process details
POST   /api/v1/processes           # Start process
PUT    /api/v1/processes/:id/restart
PUT    /api/v1/processes/:id/stop
DELETE /api/v1/processes/:id
GET    /api/v1/metrics             # All metrics
GET    /api/v1/metrics/:id         # Process metrics
GET    /api/v1/system              # System info
GET    /api/v1/logs                # All logs
GET    /api/v1/logs/:id            # Process logs
GET    /api/v1/servers             # Connected servers
```

### WebSocket Endpoints

```
ws://localhost:9615/ws/logs       # Real-time log streaming
ws://localhost:9615/ws/metrics    # Real-time metrics
ws://localhost:9615/ws/events     # Process events
```

## Architecture

NovaPM is a monorepo with 13 packages built with pnpm workspaces and Turborepo:

```
packages/
├── shared/       # Types, constants, utilities, Zod schemas
├── core/         # Daemon, process manager, IPC, HTTP API, metrics, logs, dashboard serving
├── cli/          # Command-line interface (16 commands)
├── dashboard/    # Next.js static web dashboard (served from core)
├── ai-engine/    # Anomaly detection, auto-scaling, performance advisor, LLM integration
├── agent/        # Multi-server agent-controller with secure channels
└── plugin-sdk/   # Plugin development SDK with typed hooks

plugins/
├── plugin-slack/           # Slack webhook notifications
├── plugin-discord/         # Discord webhook notifications
├── plugin-email/           # Email notifications
├── plugin-prometheus/      # Prometheus metrics exporter
├── plugin-docker/          # Docker container awareness
└── plugin-github-deploy/   # GitHub webhook deployments
```

### Tech Stack

- **Language:** TypeScript (strict mode)
- **Build:** pnpm workspaces + Turborepo
- **Runtime:** Node.js 20+
- **HTTP Server:** Fastify 5
- **Dashboard:** Next.js 16 (static export) + Zustand + Recharts + Tailwind CSS v4
- **Database:** SQLite (via better-sqlite3)
- **IPC:** Unix domain sockets
- **Testing:** Vitest (1,500+ tests)

## PM2 Migration

NovaPM reads PM2 `ecosystem.config.js` files:

```bash
# Use your existing PM2 config directly
nova-pm start ecosystem.config.js
```

## Development

```bash
# Clone and install
git clone https://github.com/sitharaj88/novapm.git
cd novapm
pnpm install

# Build all packages
pnpm build

# Run tests (1,500+ tests)
pnpm test

# Lint and format
pnpm lint
pnpm format

# Development mode
pnpm dev
```

## Packages

| Package | Description |
|---------|-------------|
| [`@novapm/cli`](https://www.npmjs.com/package/@novapm/cli) | Command-line interface |
| [`@novapm/core`](https://www.npmjs.com/package/@novapm/core) | Core daemon and process manager |
| [`@novapm/shared`](https://www.npmjs.com/package/@novapm/shared) | Shared types, constants, and utilities |
| [`@novapm/ai-engine`](https://www.npmjs.com/package/@novapm/ai-engine) | AI anomaly detection and auto-scaling |
| [`@novapm/agent`](https://www.npmjs.com/package/@novapm/agent) | Multi-server agent |
| [`@novapm/plugin-sdk`](https://www.npmjs.com/package/@novapm/plugin-sdk) | Plugin development SDK |
| [`@novapm/plugin-slack`](https://www.npmjs.com/package/@novapm/plugin-slack) | Slack notifications |
| [`@novapm/plugin-discord`](https://www.npmjs.com/package/@novapm/plugin-discord) | Discord notifications |
| [`@novapm/plugin-email`](https://www.npmjs.com/package/@novapm/plugin-email) | Email notifications |
| [`@novapm/plugin-prometheus`](https://www.npmjs.com/package/@novapm/plugin-prometheus) | Prometheus exporter |
| [`@novapm/plugin-docker`](https://www.npmjs.com/package/@novapm/plugin-docker) | Docker awareness |
| [`@novapm/plugin-github-deploy`](https://www.npmjs.com/package/@novapm/plugin-github-deploy) | GitHub deployments |

## Contributing

Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md) before submitting a pull request.

```bash
# Fork the repo and create your branch
git checkout -b feature/my-feature

# Make changes and run tests
pnpm test
pnpm lint

# Submit a pull request
```

## Support

If you find NovaPM useful, consider supporting the project:

<a href="https://buymeacoffee.com/sitharaj88"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee" /></a>

## Author

**Sitharaj Seenviasan**

- Website: [sitharaj.in](https://sitharaj.in)
- LinkedIn: [linkedin.com/in/sitharaj08](https://linkedin.com/in/sitharaj08)
- GitHub: [@sitharaj88](https://github.com/sitharaj88)
- Buy Me a Coffee: [buymeacoffee.com/sitharaj88](https://buymeacoffee.com/sitharaj88)

## License

[MIT](LICENSE) -- Copyright (c) 2026 Sitharaj Seenviasan
