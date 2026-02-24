import { resolve } from 'node:path';
import pino from 'pino';
import type { PluginConfig } from '@novapm/shared';
import type {
  NovaPMPlugin,
  PluginAPI,
  PluginContext,
  PluginStorageFactory,
  LoadedPlugin,
  PluginLoadConfig,
  RouteDefinition,
  WidgetDefinition,
} from './types.js';

/** All hook names that can be called on plugins */
const VALID_HOOKS = [
  'onProcessStart',
  'onProcessStop',
  'onProcessRestart',
  'onProcessCrash',
  'onProcessExit',
  'onMetricsCollected',
  'onSystemMetrics',
  'onLogEntry',
  'onHealthCheckFail',
  'onHealthCheckRestore',
  'onConfigChange',
] as const;

type HookName = (typeof VALID_HOOKS)[number];

/**
 * Validates that a value matches the minimum shape of a NovaPMPlugin.
 */
function isValidPlugin(value: unknown): value is NovaPMPlugin {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj.name === 'string' && typeof obj.version === 'string';
}

/**
 * The main engine responsible for loading, managing, and orchestrating plugins.
 *
 * Features:
 * - Dynamic plugin loading from file paths or npm packages
 * - Per-plugin scoped logging, config, and storage
 * - Hook dispatch to all loaded plugins with error isolation
 * - Automatic plugin disabling after consecutive errors
 */
export class PluginEngine {
  private readonly plugins: Map<string, LoadedPlugin> = new Map();
  private readonly api: PluginAPI;
  private readonly storageFactory: PluginStorageFactory;
  private readonly logger: pino.Logger;
  private readonly maxConsecutiveErrors: number;

  constructor(
    api: PluginAPI,
    storageFactory: PluginStorageFactory,
    options?: { maxConsecutiveErrors?: number; logger?: pino.Logger },
  ) {
    this.api = api;
    this.storageFactory = storageFactory;
    this.maxConsecutiveErrors = options?.maxConsecutiveErrors ?? 5;
    this.logger = options?.logger ?? pino({ name: 'novapm-plugin-engine' });
  }

  /**
   * Load a plugin from a file path or module specifier.
   *
   * The module must export a default value (or named `plugin`) that implements NovaPMPlugin.
   */
  async loadPlugin(pluginPath: string, config?: Record<string, unknown>): Promise<void> {
    const resolvedPath = this.resolvePath(pluginPath);
    this.logger.info({ pluginPath: resolvedPath }, 'Loading plugin');

    let pluginModule: Record<string, unknown>;
    try {
      pluginModule = (await import(resolvedPath)) as Record<string, unknown>;
    } catch (error) {
      this.logger.error({ pluginPath: resolvedPath, error }, 'Failed to import plugin module');
      throw new Error(`Failed to import plugin from ${resolvedPath}: ${String(error)}`);
    }

    // Support both default export and named 'plugin' export
    const pluginInstance = (pluginModule.default ?? pluginModule.plugin) as unknown;

    if (!isValidPlugin(pluginInstance)) {
      throw new Error(
        `Invalid plugin at ${resolvedPath}: must export an object with 'name' and 'version' properties`,
      );
    }

    if (this.plugins.has(pluginInstance.name)) {
      throw new Error(`Plugin '${pluginInstance.name}' is already loaded`);
    }

    // Create scoped context for this plugin
    const context: PluginContext = {
      config: config ?? {},
      logger: this.logger.child({ plugin: pluginInstance.name }),
      api: this.api,
      storage: this.storageFactory(pluginInstance.name),
    };

    const loadedPlugin: LoadedPlugin = {
      plugin: pluginInstance,
      context,
      status: 'active',
      errorCount: 0,
    };

    // Initialize the plugin
    if (pluginInstance.onInit) {
      try {
        await pluginInstance.onInit(context);
        this.logger.info(
          { plugin: pluginInstance.name, version: pluginInstance.version },
          'Plugin initialized successfully',
        );
      } catch (error) {
        this.logger.error({ plugin: pluginInstance.name, error }, 'Plugin initialization failed');
        throw new Error(`Plugin '${pluginInstance.name}' failed to initialize: ${String(error)}`);
      }
    }

    this.plugins.set(pluginInstance.name, loadedPlugin);
  }

  /**
   * Unload a plugin by name, calling its onDestroy hook if present.
   */
  async unloadPlugin(name: string): Promise<void> {
    const loaded = this.plugins.get(name);
    if (!loaded) {
      throw new Error(`Plugin '${name}' is not loaded`);
    }

    if (loaded.plugin.onDestroy) {
      try {
        await loaded.plugin.onDestroy();
      } catch (error) {
        this.logger.warn({ plugin: name, error }, 'Error during plugin destroy');
      }
    }

    this.plugins.delete(name);
    this.logger.info({ plugin: name }, 'Plugin unloaded');
  }

  /**
   * Emit a hook to all loaded plugins.
   * Each plugin is called independently -- errors in one plugin do not affect others.
   * Plugins that exceed the consecutive error threshold are automatically disabled.
   */
  async emitHook(hookName: string, ...args: unknown[]): Promise<void> {
    if (!VALID_HOOKS.includes(hookName as HookName)) {
      this.logger.warn({ hookName }, 'Unknown hook name');
      return;
    }

    const promises: Promise<void>[] = [];

    for (const [name, loaded] of this.plugins) {
      if (loaded.status !== 'active') {
        continue;
      }

      const hookFn = loaded.plugin[hookName as HookName];
      if (typeof hookFn !== 'function') {
        continue;
      }

      const promise = (async () => {
        try {
          // Each hook takes a single argument (event, metrics, entry, or config)
          await (hookFn as (...hookArgs: unknown[]) => Promise<void>).call(loaded.plugin, ...args);
          // Reset error count on success
          loaded.errorCount = 0;
        } catch (error) {
          loaded.errorCount++;
          this.logger.error(
            {
              plugin: name,
              hookName,
              error,
              errorCount: loaded.errorCount,
              maxErrors: this.maxConsecutiveErrors,
            },
            'Plugin hook execution failed',
          );

          if (loaded.errorCount >= this.maxConsecutiveErrors) {
            loaded.status = 'disabled';
            this.logger.error(
              { plugin: name, errorCount: loaded.errorCount },
              'Plugin disabled due to excessive consecutive errors',
            );
          }
        }
      })();

      promises.push(promise);
    }

    await Promise.allSettled(promises);
  }

  /**
   * Get information about all loaded plugins.
   */
  getLoadedPlugins(): { name: string; version: string; status: string }[] {
    const result: { name: string; version: string; status: string }[] = [];
    for (const [, loaded] of this.plugins) {
      result.push({
        name: loaded.plugin.name,
        version: loaded.plugin.version,
        status: loaded.status,
      });
    }
    return result;
  }

  /**
   * Get all route definitions from loaded plugins.
   */
  getRoutes(): { pluginName: string; routes: RouteDefinition[] }[] {
    const result: { pluginName: string; routes: RouteDefinition[] }[] = [];
    for (const [name, loaded] of this.plugins) {
      if (loaded.status !== 'active' || !loaded.plugin.routes) {
        continue;
      }
      try {
        const routes = loaded.plugin.routes();
        result.push({ pluginName: name, routes });
      } catch (error) {
        this.logger.error({ plugin: name, error }, 'Failed to get routes from plugin');
      }
    }
    return result;
  }

  /**
   * Get all widget definitions from loaded plugins.
   */
  getWidgets(): { pluginName: string; widgets: WidgetDefinition[] }[] {
    const result: { pluginName: string; widgets: WidgetDefinition[] }[] = [];
    for (const [name, loaded] of this.plugins) {
      if (loaded.status !== 'active' || !loaded.plugin.widgets) {
        continue;
      }
      try {
        const widgets = loaded.plugin.widgets();
        result.push({ pluginName: name, widgets });
      } catch (error) {
        this.logger.error({ plugin: name, error }, 'Failed to get widgets from plugin');
      }
    }
    return result;
  }

  /**
   * Load multiple plugins from NovaPM configuration.
   */
  async loadFromConfig(plugins: PluginConfig[]): Promise<void> {
    for (const pluginConfig of plugins) {
      try {
        const pluginPath = pluginConfig.name;
        await this.loadPlugin(pluginPath, pluginConfig.options);
      } catch (error) {
        this.logger.error(
          { plugin: pluginConfig.name, error },
          'Failed to load plugin from config',
        );
      }
    }
  }

  /**
   * Load multiple plugins from an array of PluginLoadConfig.
   */
  async loadFromPluginConfigs(configs: PluginLoadConfig[]): Promise<void> {
    for (const config of configs) {
      try {
        const pluginPath = config.path ?? config.name;
        await this.loadPlugin(pluginPath, config.options);
      } catch (error) {
        this.logger.error({ plugin: config.name, error }, 'Failed to load plugin from config');
      }
    }
  }

  /**
   * Re-enable a disabled plugin and reset its error count.
   */
  enablePlugin(name: string): void {
    const loaded = this.plugins.get(name);
    if (!loaded) {
      throw new Error(`Plugin '${name}' is not loaded`);
    }
    loaded.status = 'active';
    loaded.errorCount = 0;
    this.logger.info({ plugin: name }, 'Plugin re-enabled');
  }

  /**
   * Unload all plugins gracefully.
   */
  async shutdown(): Promise<void> {
    const pluginNames = Array.from(this.plugins.keys());
    for (const name of pluginNames) {
      try {
        await this.unloadPlugin(name);
      } catch (error) {
        this.logger.error({ plugin: name, error }, 'Error unloading plugin during shutdown');
      }
    }
  }

  /**
   * Resolve a plugin path. If it starts with '.' or '/' treat as file path,
   * otherwise treat as a module specifier (npm package).
   */
  private resolvePath(pluginPath: string): string {
    if (pluginPath.startsWith('.') || pluginPath.startsWith('/')) {
      return resolve(pluginPath);
    }
    // For npm packages, return as-is for dynamic import
    return pluginPath;
  }
}
