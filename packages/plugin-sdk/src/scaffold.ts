import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Generate a plugin template with the given name in the specified output directory.
 * Creates a complete, buildable plugin project structure.
 */
export async function generatePluginTemplate(name: string, outputDir: string): Promise<void> {
  const pluginDir = join(outputDir, name);
  const srcDir = join(pluginDir, 'src');

  await mkdir(srcDir, { recursive: true });

  const sanitizedName = name.replace(/[^a-zA-Z0-9-]/g, '-');
  const camelName = sanitizedName
    .split('-')
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');

  await Promise.all([
    writeFile(join(pluginDir, 'package.json'), generatePackageJson(sanitizedName), 'utf-8'),
    writeFile(join(pluginDir, 'tsconfig.json'), generateTsConfig(), 'utf-8'),
    writeFile(join(srcDir, 'index.ts'), generatePluginSource(sanitizedName, camelName), 'utf-8'),
  ]);
}

function generatePackageJson(name: string): string {
  const pkg = {
    name: `novapm-plugin-${name}`,
    version: '0.1.0',
    description: `NovaPM plugin: ${name}`,
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
    },
    scripts: {
      build: 'tsc',
      dev: 'tsc --watch',
      clean: 'rm -rf dist',
    },
    dependencies: {
      '@novapm/plugin-sdk': 'workspace:*',
    },
    devDependencies: {
      typescript: '^5.6.0',
    },
  };

  return JSON.stringify(pkg, null, 2) + '\n';
}

function generateTsConfig(): string {
  const config = {
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      outDir: './dist',
      rootDir: './src',
    },
    include: ['src/**/*.ts'],
    exclude: ['node_modules', 'dist', '**/*.test.ts'],
  };

  return JSON.stringify(config, null, 2) + '\n';
}

function generatePluginSource(name: string, camelName: string): string {
  return `import type { NovaPMPlugin, PluginContext } from '@novapm/plugin-sdk';
import type { ProcessEvent, ProcessMetrics } from '@novapm/shared';

/**
 * ${name} plugin for NovaPM.
 *
 * This is a scaffold-generated plugin template. Customize the hooks
 * below to implement your plugin's functionality.
 */
class ${capitalizeFirst(camelName)}Plugin implements NovaPMPlugin {
  readonly name = '${name}';
  readonly version = '0.2.0';
  readonly description = 'A NovaPM plugin';

  private context: PluginContext | null = null;

  async onInit(context: PluginContext): Promise<void> {
    this.context = context;
    context.logger.info('${name} plugin initialized');
  }

  async onDestroy(): Promise<void> {
    this.context?.logger.info('${name} plugin destroyed');
  }

  async onProcessCrash(event: ProcessEvent): Promise<void> {
    this.context?.logger.warn(
      { processName: event.processName, processId: event.processId },
      'Process crashed',
    );
  }

  async onMetricsCollected(metrics: ProcessMetrics[]): Promise<void> {
    this.context?.logger.debug(
      { count: metrics.length },
      'Metrics collected',
    );
  }
}

export default new ${capitalizeFirst(camelName)}Plugin();
`;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
