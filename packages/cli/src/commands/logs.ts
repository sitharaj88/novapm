import { Command } from 'commander';
import chalk from 'chalk';
import { daemonRequest } from '../utils/client.js';
import type { LogEntry } from '@novapm/shared';

export const logsCommand = new Command('logs')
  .argument('[target]', 'Process name or id')
  .option('-l, --lines <n>', 'Number of lines to show', '50')
  .option('-f, --follow', 'Stream new logs (not yet implemented)')
  .option('--json', 'Output as JSON')
  .description('View process logs')
  .action(async (target, options) => {
    try {
      const params: Record<string, unknown> = {
        lines: parseInt(options.lines, 10),
      };

      if (target) {
        const id = parseInt(target, 10);
        if (!isNaN(id)) {
          params.id = id;
        } else {
          params.name = target;
        }
      }

      const logs = (await daemonRequest('logs.recent', params)) as LogEntry[];

      if (options.json) {
        console.log(JSON.stringify(logs, null, 2));
        return;
      }

      if (!logs || logs.length === 0) {
        console.log(chalk.gray('\n  No logs available.\n'));
        return;
      }

      for (const entry of logs) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const name = chalk.cyan(`[${entry.processName}]`);
        const streamIndicator = entry.stream === 'stderr' ? chalk.red('ERR') : chalk.gray('OUT');

        console.log(`${chalk.gray(time)} ${streamIndicator} ${name} ${entry.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exitCode = 1;
    }
  });
