# Changelog

All notable changes to the NovaPM project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-24

### Added

#### Phase 1 - Core Foundation
- **@novapm/shared**: Shared types, Zod schemas, constants, error classes, and utility functions
- **@novapm/core**: Process lifecycle management with `ProcessManager` and `ProcessContainer`
- **@novapm/core**: Event-driven architecture via `EventBus` with typed process events
- **@novapm/core**: SQLite-backed persistence with `Database`, `ProcessRepository`, and `EventRepository`
- **@novapm/core**: Graceful shutdown with configurable timeouts and SIGTERM/SIGKILL escalation

#### Phase 2 - CLI & IPC
- **@novapm/cli**: Full CLI with commands: `start`, `stop`, `restart`, `delete`, `list`, `info`, `logs`, `monit`, `flush`, `save`, `resurrect`, `ping`, `env`, `config`
- **@novapm/core**: JSON-RPC 2.0 IPC protocol over Unix domain sockets (`IPCServer` / `IPCClient`)
- **@novapm/core**: REST API routes for HTTP-based process management
- **@novapm/cli**: Colored table output with status icons, memory/CPU formatting, and uptime display

#### Phase 3 - Logs & Monitoring
- **@novapm/core**: `LogAggregator` for real-time stdout/stderr capture per process
- **@novapm/core**: `LogRotator` with configurable size limits and retention policies
- **@novapm/core**: `MetricsCollector` for CPU, memory, and uptime metrics with configurable intervals
- **@novapm/core**: `HealthMonitor` with HTTP and TCP health checks, configurable thresholds, and auto-recovery

#### Phase 4 - AI Engine
- **@novapm/ai-engine**: Anomaly detection with Z-Score, IQR, Moving Average, Rate of Change, and Pattern detectors
- **@novapm/ai-engine**: `AutoScaler` with rule-based scaling policies (CPU, memory, request rate thresholds)
- **@novapm/ai-engine**: `PredictiveScaler` using linear regression and seasonal pattern recognition
- **@novapm/ai-engine**: `PerformanceAdvisor` generating optimization recommendations with severity levels
- **@novapm/ai-engine**: `RootCauseAnalyzer` correlating events, metrics, and logs for incident diagnosis

#### Phase 5 - Plugin System
- **@novapm/plugin-sdk**: `PluginEngine` for loading, initializing, and managing plugin lifecycle
- **@novapm/plugin-sdk**: `PluginStorage` with JSON-file-backed key-value persistence per plugin
- **@novapm/plugin-sdk**: `scaffoldPlugin()` for generating new plugin projects from template
- **@novapm/plugin-slack**: Slack notification plugin with Block Kit formatting and webhook integration
- **@novapm/plugin-discord**: Discord notification plugin with embed formatting and webhook integration
- **@novapm/plugin-email**: Email notification plugin with Nodemailer (SMTP/SES) and HTML templates
- **@novapm/plugin-prometheus**: Prometheus metrics exporter with `/metrics` endpoint and custom gauges
- **@novapm/plugin-docker**: Docker environment detection, stats collection, and container metadata
- **@novapm/plugin-github-deploy**: GitHub webhook receiver with HMAC-SHA256 signature verification and deployment automation

#### Phase 6 - Multi-Server Agent
- **@novapm/agent**: Distributed agent with `Controller` and `Agent` roles for multi-server management
- **@novapm/agent**: `SecureChannel` with AES-256-GCM encryption and HMAC authentication
- **@novapm/agent**: `Discovery` service for automatic agent detection via UDP broadcast
- **@novapm/agent**: `DeploymentManager` for coordinated rolling deployments across server fleet

#### Testing
- **1,543 tests** across **47 test files** covering all 12 testable packages
- Test coverage includes: unit tests, edge cases, error handling, and integration scenarios
- CI pipeline with build (13/13), lint (13/13), typecheck (15/15), and test validation

#### Infrastructure
- Monorepo setup with pnpm workspaces and Turborepo for build orchestration
- ESLint flat config with TypeScript support
- Prettier formatting with consistent style across all packages
- GitHub Actions CI/CD pipeline with security scanning
- Docker example with multi-stage build
- Contributing guide and EditorConfig
