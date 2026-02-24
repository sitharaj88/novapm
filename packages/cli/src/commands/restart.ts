import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { daemonRequest } from '../utils/client.js';
import { renderProcessTable } from '../ui/Table.js';

export const restartCommand = new Command('restart')
  .argument('<target>', 'Process name, id, or "all"')
  .description('Restart a process')
  .action(async (target) => {
    const spinner = ora(`Restarting ${target}...`).start();

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

      await daemonRequest('process.restart', params);
      spinner.succeed(chalk.green(`Restarted ${chalk.bold(target)}`));

      const processes = (await daemonRequest('process.list')) as Array<Record<string, unknown>>;
      console.log(renderProcessTable(processes as never[]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail(chalk.red(`Failed to restart: ${msg}`));
      process.exitCode = 1;
    }
  });
