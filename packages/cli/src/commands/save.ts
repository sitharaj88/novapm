import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { NOVA_HOME } from '@novapm/shared';
import { daemonRequest } from '../utils/client.js';

export const saveCommand = new Command('save')
  .description('Save current process list for resurrection')
  .action(async () => {
    const spinner = ora('Saving process list...').start();

    try {
      const processes = (await daemonRequest('process.list')) as unknown[];
      const savePath = join(NOVA_HOME, 'dump.json');

      mkdirSync(NOVA_HOME, { recursive: true });
      writeFileSync(savePath, JSON.stringify(processes, null, 2));

      spinner.succeed(chalk.green(`Saved ${processes.length} process(es) to ${savePath}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail(chalk.red(`Failed to save: ${msg}`));
      process.exitCode = 1;
    }
  });
