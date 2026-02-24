#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { NOVA_VERSION } from '@novapm/shared';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { restartCommand } from './commands/restart.js';
import { deleteCommand } from './commands/delete.js';
import { listCommand } from './commands/list.js';
import { infoCommand } from './commands/info.js';
import { logsCommand } from './commands/logs.js';
import { scaleCommand } from './commands/scale.js';
import { pingCommand } from './commands/ping.js';
import { saveCommand } from './commands/save.js';
import { resurrectCommand } from './commands/resurrect.js';
import { startupCommand } from './commands/startup.js';
import { dashboardCommand } from './commands/dashboard.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { monitCommand } from './commands/monit.js';
import { disconnect } from './utils/client.js';

const program = new Command();

program
  .name('nova')
  .version(NOVA_VERSION, '-v, --version')
  .description(chalk.bold('NovaPM') + ' — Next-generation AI-powered process manager')
  .addCommand(startCommand)
  .addCommand(stopCommand)
  .addCommand(restartCommand)
  .addCommand(deleteCommand)
  .addCommand(listCommand)
  .addCommand(infoCommand)
  .addCommand(logsCommand)
  .addCommand(scaleCommand)
  .addCommand(pingCommand)
  .addCommand(saveCommand)
  .addCommand(resurrectCommand)
  .addCommand(startupCommand)
  .addCommand(dashboardCommand)
  .addCommand(initCommand)
  .addCommand(doctorCommand)
  .addCommand(monitCommand);

// Default to 'list' when no command given
program.action(async () => {
  await listCommand.parseAsync([], { from: 'user' });
});

program.parseAsync(process.argv).finally(() => {
  disconnect();
});
