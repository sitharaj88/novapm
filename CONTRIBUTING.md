# Contributing to NovaPM

Thank you for your interest in contributing to NovaPM! This guide will help you get started.

## Development Environment Setup

**Prerequisites:** Node.js >= 20.0.0 and pnpm 9.15+.

```bash
git clone https://github.com/sitharaj88/novapm.git
cd novapm
pnpm install
pnpm build
```

## Project Structure

NovaPM is a monorepo managed with pnpm workspaces and Turborepo.

```
packages/
  agent/          # Agent runtime
  ai-engine/      # AI-powered anomaly detection and auto-scaling
  cli/            # Command-line interface
  core/           # Process management core
  dashboard/      # Web dashboard
  plugin-sdk/     # SDK for building plugins
  shared/         # Shared types and utilities
plugins/
  plugin-discord/        # Discord notifications
  plugin-docker/         # Docker integration
  plugin-email/          # Email alerts
  plugin-github-deploy/  # GitHub deployment hooks
  plugin-prometheus/     # Prometheus metrics exporter
  plugin-slack/          # Slack notifications
```

## Running Tests

```bash
pnpm test          # Run all tests (via Turborepo)
pnpm lint          # Lint all packages
pnpm typecheck     # Type-check all packages
pnpm format:check  # Verify Prettier formatting
```

To run tests for a single package, use the `--filter` flag:

```bash
pnpm --filter @novapm/core test
```

## Adding a New Plugin

1. Create a directory under `plugins/` named `plugin-<name>`.
2. Add a `package.json` modeled after an existing plugin (e.g., `plugin-slack`). Include `@novapm/plugin-sdk` and `@novapm/shared` as `workspace:*` dependencies.
3. Add a `tsconfig.json` that extends the root `tsconfig.base.json`.
4. Implement your plugin in `src/index.ts` using the plugin SDK interfaces.
5. Run `pnpm install` from the repo root to link the new package.
6. Verify with `pnpm build` and `pnpm test`.

## Code Style

- **Prettier** formats all source files. Config: single quotes, semicolons, trailing commas, 100-char print width.
- **ESLint** enforces TypeScript rules. `no-explicit-any` is an error; unused variables prefixed with `_` are allowed.
- **TypeScript** is set to `strict` mode. All packages target ES2022 with NodeNext module resolution.

Run `pnpm format` to auto-format, or `pnpm format:check` to verify.

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(core): add graceful shutdown support
fix(cli): correct exit code on process failure
docs: update plugin authoring guide
chore: bump typescript to 5.7
```

Use a scope matching the package name when the change is package-specific.

## Pull Request Process

1. Fork the repository and create a branch from `main`.
2. Make your changes with clear, focused commits.
3. Add or update tests to cover your changes.
4. Ensure `pnpm build`, `pnpm test`, `pnpm lint`, and `pnpm typecheck` all pass.
5. Add a changeset (see below).
6. Open a pull request against `main` with a clear description of what and why.
7. Address review feedback promptly.

## Changesets

We use [Changesets](https://github.com/changesets/changesets) to manage versioning and changelogs. Before opening a PR that affects published packages, run:

```bash
pnpm changeset
```

This will prompt you to select the affected packages and the semver bump type, then generate a markdown file in `.changeset/`. Commit this file with your PR. The `@novapm/dashboard` package is excluded from changesets.

## Reporting Bugs

Open an issue on GitHub with:

- A clear, descriptive title.
- Steps to reproduce the problem.
- Expected vs. actual behavior.
- Node.js version, OS, and NovaPM version.

## Code of Conduct

All participants are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Please be respectful and constructive in all interactions.
