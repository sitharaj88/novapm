import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import { DEFAULT_DASHBOARD_PORT } from '@novapm/shared';

export const dashboardCommand = new Command('dashboard')
  .option('-p, --port <port>', 'Dashboard port', String(DEFAULT_DASHBOARD_PORT))
  .option('--host <host>', 'Dashboard host', '127.0.0.1')
  .option('--open', 'Open in browser')
  .description('Open the web dashboard')
  .action(async (options) => {
    const url = `http://${options.host}:${options.port}`;

    console.log(chalk.bold('\n  NovaPM Dashboard'));
    console.log(`  ${chalk.cyan(url)}\n`);

    if (options.open) {
      await open(url);
    } else {
      console.log(chalk.gray(`  Use --open to open in browser\n`));
    }
  });
