import { Command } from 'commander';
import chalk from 'chalk';
import { daemonRequest } from '../utils/client.js';
import { renderProcessInfo } from '../ui/Table.js';

export const infoCommand = new Command('info')
  .alias('show')
  .argument('<target>', 'Process name or id')
  .option('--json', 'Output as JSON')
  .description('Show detailed process information')
  .action(async (target, options) => {
    try {
      const params: Record<string, unknown> = {};
      const id = parseInt(target, 10);
      if (!isNaN(id)) {
        params.id = id;
      } else {
        params.name = target;
      }

      const proc = await daemonRequest('process.info', params);

      if (options.json) {
        console.log(JSON.stringify(proc, null, 2));
        return;
      }

      console.log(renderProcessInfo(proc as never));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`Error: ${msg}`));
      process.exitCode = 1;
    }
  });
