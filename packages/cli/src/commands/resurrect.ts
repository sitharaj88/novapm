import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { NOVA_HOME } from '@novapm/shared';
import type { NovaProcess } from '@novapm/shared';
import { daemonRequest } from '../utils/client.js';
import { renderProcessTable } from '../ui/Table.js';

export const resurrectCommand = new Command('resurrect')
  .description('Restore previously saved process list')
  .action(async () => {
    const spinner = ora('Restoring process list...').start();

    try {
      const savePath = join(NOVA_HOME, 'dump.json');

      if (!existsSync(savePath)) {
        spinner.fail(chalk.yellow('No saved process list found. Run "nova-pm save" first.'));
        return;
      }

      const saved = JSON.parse(readFileSync(savePath, 'utf-8')) as NovaProcess[];

      let started = 0;
      for (const proc of saved) {
        try {
          await daemonRequest('process.start', {
            name: proc.name,
            script: proc.script,
            cwd: proc.cwd,
            args: proc.args,
            interpreter: proc.interpreter,
            exec_mode: proc.execMode,
            instances: proc.instances,
            env: proc.env,
            max_memory_restart: proc.maxMemoryRestart,
            autorestart: proc.autorestart,
            kill_timeout: proc.killTimeout,
          });
          started++;
        } catch {
          spinner.warn(chalk.yellow(`Failed to restore: ${proc.name}`));
        }
      }

      spinner.succeed(chalk.green(`Restored ${started}/${saved.length} process(es)`));

      const processes = (await daemonRequest('process.list')) as Array<Record<string, unknown>>;
      console.log(renderProcessTable(processes as never[]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail(chalk.red(`Failed to restore: ${msg}`));
      process.exitCode = 1;
    }
  });
