import { Command } from 'commander';
import chalk from 'chalk';
import { daemonRequest } from '../utils/client.js';
import { renderProcessTable } from '../ui/Table.js';

export const listCommand = new Command('list')
  .alias('ls')
  .alias('status')
  .option('--json', 'Output as JSON')
  .description('List all processes')
  .action(async (options) => {
    try {
      const processes = (await daemonRequest('process.list')) as unknown[];

      if (options.json) {
        console.log(JSON.stringify(processes, null, 2));
        return;
      }

      if (!processes || (processes as unknown[]).length === 0) {
        console.log(chalk.gray('\n  No processes running. Start one with: nova start <script>\n'));
        return;
      }

      console.log(renderProcessTable(processes as never[]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exitCode = 1;
    }
  });
