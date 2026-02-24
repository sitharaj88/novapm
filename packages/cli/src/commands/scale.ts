import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { daemonRequest } from '../utils/client.js';

export const scaleCommand = new Command('scale')
  .argument('<target>', 'Process name or id')
  .argument('<instances>', 'Number of instances (e.g., 4, +2, -1)')
  .description('Scale process instances')
  .action(async (target, instances) => {
    const spinner = ora(`Scaling ${target} to ${instances} instances...`).start();

    try {
      const params: Record<string, unknown> = { instances };
      const id = parseInt(target, 10);
      if (!isNaN(id)) {
        params.id = id;
      } else {
        params.name = target;
      }

      await daemonRequest('process.scale', params);
      spinner.succeed(chalk.green(`Scaled ${chalk.bold(target)} to ${instances} instances`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail(chalk.red(`Failed to scale: ${msg}`));
      process.exitCode = 1;
    }
  });
