import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import {
  NOVA_HOME,
  NOVA_SOCK_FILE,
  NOVA_DB_FILE,
  NOVA_PID_FILE,
  NOVA_LOG_DIR,
} from '@novapm/shared';
import { isDaemonRunning, getDaemonPid } from '@novapm/core';

export const doctorCommand = new Command('doctor')
  .description('Diagnose NovaPM installation')
  .action(async () => {
    console.log(chalk.bold('\n  NovaPM Doctor\n'));

    let issues = 0;

    // Check Node.js version
    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split('.')[0], 10);
    if (major >= 20) {
      console.log(chalk.green(`  ✓ Node.js version: ${nodeVersion}`));
    } else {
      console.log(chalk.red(`  ✗ Node.js version: ${nodeVersion} (requires >= 20)`));
      issues++;
    }

    // Check NOVA_HOME directory
    if (existsSync(NOVA_HOME)) {
      console.log(chalk.green(`  ✓ NovaPM home: ${NOVA_HOME}`));
    } else {
      console.log(chalk.yellow(`  ⚠ NovaPM home not created yet: ${NOVA_HOME}`));
    }

    // Check daemon status
    if (isDaemonRunning()) {
      const pid = getDaemonPid();
      console.log(chalk.green(`  ✓ Daemon running (PID: ${pid})`));
    } else {
      console.log(chalk.yellow(`  ⚠ Daemon not running`));
    }

    // Check socket file
    if (existsSync(NOVA_SOCK_FILE)) {
      console.log(chalk.green(`  ✓ IPC socket: ${NOVA_SOCK_FILE}`));
    } else {
      console.log(chalk.gray(`  - IPC socket: not present (daemon not running)`));
    }

    // Check database
    if (existsSync(NOVA_DB_FILE)) {
      console.log(chalk.green(`  ✓ Database: ${NOVA_DB_FILE}`));
    } else {
      console.log(chalk.gray(`  - Database: not created yet`));
    }

    // Check log directory
    if (existsSync(NOVA_LOG_DIR)) {
      console.log(chalk.green(`  ✓ Log directory: ${NOVA_LOG_DIR}`));
    } else {
      console.log(chalk.gray(`  - Log directory: not created yet`));
    }

    // Check PID file
    if (existsSync(NOVA_PID_FILE)) {
      console.log(chalk.green(`  ✓ PID file: ${NOVA_PID_FILE}`));
    } else {
      console.log(chalk.gray(`  - PID file: not present`));
    }

    console.log('');

    if (issues > 0) {
      console.log(chalk.red(`  Found ${issues} issue(s) to fix.\n`));
      process.exitCode = 1;
    } else {
      console.log(chalk.green(`  No issues found! NovaPM is healthy.\n`));
    }
  });
