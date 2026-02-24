import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { daemonRequest } from '../utils/client.js';

export const deleteCommand = new Command('delete')
  .argument('<target>', 'Process name, id, or "all"')
  .description('Delete a process from the managed list')
  .action(async (target) => {
    const spinner = ora(`Deleting ${target}...`).start();

    try {
      const params: Record<string, unknown> = {};

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

      await daemonRequest('process.delete', params);
      spinner.succeed(chalk.green(`Deleted ${chalk.bold(target)}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail(chalk.red(`Failed to delete: ${msg}`));
      process.exitCode = 1;
    }
  });
