import { Command } from 'commander';
import chalk from 'chalk';
import { daemonRequest } from '../utils/client.js';

export const pingCommand = new Command('ping')
  .description('Check if the daemon is running')
  .action(async () => {
    try {
      const result = (await daemonRequest('daemon.ping')) as {
        version: string;
        uptime: number;
        pid: number;
      };
      console.log(chalk.green(`\n  NovaPM daemon is alive!`));
      console.log(`  Version: ${result.version}`);
      console.log(`  PID:     ${result.pid}`);
      console.log(`  Uptime:  ${result.uptime}s\n`);
    } catch {
      console.log(chalk.red('\n  NovaPM daemon is not running.\n'));
      process.exitCode = 1;
    }
  });
