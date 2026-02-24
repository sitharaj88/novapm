import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { AppConfig } from '@novapm/shared';
import { NOVA_CONFIG_FILES, appConfigSchema } from '@novapm/shared';
import { daemonRequest } from '../utils/client.js';
import { renderProcessTable } from '../ui/Table.js';

export const startCommand = new Command('start')
  .argument('[script]', 'Script file or config file to start')
  .option('-n, --name <name>', 'Process name')
  .option('-i, --instances <n>', 'Number of instances', '1')
  .option('--exec-mode <mode>', 'Execution mode (fork|cluster)', 'fork')
  .option('-w, --watch', 'Enable watch mode')
  .option('--max-memory <size>', 'Max memory before restart (e.g., 512M)')
  .option('--env <env>', 'Environment name (production, staging, etc.)')
  .option('-p, --port <port>', 'Application port')
  .option('--cron <pattern>', 'Cron restart pattern')
  .option('--no-autorestart', 'Disable auto restart')
  .option('--interpreter <path>', 'Custom interpreter')
  .option('--node-args <args>', 'Extra Node.js arguments')
  .option('--cwd <dir>', 'Working directory')
  .description('Start a process or all processes from a config file')
  .action(async (script, options) => {
    const spinner = ora('Starting process...').start();

    try {
      // If no script provided, look for config files
      if (!script) {
        const configFile = findConfigFile();
        if (configFile) {
          script = configFile;
        } else {
          spinner.fail('No script or config file specified');
          process.exitCode = 1;
          return;
        }
      }

      const resolvedPath = resolve(script);

      // Check if it's a config file
      if (isConfigFile(resolvedPath)) {
        await startFromConfig(resolvedPath, spinner);
        return;
      }

      // Single script start
      if (!existsSync(resolvedPath)) {
        spinner.fail(`File not found: ${resolvedPath}`);
        process.exitCode = 1;
        return;
      }

      const name = options.name || scriptToName(script);
      const instances = options.instances === 'max' ? 'max' : parseInt(options.instances, 10);

      const config: AppConfig = {
        name,
        script: resolvedPath,
        cwd: options.cwd ? resolve(options.cwd) : process.cwd(),
        instances: instances,
        exec_mode: options.execMode as 'fork' | 'cluster',
        watch: options.watch || false,
        max_memory_restart: options.maxMemory,
        port: options.port ? parseInt(options.port, 10) : undefined,
        autorestart: options.autorestart !== false,
        interpreter: options.interpreter,
        node_args: options.nodeArgs,
        cron_restart: options.cron,
      };

      // Apply env
      if (options.env) {
        const envKey = `env_${options.env}` as keyof AppConfig;
        const envConfig = config[envKey];
        if (envConfig && typeof envConfig === 'object') {
          config.env = { ...config.env, ...(envConfig as Record<string, string>) };
        }
      }

      await daemonRequest('process.start', config as unknown as Record<string, unknown>);
      spinner.succeed(chalk.green(`Process ${chalk.bold(name)} started`));

      // Show table
      const processes = (await daemonRequest('process.list')) as Array<Record<string, unknown>>;
      console.log(renderProcessTable(processes as never[]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.fail(chalk.red(`Failed to start: ${msg}`));
      process.exitCode = 1;
    }
  });

async function startFromConfig(configPath: string, spinner: ReturnType<typeof ora>): Promise<void> {
  let config: { apps?: AppConfig[] };

  if (configPath.endsWith('.json')) {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } else {
    // Dynamic import for .ts/.js config files
    const module = await import(configPath);
    config = module.default || module;
  }

  if (!config.apps || !Array.isArray(config.apps)) {
    spinner.fail('Config file must export an "apps" array');
    process.exitCode = 1;
    return;
  }

  spinner.text = `Starting ${config.apps.length} process(es) from config...`;

  for (const appConfig of config.apps) {
    try {
      const validated = appConfigSchema.parse(appConfig);
      await daemonRequest('process.start', validated as unknown as Record<string, unknown>);
      spinner.text = chalk.green(`Started ${chalk.bold(appConfig.name)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      spinner.warn(chalk.yellow(`Failed to start ${appConfig.name}: ${msg}`));
    }
  }

  spinner.succeed(chalk.green('All processes started'));

  const processes = (await daemonRequest('process.list')) as Array<Record<string, unknown>>;
  console.log(renderProcessTable(processes as never[]));
}

function findConfigFile(): string | null {
  for (const name of NOVA_CONFIG_FILES) {
    const fullPath = resolve(name);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
}

function isConfigFile(path: string): boolean {
  return NOVA_CONFIG_FILES.some((name) => path.endsWith(name));
}

function scriptToName(script: string): string {
  return script
    .replace(/\.(js|ts|mjs|cjs|py|rb|sh)$/, '')
    .replace(/[/\\]/g, '-')
    .replace(/^-/, '');
}
