import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { daemonRequest } from '../utils/client.js';

export const stopCommand = new Command('stop')
  .argument('<target>', 'Process name, id, or "all"')
  .option('-f, --force', 'Force kill (SIGKILL)')
  .description('Stop a process')
  .action(async (target, options) => {
    const spinner = ora(`Stopping ${target}...`).start();

    try {
      const params: Record<string, unknown> = { force: options.force || false };

      if (target === 'all') {
        params.name = 'all';
      } else {
        const id = parseInt(target, 10);
        if (!isNaN(id)) {
          params.id = id;
        } else {
          params.name = target;
        }
      }

      await daemonRequest('process.stop', params);
      spinner.succeed(chalk.green(`Stopped ${chalk.bold(target)}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail(chalk.red(`Failed to stop: ${msg}`));
      process.exitCode = 1;
    }
  });
