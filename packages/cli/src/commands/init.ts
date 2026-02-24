import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const initCommand = new Command('init')
  .option('--template <template>', 'Config template (basic, full)', 'basic')
  .description('Generate a nova-pm.config.js file')
  .action(async (options) => {
    const configPath = resolve('nova-pm.config.js');

    if (existsSync(configPath)) {
      console.log(chalk.yellow(`\n  Config file already exists: ${configPath}\n`));
      return;
    }

    const template = options.template === 'full' ? fullTemplate() : basicTemplate();
    writeFileSync(configPath, template);

    console.log(chalk.green(`\n  Created ${configPath}`));
    console.log(chalk.gray(`  Edit it and run: nova-pm start\n`));
  });

function basicTemplate(): string {
  return `export default {
  apps: [
    {
      name: 'my-app',
      script: './index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
`;
}

function fullTemplate(): string {
  return `export default {
  apps: [
    {
      name: 'api-server',
      script: './src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      port: 3000,
      autorestart: true,
      max_restarts: 16,
      restart_delay: 1000,
      max_memory_restart: '512M',
      watch: false,
      ignore_watch: ['node_modules', 'logs'],
      kill_timeout: 5000,
      source_map_support: true,
      env: {
        NODE_ENV: 'development',
        PORT: '3000',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      health_check: {
        type: 'http',
        path: '/health',
        port: 3000,
        interval: '30s',
        timeout: '5s',
        retries: 3,
      },
      logs: {
        format: 'json',
        rotate: {
          size: '100M',
          keep: 10,
          compress: true,
        },
      },
    },
    {
      name: 'worker',
      script: './src/worker.js',
      instances: 2,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
  dashboard: {
    enabled: true,
    port: 9615,
  },
  ai: {
    enabled: false,
    anomaly_detection: true,
    auto_scaling: false,
  },
};
`;
}
