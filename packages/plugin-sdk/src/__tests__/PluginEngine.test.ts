import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginAPI, PluginStorageFactory, NovaPMPlugin, PluginContext } from '../types.js';
import { PluginEngine } from '../PluginEngine.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockAPI(): PluginAPI {
  return {
    getProcesses: vi.fn().mockReturnValue([]),
    getProcess: vi.fn().mockReturnValue(null),
    restartProcess: vi.fn().mockResolvedValue(undefined),
    stopProcess: vi.fn().mockResolvedValue(undefined),
    scaleProcess: vi.fn().mockResolvedValue(undefined),
    getMetrics: vi.fn().mockReturnValue(null),
    getSystemMetrics: vi.fn().mockReturnValue(null),
    getRecentLogs: vi.fn().mockReturnValue([]),
    emit: vi.fn(),
    on: vi.fn(),
  };
}

function createMockStorageFactory(): PluginStorageFactory {
  return vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
  });
}

function createSilentLogger() {
  // pino-compatible silent logger to keep test output clean
  const noop = vi.fn();
  const logger: Record<string, unknown> = {};
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
    logger[level] = noop;
  }
  logger.child = vi.fn().mockReturnValue(logger);
  logger.level = 'silent';
  return logger as unknown as import('pino').Logger;
}

/**
 * Build a minimal valid plugin. Individual tests can override properties.
 */
function createMockPlugin(overrides: Partial<NovaPMPlugin> = {}): NovaPMPlugin {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    ...overrides,
  };
}

/**
 * Register a plugin by dynamically importing a virtual module.
 * We mock `import()` via vi.fn() so no real FS access is needed.
 */
async function _registerPlugin(
  engine: PluginEngine,
  plugin: NovaPMPlugin,
  config?: Record<string, unknown>,
): Promise<void> {
  // The engine calls `import(resolvedPath)` internally.
  // We mock the global import so it returns our plugin object.
  const modulePath = `/fake/plugins/${plugin.name}/index.js`;
  vi.doMock(modulePath, () => ({ default: plugin }));

  // Because PluginEngine uses native `import()`, we patch it via vi.spyOn
  // on the prototype's private call. Instead we rely on the fact that
  // resolvePath for absolute paths returns the same path – so we mock
  // the dynamic import at the module level.
  // Unfortunately dynamic import() is hard to mock in vitest directly.
  // So we take a different approach: directly construct the scenario by
  // using a data URI that returns the plugin.
  //
  // Simplest approach: use vi.spyOn on the engine's internal import call
  // by monkey-patching the engine's loadPlugin to skip the import step.

  // We'll just create a subclass that overrides the import step:
  // Actually, let's use a more pragmatic approach – we mock the entire
  // loadPlugin pathway by testing the engine's public API through a
  // helper that injects the plugin.
  //
  // For a truly unit-level test we'll directly put the plugin in the
  // engine's internal map via reflection.

  // Actually the cleanest vitest approach: mock the dynamic import.
  // Let's do it properly.
  await engine.loadPlugin(modulePath, config);
}

// ---------------------------------------------------------------------------
// We need to mock dynamic import() at the module level.
// The PluginEngine calls `await import(resolvedPath)`.
// We intercept this by mocking `import()` behavior.
// ---------------------------------------------------------------------------

// Store plugins to be "loaded" keyed by path
const _mockPluginRegistry = new Map<string, unknown>();

// Mock the dynamic import inside PluginEngine
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return { ...actual, resolve: actual.resolve };
});

// The PluginEngine does `await import(resolvedPath)`. We can't easily mock
// native dynamic import. Instead we'll test by overriding the import
// mechanism. The pragmatic approach: replace `loadPlugin` calls with a test
// helper that manually registers plugins into the engine.
//
// A better approach for true integration: create real temp files. But for
// unit tests we use a thin wrapper.

// Let's create a testable subclass that overrides the import step.
class TestablePluginEngine extends PluginEngine {
  private moduleMap = new Map<string, Record<string, unknown>>();

  /**
   * Pre-register a module that will be "imported" when loadPlugin is called
   * with the given path.
   */
  registerModule(path: string, moduleExports: Record<string, unknown>): void {
    this.moduleMap.set(path, moduleExports);
  }

  /**
   * Override the parent's loadPlugin to use our in-memory module map
   * instead of real dynamic import().
   */
  async loadPlugin(pluginPath: string, config?: Record<string, unknown>): Promise<void> {
    // Replicate the engine's behaviour without hitting the filesystem.
    // We call the parent but need to intercept `import()`.
    // Since we can't easily do that, we re-implement the key logic here
    // delegating to the real base class would require the import to succeed.

    // Instead, we patch the global import function temporarily:
    const mod = this.moduleMap.get(pluginPath);
    if (!mod) {
      // Fall through to the real loadPlugin (will likely fail, which is what
      // we want for error-path tests).
      return super.loadPlugin(pluginPath, config);
    }

    // Temporarily replace import() — we do this by rewriting
    // `this.loadPlugin` is already overridden so we just replicate the logic
    // from the parent class:
    const resolvedPath =
      pluginPath.startsWith('.') || pluginPath.startsWith('/') ? pluginPath : pluginPath;

    const pluginInstance = (mod.default ?? mod.plugin) as unknown;

    if (pluginInstance === null || typeof pluginInstance !== 'object') {
      throw new Error(
        `Invalid plugin at ${resolvedPath}: must export an object with 'name' and 'version' properties`,
      );
    }

    const obj = pluginInstance as Record<string, unknown>;
    if (typeof obj.name !== 'string' || typeof obj.version !== 'string') {
      throw new Error(
        `Invalid plugin at ${resolvedPath}: must export an object with 'name' and 'version' properties`,
      );
    }

    const plugin = pluginInstance as NovaPMPlugin;

    // Check for duplicate
    const loaded = (this as unknown as { plugins: Map<string, unknown> }).plugins;
    if (loaded && typeof loaded === 'object' && 'has' in loaded) {
      // Use getLoadedPlugins to check
    }
    const existing = this.getLoadedPlugins().find((p) => p.name === plugin.name);
    if (existing) {
      throw new Error(`Plugin '${plugin.name}' is already loaded`);
    }

    // We need access to the private fields. Use type assertion.
    const engineAny = this as unknown as {
      api: PluginAPI;
      storageFactory: PluginStorageFactory;
      logger: { child: (opts: Record<string, unknown>) => unknown };
      plugins: Map<
        string,
        {
          plugin: NovaPMPlugin;
          context: PluginContext;
          status: string;
          errorCount: number;
        }
      >;
    };

    const context: PluginContext = {
      config: config ?? {},
      logger: engineAny.logger.child({ plugin: plugin.name }) as import('pino').Logger,
      api: engineAny.api,
      storage: engineAny.storageFactory(plugin.name),
    };

    if (plugin.onInit) {
      try {
        await plugin.onInit(context);
      } catch (error) {
        throw new Error(`Plugin '${plugin.name}' failed to initialize: ${String(error)}`);
      }
    }

    engineAny.plugins.set(plugin.name, {
      plugin,
      context,
      status: 'active',
      errorCount: 0,
    });
  }
}

function createEngine(opts?: { maxConsecutiveErrors?: number }): TestablePluginEngine {
  return new TestablePluginEngine(createMockAPI(), createMockStorageFactory(), {
    logger: createSilentLogger(),
    ...opts,
  });
}

async function loadPlugin(
  engine: TestablePluginEngine,
  plugin: NovaPMPlugin,
  config?: Record<string, unknown>,
): Promise<void> {
  const path = `/fake/${plugin.name}`;
  engine.registerModule(path, { default: plugin });
  await engine.loadPlugin(path, config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginEngine', () => {
  let engine: TestablePluginEngine;

  beforeEach(() => {
    vi.restoreAllMocks();
    engine = createEngine();
  });

  // ----- Plugin registration -----
  describe('plugin registration', () => {
    it('should load a valid plugin with default export', async () => {
      const plugin = createMockPlugin();
      await loadPlugin(engine, plugin);

      const loaded = engine.getLoadedPlugins();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual({
        name: 'test-plugin',
        version: '1.0.0',
        status: 'active',
      });
    });

    it('should load a valid plugin with named "plugin" export', async () => {
      const plugin = createMockPlugin({ name: 'named-export' });
      const path = '/fake/named-export';
      engine.registerModule(path, { plugin }); // no default, use named
      await engine.loadPlugin(path);

      const loaded = engine.getLoadedPlugins();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.name).toBe('named-export');
    });

    it('should reject loading a plugin with the same name twice', async () => {
      const plugin = createMockPlugin();
      await loadPlugin(engine, plugin);

      await expect(loadPlugin(engine, plugin)).rejects.toThrow(
        "Plugin 'test-plugin' is already loaded",
      );
    });

    it('should reject a plugin missing "name"', async () => {
      const path = '/fake/bad-no-name';
      engine.registerModule(path, { default: { version: '1.0.0' } });

      await expect(engine.loadPlugin(path)).rejects.toThrow('Invalid plugin');
    });

    it('should reject a plugin missing "version"', async () => {
      const path = '/fake/bad-no-version';
      engine.registerModule(path, { default: { name: 'no-version' } });

      await expect(engine.loadPlugin(path)).rejects.toThrow('Invalid plugin');
    });

    it('should reject a null plugin export', async () => {
      const path = '/fake/bad-null';
      engine.registerModule(path, { default: null });

      await expect(engine.loadPlugin(path)).rejects.toThrow('Invalid plugin');
    });

    it('should reject a non-object plugin export', async () => {
      const path = '/fake/bad-string';
      engine.registerModule(path, { default: 'not-a-plugin' });

      await expect(engine.loadPlugin(path)).rejects.toThrow('Invalid plugin');
    });

    it('should pass config to the plugin context', async () => {
      let receivedConfig: Record<string, unknown> | undefined;
      const plugin = createMockPlugin({
        name: 'config-test',
        onInit: vi.fn(async (ctx: PluginContext) => {
          receivedConfig = ctx.config;
        }),
      });

      await loadPlugin(engine, plugin, { key: 'value', count: 42 });

      expect(receivedConfig).toEqual({ key: 'value', count: 42 });
    });

    it('should default config to empty object when none provided', async () => {
      let receivedConfig: Record<string, unknown> | undefined;
      const plugin = createMockPlugin({
        name: 'no-config',
        onInit: vi.fn(async (ctx: PluginContext) => {
          receivedConfig = ctx.config;
        }),
      });

      await loadPlugin(engine, plugin);

      expect(receivedConfig).toEqual({});
    });
  });

  // ----- Plugin lifecycle -----
  describe('plugin lifecycle', () => {
    it('should call onInit during loadPlugin', async () => {
      const onInit = vi.fn().mockResolvedValue(undefined);
      const plugin = createMockPlugin({ name: 'init-test', onInit });

      await loadPlugin(engine, plugin);

      expect(onInit).toHaveBeenCalledTimes(1);
      expect(onInit).toHaveBeenCalledWith(
        expect.objectContaining({
          config: {},
          api: expect.any(Object),
          storage: expect.any(Object),
        }),
      );
    });

    it('should throw if onInit fails', async () => {
      const plugin = createMockPlugin({
        name: 'init-fail',
        onInit: vi.fn().mockRejectedValue(new Error('init boom')),
      });

      await expect(loadPlugin(engine, plugin)).rejects.toThrow(
        "Plugin 'init-fail' failed to initialize",
      );

      // Plugin should NOT be registered
      expect(engine.getLoadedPlugins()).toHaveLength(0);
    });

    it('should call onDestroy during unloadPlugin', async () => {
      const onDestroy = vi.fn().mockResolvedValue(undefined);
      const plugin = createMockPlugin({ name: 'destroy-test', onDestroy });
      await loadPlugin(engine, plugin);

      await engine.unloadPlugin('destroy-test');

      expect(onDestroy).toHaveBeenCalledTimes(1);
      expect(engine.getLoadedPlugins()).toHaveLength(0);
    });

    it('should swallow errors from onDestroy during unload', async () => {
      const plugin = createMockPlugin({
        name: 'destroy-fail',
        onDestroy: vi.fn().mockRejectedValue(new Error('destroy boom')),
      });
      await loadPlugin(engine, plugin);

      // Should not throw
      await expect(engine.unloadPlugin('destroy-fail')).resolves.toBeUndefined();
      expect(engine.getLoadedPlugins()).toHaveLength(0);
    });

    it('should throw when unloading a plugin that is not loaded', async () => {
      await expect(engine.unloadPlugin('nonexistent')).rejects.toThrow(
        "Plugin 'nonexistent' is not loaded",
      );
    });

    it('should call onDestroy for all plugins during shutdown', async () => {
      const destroyA = vi.fn().mockResolvedValue(undefined);
      const destroyB = vi.fn().mockResolvedValue(undefined);

      await loadPlugin(engine, createMockPlugin({ name: 'plugin-a', onDestroy: destroyA }));
      await loadPlugin(engine, createMockPlugin({ name: 'plugin-b', onDestroy: destroyB }));

      await engine.shutdown();

      expect(destroyA).toHaveBeenCalledTimes(1);
      expect(destroyB).toHaveBeenCalledTimes(1);
      expect(engine.getLoadedPlugins()).toHaveLength(0);
    });

    it('should continue shutdown even if one plugin onDestroy fails', async () => {
      const destroyA = vi.fn().mockRejectedValue(new Error('boom'));
      const destroyB = vi.fn().mockResolvedValue(undefined);

      await loadPlugin(engine, createMockPlugin({ name: 'plugin-a', onDestroy: destroyA }));
      await loadPlugin(engine, createMockPlugin({ name: 'plugin-b', onDestroy: destroyB }));

      await engine.shutdown();

      expect(destroyA).toHaveBeenCalledTimes(1);
      expect(destroyB).toHaveBeenCalledTimes(1);
      expect(engine.getLoadedPlugins()).toHaveLength(0);
    });
  });

  // ----- Hook dispatch / event propagation -----
  describe('hook dispatch', () => {
    it('should dispatch onProcessStart to active plugins', async () => {
      const onProcessStart = vi.fn().mockResolvedValue(undefined);
      const plugin = createMockPlugin({ name: 'hook-start', onProcessStart });
      await loadPlugin(engine, plugin);

      const event = {
        type: 'start' as const,
        processId: 1,
        processName: 'app',
        timestamp: new Date(),
        data: {},
      };
      await engine.emitHook('onProcessStart', event);

      expect(onProcessStart).toHaveBeenCalledTimes(1);
      expect(onProcessStart).toHaveBeenCalledWith(event);
    });

    it('should dispatch hooks to multiple plugins', async () => {
      const handlerA = vi.fn().mockResolvedValue(undefined);
      const handlerB = vi.fn().mockResolvedValue(undefined);

      await loadPlugin(engine, createMockPlugin({ name: 'plugA', onProcessStop: handlerA }));
      await loadPlugin(engine, createMockPlugin({ name: 'plugB', onProcessStop: handlerB }));

      const event = {
        type: 'stop' as const,
        processId: 2,
        processName: 'worker',
        timestamp: new Date(),
        data: {},
      };
      await engine.emitHook('onProcessStop', event);

      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledTimes(1);
    });

    it('should not call hooks on disabled plugins', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const e = createEngine({ maxConsecutiveErrors: 1 });

      const failingPlugin = createMockPlugin({
        name: 'failing',
        onProcessStart: vi.fn().mockRejectedValue(new Error('fail')),
        onProcessStop: handler,
      });
      await loadPlugin(e, failingPlugin);

      // Trigger failure to disable the plugin
      await e.emitHook('onProcessStart', {
        type: 'start' as const,
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      });

      // Plugin should now be disabled
      expect(e.getLoadedPlugins()[0]!.status).toBe('disabled');

      // This hook should NOT be called
      await e.emitHook('onProcessStop', {
        type: 'stop' as const,
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should skip plugins that do not implement the hook', async () => {
      // Plugin without onProcessRestart should not cause errors
      await loadPlugin(engine, createMockPlugin({ name: 'no-hook' }));

      await expect(
        engine.emitHook('onProcessRestart', {
          type: 'restart' as const,
          processId: 1,
          processName: 'x',
          timestamp: new Date(),
          data: {},
        }),
      ).resolves.toBeUndefined();
    });

    it('should warn and return for unknown hook names', async () => {
      await loadPlugin(engine, createMockPlugin());

      // Should not throw for unknown hooks
      await expect(engine.emitHook('onSomethingUnknown', {})).resolves.toBeUndefined();
    });

    it('should reset error count on successful hook execution', async () => {
      let callCount = 0;
      const handler = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('temporary failure');
        }
        // Succeeds on 3rd call
      });

      const e = createEngine({ maxConsecutiveErrors: 5 });
      await loadPlugin(e, createMockPlugin({ name: 'recovering', onProcessStart: handler }));

      const event = {
        type: 'start' as const,
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      };

      // Two failures
      await e.emitHook('onProcessStart', event);
      await e.emitHook('onProcessStart', event);

      // Plugin should still be active (only 2 errors, threshold is 5)
      expect(e.getLoadedPlugins()[0]!.status).toBe('active');

      // Third call succeeds — error count resets
      await e.emitHook('onProcessStart', event);
      expect(e.getLoadedPlugins()[0]!.status).toBe('active');
    });

    it('should isolate errors between plugins', async () => {
      const successHandler = vi.fn().mockResolvedValue(undefined);
      const failHandler = vi.fn().mockRejectedValue(new Error('boom'));

      await loadPlugin(engine, createMockPlugin({ name: 'good', onProcessStart: successHandler }));
      await loadPlugin(engine, createMockPlugin({ name: 'bad', onProcessStart: failHandler }));

      const event = {
        type: 'start' as const,
        processId: 1,
        processName: 'app',
        timestamp: new Date(),
        data: {},
      };
      await engine.emitHook('onProcessStart', event);

      // Good plugin should still have been called successfully
      expect(successHandler).toHaveBeenCalledTimes(1);
      // Bad plugin's error should not propagate
      expect(failHandler).toHaveBeenCalledTimes(1);
    });

    it('should dispatch all valid hook types', async () => {
      const hooks = {
        onProcessStart: vi.fn().mockResolvedValue(undefined),
        onProcessStop: vi.fn().mockResolvedValue(undefined),
        onProcessRestart: vi.fn().mockResolvedValue(undefined),
        onProcessCrash: vi.fn().mockResolvedValue(undefined),
        onProcessExit: vi.fn().mockResolvedValue(undefined),
        onMetricsCollected: vi.fn().mockResolvedValue(undefined),
        onSystemMetrics: vi.fn().mockResolvedValue(undefined),
        onLogEntry: vi.fn().mockResolvedValue(undefined),
        onHealthCheckFail: vi.fn().mockResolvedValue(undefined),
        onHealthCheckRestore: vi.fn().mockResolvedValue(undefined),
        onConfigChange: vi.fn().mockResolvedValue(undefined),
      };

      await loadPlugin(engine, createMockPlugin({ name: 'all-hooks', ...hooks }));

      const dummyArg = {};
      for (const hookName of Object.keys(hooks)) {
        await engine.emitHook(hookName, dummyArg);
      }

      for (const [hookName, fn] of Object.entries(hooks)) {
        expect(fn, `${hookName} should have been called`).toHaveBeenCalledTimes(1);
      }
    });
  });

  // ----- Plugin auto-disable on consecutive errors -----
  describe('auto-disable on consecutive errors', () => {
    it('should disable a plugin after maxConsecutiveErrors', async () => {
      const e = createEngine({ maxConsecutiveErrors: 3 });
      const handler = vi.fn().mockRejectedValue(new Error('always fails'));
      await loadPlugin(e, createMockPlugin({ name: 'fragile', onProcessStart: handler }));

      const event = {
        type: 'start' as const,
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      };

      // 3 consecutive errors should disable
      await e.emitHook('onProcessStart', event);
      await e.emitHook('onProcessStart', event);
      await e.emitHook('onProcessStart', event);

      expect(e.getLoadedPlugins()[0]!.status).toBe('disabled');
      expect(handler).toHaveBeenCalledTimes(3);

      // Further calls should NOT reach the handler
      await e.emitHook('onProcessStart', event);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should default maxConsecutiveErrors to 5', async () => {
      const e = new TestablePluginEngine(createMockAPI(), createMockStorageFactory(), {
        logger: createSilentLogger(),
      });
      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      await loadPlugin(e, createMockPlugin({ name: 'default-max', onProcessStart: handler }));

      const event = {
        type: 'start' as const,
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      };

      // After 4 errors should still be active
      for (let i = 0; i < 4; i++) {
        await e.emitHook('onProcessStart', event);
      }
      expect(e.getLoadedPlugins()[0]!.status).toBe('active');

      // 5th error should disable
      await e.emitHook('onProcessStart', event);
      expect(e.getLoadedPlugins()[0]!.status).toBe('disabled');
    });
  });

  // ----- enablePlugin -----
  describe('enablePlugin', () => {
    it('should re-enable a disabled plugin', async () => {
      const e = createEngine({ maxConsecutiveErrors: 1 });
      const handler = vi.fn().mockRejectedValue(new Error('fail'));
      await loadPlugin(e, createMockPlugin({ name: 'reenable', onProcessStart: handler }));

      await e.emitHook('onProcessStart', {
        type: 'start' as const,
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      });
      expect(e.getLoadedPlugins()[0]!.status).toBe('disabled');

      e.enablePlugin('reenable');
      expect(e.getLoadedPlugins()[0]!.status).toBe('active');
    });

    it('should throw when enabling a plugin that is not loaded', () => {
      expect(() => engine.enablePlugin('ghost')).toThrow("Plugin 'ghost' is not loaded");
    });
  });

  // ----- getLoadedPlugins -----
  describe('getLoadedPlugins', () => {
    it('should return empty array when no plugins loaded', () => {
      expect(engine.getLoadedPlugins()).toEqual([]);
    });

    it('should return info for all loaded plugins', async () => {
      await loadPlugin(engine, createMockPlugin({ name: 'a', version: '1.0.0' }));
      await loadPlugin(engine, createMockPlugin({ name: 'b', version: '2.0.0' }));

      const loaded = engine.getLoadedPlugins();
      expect(loaded).toHaveLength(2);
      expect(loaded).toEqual(
        expect.arrayContaining([
          { name: 'a', version: '1.0.0', status: 'active' },
          { name: 'b', version: '2.0.0', status: 'active' },
        ]),
      );
    });
  });

  // ----- getRoutes -----
  describe('getRoutes', () => {
    it('should collect routes from active plugins', async () => {
      const routes = [{ method: 'GET' as const, path: '/test', handler: vi.fn() }];
      await loadPlugin(engine, createMockPlugin({ name: 'router', routes: () => routes }));

      const result = engine.getRoutes();
      expect(result).toHaveLength(1);
      expect(result[0]!.pluginName).toBe('router');
      expect(result[0]!.routes).toBe(routes);
    });

    it('should not collect routes from disabled plugins', async () => {
      const e = createEngine({ maxConsecutiveErrors: 1 });
      const routes = [{ method: 'GET' as const, path: '/test', handler: vi.fn() }];
      await loadPlugin(
        e,
        createMockPlugin({
          name: 'disabled-router',
          routes: () => routes,
          onProcessStart: vi.fn().mockRejectedValue(new Error('fail')),
        }),
      );

      // Disable the plugin
      await e.emitHook('onProcessStart', {
        type: 'start' as const,
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      });

      expect(e.getRoutes()).toHaveLength(0);
    });

    it('should handle route() throwing an error gracefully', async () => {
      await loadPlugin(
        engine,
        createMockPlugin({
          name: 'bad-router',
          routes: () => {
            throw new Error('routes error');
          },
        }),
      );

      const result = engine.getRoutes();
      expect(result).toHaveLength(0);
    });
  });

  // ----- getWidgets -----
  describe('getWidgets', () => {
    it('should collect widgets from active plugins', async () => {
      const widgets = [{ id: 'w1', title: 'Widget 1', component: 'W1' }];
      await loadPlugin(engine, createMockPlugin({ name: 'widget-plugin', widgets: () => widgets }));

      const result = engine.getWidgets();
      expect(result).toHaveLength(1);
      expect(result[0]!.pluginName).toBe('widget-plugin');
      expect(result[0]!.widgets).toBe(widgets);
    });

    it('should not collect widgets from disabled plugins', async () => {
      const e = createEngine({ maxConsecutiveErrors: 1 });
      await loadPlugin(
        e,
        createMockPlugin({
          name: 'disabled-widget',
          widgets: () => [{ id: 'w', title: 'W', component: 'C' }],
          onProcessStart: vi.fn().mockRejectedValue(new Error('fail')),
        }),
      );

      await e.emitHook('onProcessStart', {
        type: 'start' as const,
        processId: 1,
        processName: 'a',
        timestamp: new Date(),
        data: {},
      });

      expect(e.getWidgets()).toHaveLength(0);
    });

    it('should handle widgets() throwing an error gracefully', async () => {
      await loadPlugin(
        engine,
        createMockPlugin({
          name: 'bad-widget',
          widgets: () => {
            throw new Error('widget error');
          },
        }),
      );

      expect(engine.getWidgets()).toHaveLength(0);
    });
  });

  // ----- loadFromPluginConfigs -----
  describe('loadFromPluginConfigs', () => {
    it('should load multiple plugins from config array', async () => {
      const pluginA = createMockPlugin({ name: 'cfgA' });
      const pluginB = createMockPlugin({ name: 'cfgB' });

      engine.registerModule('/fake/cfgA', { default: pluginA });
      engine.registerModule('/fake/cfgB', { default: pluginB });

      await engine.loadFromPluginConfigs([
        { name: '/fake/cfgA' },
        { name: '/fake/cfgB', path: '/fake/cfgB' },
      ]);

      expect(engine.getLoadedPlugins()).toHaveLength(2);
    });

    it('should continue loading other plugins if one fails', async () => {
      const pluginB = createMockPlugin({ name: 'cfgB-ok' });
      engine.registerModule('/fake/cfgB-ok', { default: pluginB });

      // cfgA-bad is not registered, so it will fall through to real import and fail
      await engine.loadFromPluginConfigs([
        { name: 'nonexistent-module-xyz-12345' },
        { name: '/fake/cfgB-ok', path: '/fake/cfgB-ok' },
      ]);

      // Only the second plugin should be loaded
      const loaded = engine.getLoadedPlugins();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.name).toBe('cfgB-ok');
    });
  });
});
