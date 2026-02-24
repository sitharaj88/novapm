import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@novapm/plugin-sdk';
import type { ProcessMetrics, SystemMetrics, NovaProcess } from '@novapm/shared';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
  } as unknown as PluginContext['logger'];
}

function createMockContext(processes: Partial<NovaProcess>[] = []): PluginContext {
  return {
    config: {},
    logger: createMockLogger(),
    api: {
      getProcesses: vi.fn().mockReturnValue(
        processes.map((p) => ({
          id: p.id ?? 1,
          name: p.name ?? 'test-app',
          restarts: p.restarts ?? 0,
          status: p.status ?? 'online',
          script: '',
          cwd: '',
          args: [],
          interpreter: 'node',
          interpreterArgs: [],
          execMode: 'fork' as const,
          instances: 1,
          pid: 1234,
          port: null,
          env: {},
          createdAt: new Date(),
          startedAt: new Date(),
          maxRestarts: 16,
          restartDelay: 0,
          expBackoffRestartDelay: 0,
          maxMemoryRestart: null,
          autorestart: true,
          watch: false,
          ignoreWatch: [],
          killTimeout: 5000,
          listenTimeout: 8000,
          shutdownWithMessage: false,
          windowsHide: false,
          mergeLogs: false,
          sourceMapSupport: false,
          vizion: false,
          ...p,
        })),
      ),
      getProcess: vi.fn().mockReturnValue(null),
      restartProcess: vi.fn(),
      stopProcess: vi.fn(),
      scaleProcess: vi.fn(),
      getMetrics: vi.fn().mockReturnValue(null),
      getSystemMetrics: vi.fn().mockReturnValue(null),
      getRecentLogs: vi.fn().mockReturnValue([]),
      emit: vi.fn(),
      on: vi.fn(),
    },
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    },
  };
}

function createProcessMetrics(overrides: Partial<ProcessMetrics> = {}): ProcessMetrics {
  return {
    processId: 1,
    cpu: 25.5,
    memory: 52428800, // 50 MB
    heapUsed: 20000000,
    heapTotal: 40000000,
    eventLoopLatency: 1.5,
    activeHandles: 10,
    activeRequests: 2,
    uptime: 3600000, // 1 hour in ms
    timestamp: new Date('2025-01-15T10:30:00.000Z'),
    ...overrides,
  };
}

function createSystemMetrics(overrides: Partial<SystemMetrics> = {}): SystemMetrics {
  return {
    hostname: 'test-host',
    platform: 'linux',
    arch: 'x64',
    cpuCount: 4,
    cpuModel: 'Intel Core i7',
    cpuUsage: 45.2,
    cpuUsagePerCore: [40, 50, 45, 46],
    memoryTotal: 17179869184, // 16 GB
    memoryUsed: 8589934592, // 8 GB
    memoryFree: 8589934592,
    loadAvg: [1.5, 2.0, 1.8] as [number, number, number],
    uptime: 86400, // 1 day
    networkInterfaces: [],
    diskUsage: [],
    timestamp: new Date('2025-01-15T10:30:00.000Z'),
    ...overrides,
  };
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('PrometheusPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function getPlugin() {
    // Reset modules to get a fresh singleton instance (avoids state leakage)
    vi.resetModules();
    const mod = await import('../index.js');
    return mod.default;
  }

  // ------------------------------------------------------------------
  // Metadata
  // ------------------------------------------------------------------

  describe('plugin metadata', () => {
    it('should have the correct name', async () => {
      const plugin = await getPlugin();
      expect(plugin.name).toBe('plugin-prometheus');
    });

    it('should have a valid semver version', async () => {
      const plugin = await getPlugin();
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should have a description', async () => {
      const plugin = await getPlugin();
      expect(typeof plugin.description).toBe('string');
    });

    it('should have an author', async () => {
      const plugin = await getPlugin();
      expect(plugin.author).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  describe('onInit', () => {
    it('should initialize successfully', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await expect(plugin.onInit(ctx)).resolves.toBeUndefined();
      expect(ctx.logger.info).toHaveBeenCalledWith('Prometheus plugin initialized');
    });
  });

  describe('onDestroy', () => {
    it('should execute without errors', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);
      await expect(plugin.onDestroy!()).resolves.toBeUndefined();
      expect(ctx.logger.info).toHaveBeenCalledWith('Prometheus plugin destroyed');
    });
  });

  // ------------------------------------------------------------------
  // Metrics collection hooks
  // ------------------------------------------------------------------

  describe('onMetricsCollected', () => {
    it('should store the latest process metrics', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext([
        { id: 1, name: 'web-app', restarts: 3 },
        { id: 2, name: 'worker', restarts: 1 },
      ]);
      await plugin.onInit(ctx);

      const metrics = [
        createProcessMetrics({ processId: 1, cpu: 30, memory: 100000000, uptime: 7200000 }),
        createProcessMetrics({ processId: 2, cpu: 10, memory: 50000000, uptime: 3600000 }),
      ];
      await plugin.onMetricsCollected!(metrics);

      // Verify by calling the route handler to get metrics output
      const routes = plugin.routes!();
      const metricsRoute = routes.find((r) => r.path.includes('metrics'));
      const result = (await metricsRoute!.handler({}, {})) as { body: string };

      expect(result.body).toContain('novapm_process_cpu_usage');
      expect(result.body).toContain('process_name="web-app"');
      expect(result.body).toContain('process_name="worker"');
    });
  });

  describe('onSystemMetrics', () => {
    it('should store the latest system metrics', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      await plugin.onSystemMetrics!(createSystemMetrics({ hostname: 'prod-server-1' }));

      const routes = plugin.routes!();
      const metricsRoute = routes.find((r) => r.path.includes('metrics'));
      const result = (await metricsRoute!.handler({}, {})) as { body: string };

      expect(result.body).toContain('novapm_system_cpu_usage');
      expect(result.body).toContain('hostname="prod-server-1"');
    });
  });

  // ------------------------------------------------------------------
  // Routes
  // ------------------------------------------------------------------

  describe('routes', () => {
    it('should register a GET /metrics route', async () => {
      const plugin = await getPlugin();
      const routes = plugin.routes!();

      expect(routes).toHaveLength(1);
      expect(routes[0].method).toBe('GET');
      expect(routes[0].path).toBe('/api/v1/plugins/prometheus/metrics');
      expect(typeof routes[0].handler).toBe('function');
    });

    it('should return 200 with proper content type', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as {
        statusCode: number;
        headers: Record<string, string>;
        body: string;
      };

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8');
      expect(typeof result.body).toBe('string');
    });
  });

  // ------------------------------------------------------------------
  // Prometheus text format output
  // ------------------------------------------------------------------

  describe('metrics output format', () => {
    it('should output empty string when no metrics are collected', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };

      // No metrics collected yet, so output should be empty or have no data lines
      expect(result.body).toBe('');
    });

    it('should produce valid Prometheus text exposition format for process metrics', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext([
        { id: 1, name: 'api-server', restarts: 5 },
      ]);
      await plugin.onInit(ctx);

      await plugin.onMetricsCollected!([
        createProcessMetrics({ processId: 1, cpu: 42.5, memory: 104857600, uptime: 7200000 }),
      ]);

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };
      const output = result.body;

      // Check HELP and TYPE comments
      expect(output).toContain('# HELP novapm_process_cpu_usage');
      expect(output).toContain('# TYPE novapm_process_cpu_usage gauge');
      expect(output).toContain('# HELP novapm_process_memory_bytes');
      expect(output).toContain('# TYPE novapm_process_memory_bytes gauge');
      expect(output).toContain('# HELP novapm_process_restarts_total');
      expect(output).toContain('# TYPE novapm_process_restarts_total counter');
      expect(output).toContain('# HELP novapm_process_uptime_seconds');
      expect(output).toContain('# TYPE novapm_process_uptime_seconds gauge');

      // Check data lines
      expect(output).toContain('novapm_process_cpu_usage{process_id="1",process_name="api-server"} 42.5');
      expect(output).toContain('novapm_process_memory_bytes{process_id="1",process_name="api-server"} 104857600');
      expect(output).toContain('novapm_process_restarts_total{process_id="1",process_name="api-server"} 5');
      // uptime should be in seconds (7200000ms / 1000 = 7200)
      expect(output).toContain('novapm_process_uptime_seconds{process_id="1",process_name="api-server"} 7200');
    });

    it('should produce valid Prometheus format for system metrics', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      await plugin.onSystemMetrics!(
        createSystemMetrics({
          hostname: 'node-01',
          cpuUsage: 55.5,
          memoryUsed: 8589934592,
          memoryTotal: 17179869184,
          uptime: 86400,
          loadAvg: [1.5, 2.0, 1.8],
        }),
      );

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };
      const output = result.body;

      // System CPU
      expect(output).toContain('# HELP novapm_system_cpu_usage');
      expect(output).toContain('# TYPE novapm_system_cpu_usage gauge');
      expect(output).toContain('novapm_system_cpu_usage{hostname="node-01"} 55.5');

      // System memory
      expect(output).toContain('# HELP novapm_system_memory_used_bytes');
      expect(output).toContain('novapm_system_memory_used_bytes{hostname="node-01"} 8589934592');

      expect(output).toContain('# HELP novapm_system_memory_total_bytes');
      expect(output).toContain('novapm_system_memory_total_bytes{hostname="node-01"} 17179869184');

      // System uptime
      expect(output).toContain('# HELP novapm_system_uptime_seconds');
      expect(output).toContain('novapm_system_uptime_seconds{hostname="node-01"} 86400');

      // Load averages
      expect(output).toContain('# HELP novapm_system_load_average');
      expect(output).toContain('# TYPE novapm_system_load_average gauge');
      expect(output).toContain('novapm_system_load_average{hostname="node-01",period="1m"} 1.5');
      expect(output).toContain('novapm_system_load_average{hostname="node-01",period="5m"} 2');
      expect(output).toContain('novapm_system_load_average{hostname="node-01",period="15m"} 1.8');
    });

    it('should handle multiple processes in the output', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext([
        { id: 1, name: 'api', restarts: 2 },
        { id: 2, name: 'worker', restarts: 0 },
        { id: 3, name: 'scheduler', restarts: 1 },
      ]);
      await plugin.onInit(ctx);

      await plugin.onMetricsCollected!([
        createProcessMetrics({ processId: 1, cpu: 10 }),
        createProcessMetrics({ processId: 2, cpu: 20 }),
        createProcessMetrics({ processId: 3, cpu: 30 }),
      ]);

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };
      const output = result.body;

      expect(output).toContain('process_name="api"');
      expect(output).toContain('process_name="worker"');
      expect(output).toContain('process_name="scheduler"');
    });

    it('should use fallback process name when process is not found via API', async () => {
      const plugin = await getPlugin();
      // No processes returned by API
      const ctx = createMockContext([]);
      await plugin.onInit(ctx);

      await plugin.onMetricsCollected!([
        createProcessMetrics({ processId: 99, cpu: 15 }),
      ]);

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };
      const output = result.body;

      // Should use fallback name
      expect(output).toContain('process_name="process-99"');
    });

    it('should combine both process and system metrics in the output', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext([{ id: 1, name: 'my-app', restarts: 0 }]);
      await plugin.onInit(ctx);

      await plugin.onMetricsCollected!([createProcessMetrics({ processId: 1 })]);
      await plugin.onSystemMetrics!(createSystemMetrics());

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };
      const output = result.body;

      // Both process and system metrics should be present
      expect(output).toContain('novapm_process_cpu_usage');
      expect(output).toContain('novapm_system_cpu_usage');
    });
  });

  // ------------------------------------------------------------------
  // Label formatting
  // ------------------------------------------------------------------

  describe('label formatting', () => {
    it('should escape backslashes in label values', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext([{ id: 1, name: 'app\\server', restarts: 0 }]);
      await plugin.onInit(ctx);

      await plugin.onMetricsCollected!([createProcessMetrics({ processId: 1 })]);

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };

      expect(result.body).toContain('app\\\\server');
    });

    it('should escape double quotes in label values', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext([{ id: 1, name: 'app"test', restarts: 0 }]);
      await plugin.onInit(ctx);

      await plugin.onMetricsCollected!([createProcessMetrics({ processId: 1 })]);

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };

      expect(result.body).toContain('app\\"test');
    });

    it('should escape newlines in label values', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext([{ id: 1, name: 'app\ntest', restarts: 0 }]);
      await plugin.onInit(ctx);

      await plugin.onMetricsCollected!([createProcessMetrics({ processId: 1 })]);

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };

      expect(result.body).toContain('app\\ntest');
    });
  });

  // ------------------------------------------------------------------
  // Skipping metrics with no values
  // ------------------------------------------------------------------

  describe('metrics with no values', () => {
    it('should skip restarts metric when process is not found via API', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext([]); // no processes
      await plugin.onInit(ctx);

      await plugin.onMetricsCollected!([
        createProcessMetrics({ processId: 999 }),
      ]);

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };
      const output = result.body;

      // restarts metric should not appear since the process was not found
      expect(output).not.toContain('novapm_process_restarts_total');
    });

    it('should not include system metrics when none have been collected', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext([{ id: 1, name: 'app', restarts: 0 }]);
      await plugin.onInit(ctx);

      await plugin.onMetricsCollected!([createProcessMetrics({ processId: 1 })]);
      // Note: No onSystemMetrics call

      const routes = plugin.routes!();
      const result = (await routes[0].handler({}, {})) as { body: string };
      const output = result.body;

      expect(output).not.toContain('novapm_system_cpu_usage');
      expect(output).not.toContain('novapm_system_memory_used_bytes');
    });
  });
});
