import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@novapm/plugin-sdk';
import type { ProcessEvent, SystemMetrics } from '@novapm/shared';

// ----------------------------------------------------------------
// We mock the Node.js fs/promises module so the Docker detection
// logic can be driven entirely by our tests without touching the
// real filesystem.
// ----------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  constants: { F_OK: 0 },
}));

vi.mock('node:os', () => ({
  hostname: vi.fn().mockReturnValue('regular-hostname'),
}));

import { readFile, access } from 'node:fs/promises';
import { hostname } from 'node:os';

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

function createMockContext(configOverrides: Record<string, unknown> = {}): PluginContext {
  return {
    config: { ...configOverrides },
    logger: createMockLogger(),
    api: {
      getProcesses: vi.fn().mockReturnValue([]),
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

function createProcessEvent(overrides: Partial<ProcessEvent> = {}): ProcessEvent {
  return {
    type: 'start',
    processId: 1,
    processName: 'test-app',
    timestamp: new Date('2025-01-15T10:30:00.000Z'),
    data: {},
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
    memoryTotal: 17179869184,
    memoryUsed: 8589934592,
    memoryFree: 8589934592,
    loadAvg: [1.5, 2.0, 1.8] as [number, number, number],
    uptime: 86400,
    networkInterfaces: [],
    diskUsage: [],
    timestamp: new Date('2025-01-15T10:30:00.000Z'),
    ...overrides,
  };
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('DockerPlugin', () => {
  const mockedReadFile = vi.mocked(readFile);
  const mockedAccess = vi.mocked(access);
  const mockedHostname = vi.mocked(hostname);

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing Docker-like is present
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));
    mockedAccess.mockRejectedValue(new Error('ENOENT'));
    mockedHostname.mockReturnValue('regular-hostname');
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
      expect(plugin.name).toBe('plugin-docker');
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
  // Lifecycle – onInit (non-Docker environment)
  // ------------------------------------------------------------------

  describe('onInit – non-Docker environment', () => {
    it('should initialize and report not running inside Docker', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.logger.info).toHaveBeenCalledWith('Not running inside a Docker container');
    });

    it('should not store container info when not in Docker', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      // Should not set containerInfo in storage
      expect(ctx.storage.set).not.toHaveBeenCalledWith(
        'containerInfo',
        expect.anything(),
      );
    });

    it('should use default socketPath when not configured', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);
      // No error means config was accepted
      expect(ctx.logger.info).toHaveBeenCalled();
    });

    it('should accept custom socketPath config', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ socketPath: '/custom/docker.sock' });
      await plugin.onInit(ctx);
      expect(ctx.logger.info).toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // Lifecycle – onInit (Docker detected via /.dockerenv)
  // ------------------------------------------------------------------

  describe('onInit – Docker detected via .dockerenv', () => {
    it('should detect Docker when /.dockerenv exists', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // /.dockerenv exists
      // cgroup reads fail (not needed)
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.logger.info).toHaveBeenCalledWith(
        { containerId: null, memoryLimit: null, cpuLimit: null },
        'Running inside Docker container',
      );
    });

    it('should store containerInfo in storage when Docker is detected', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // /.dockerenv exists

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ isDocker: true }),
      );
    });
  });

  // ------------------------------------------------------------------
  // Lifecycle – onInit (Docker detected via /proc/1/cgroup)
  // ------------------------------------------------------------------

  describe('onInit – Docker detected via cgroup', () => {
    it('should detect Docker via /proc/1/cgroup containing "docker"', async () => {
      // /.dockerenv does not exist
      mockedAccess.mockRejectedValue(new Error('ENOENT'));
      // /proc/1/cgroup contains docker
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/proc/1/cgroup') {
          return '12:memory:/docker/abc123def456\n' as never;
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ isDocker: true }),
      );
    });

    it('should detect Docker via /proc/1/cgroup containing "containerd"', async () => {
      mockedAccess.mockRejectedValue(new Error('ENOENT'));
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/proc/1/cgroup') {
          return '12:memory:/containerd/abc123\n' as never;
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ isDocker: true }),
      );
    });
  });

  // ------------------------------------------------------------------
  // Lifecycle – onInit (Docker detected via /proc/self/mountinfo)
  // ------------------------------------------------------------------

  describe('onInit – Docker detected via mountinfo', () => {
    it('should detect Docker via /proc/self/mountinfo containing "docker"', async () => {
      mockedAccess.mockRejectedValue(new Error('ENOENT'));
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/proc/self/mountinfo') {
          return '145 32 0:50 / /docker/overlay2 rw\n' as never;
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ isDocker: true }),
      );
    });
  });

  // ------------------------------------------------------------------
  // Container ID detection
  // ------------------------------------------------------------------

  describe('container ID detection', () => {
    it('should extract 64-char hex container ID from /proc/self/cgroup', async () => {
      const fakeContainerId = 'a'.repeat(64);
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/proc/self/cgroup') {
          return `12:memory:/docker/${fakeContainerId}\n` as never;
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ containerId: fakeContainerId }),
      );
    });

    it('should extract container ID from /proc/self/mountinfo as fallback', async () => {
      const fakeContainerId = 'b'.repeat(64);
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/proc/self/mountinfo') {
          return `/docker/${fakeContainerId}/data\n` as never;
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ containerId: fakeContainerId }),
      );
    });

    it('should use hostname as container ID if it is a 12-char hex string', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedHostname.mockReturnValue('abcdef012345');

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ containerId: 'abcdef012345' }),
      );
    });

    it('should not use hostname as container ID if it does not match 12-char hex pattern', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));
      mockedHostname.mockReturnValue('my-server');

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ containerId: null }),
      );
    });
  });

  // ------------------------------------------------------------------
  // Resource limits – memory
  // ------------------------------------------------------------------

  describe('memory limit detection', () => {
    it('should read memory limit from cgroup v2 (memory.max)', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/sys/fs/cgroup/memory.max') {
          return '536870912\n' as never; // 512 MB
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ memoryLimitBytes: 536870912 }),
      );
    });

    it('should read memory limit from cgroup v1 when v2 is "max"', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/sys/fs/cgroup/memory.max') {
          return 'max\n' as never;
        }
        if (path === '/sys/fs/cgroup/memory/memory.limit_in_bytes') {
          return '1073741824\n' as never; // 1 GB
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ memoryLimitBytes: 1073741824 }),
      );
    });

    it('should treat very large cgroup v1 values as no limit', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/sys/fs/cgroup/memory/memory.limit_in_bytes') {
          return '9223372036854771712\n' as never; // ~max int64
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({ memoryLimitBytes: null }),
      );
    });
  });

  // ------------------------------------------------------------------
  // Resource limits – CPU
  // ------------------------------------------------------------------

  describe('CPU limit detection', () => {
    it('should read CPU limit from cgroup v2 (cpu.max)', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/sys/fs/cgroup/cpu.max') {
          return '200000 100000\n' as never; // 2 cores
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({
          cpuQuota: 200000,
          cpuPeriod: 100000,
          effectiveCpuLimit: 2,
        }),
      );
    });

    it('should read CPU limit from cgroup v1 (cfs_quota/period)', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/sys/fs/cgroup/cpu.max') {
          return 'max 100000\n' as never; // v2 says "max" = unlimited
        }
        if (path === '/sys/fs/cgroup/cpu/cpu.cfs_quota_us') {
          return '150000\n' as never;
        }
        if (path === '/sys/fs/cgroup/cpu/cpu.cfs_period_us') {
          return '100000\n' as never;
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({
          cpuQuota: 150000,
          cpuPeriod: 100000,
          effectiveCpuLimit: 1.5,
        }),
      );
    });

    it('should leave CPU limit null when no cgroup info is available', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'containerInfo',
        expect.objectContaining({
          cpuQuota: null,
          cpuPeriod: null,
          effectiveCpuLimit: null,
        }),
      );
    });
  });

  // ------------------------------------------------------------------
  // Lifecycle – onDestroy
  // ------------------------------------------------------------------

  describe('onDestroy', () => {
    it('should execute without errors', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);
      await expect(plugin.onDestroy!()).resolves.toBeUndefined();
      expect(ctx.logger.info).toHaveBeenCalledWith('Docker plugin destroyed');
    });
  });

  // ------------------------------------------------------------------
  // onProcessStart
  // ------------------------------------------------------------------

  describe('onProcessStart', () => {
    it('should store container-aware process metadata when in Docker', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockImplementation(async (path: unknown) => {
        const fakeId = 'c'.repeat(64);
        if (path === '/proc/self/cgroup') {
          return `12:memory:/docker/${fakeId}\n` as never;
        }
        if (path === '/sys/fs/cgroup/memory.max') {
          return '1073741824\n' as never; // 1GB
        }
        if (path === '/sys/fs/cgroup/cpu.max') {
          return '200000 100000\n' as never; // 2 CPUs
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      // Clear init storage calls
      vi.mocked(ctx.storage.set).mockClear();

      const event = createProcessEvent({ processId: 5, processName: 'worker' });
      await plugin.onProcessStart!(event);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'process:5:container',
        expect.objectContaining({
          containerId: 'c'.repeat(64),
          memoryLimitBytes: 1073741824,
          effectiveCpuLimit: 2,
          startedAt: '2025-01-15T10:30:00.000Z',
        }),
      );
    });

    it('should do nothing when not in Docker', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      vi.mocked(ctx.storage.set).mockClear();

      const event = createProcessEvent();
      await plugin.onProcessStart!(event);

      // Should not store process-level container metadata
      expect(ctx.storage.set).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // onSystemMetrics
  // ------------------------------------------------------------------

  describe('onSystemMetrics', () => {
    it('should store container-adjusted metrics when in Docker with memory limit', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/sys/fs/cgroup/memory.max') {
          return '4294967296\n' as never; // 4GB
        }
        if (path === '/sys/fs/cgroup/cpu.max') {
          return '400000 100000\n' as never; // 4 CPUs
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);
      vi.mocked(ctx.storage.set).mockClear();

      const metrics = createSystemMetrics({
        memoryUsed: 2147483648, // 2GB used
        memoryTotal: 17179869184, // 16GB host total
      });
      await plugin.onSystemMetrics!(metrics);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'latestContainerMetrics',
        expect.objectContaining({
          containerMemoryLimit: 4294967296,
          containerCpuLimit: 4,
          // 2GB / 4GB * 100 = 50%
          containerMemoryUsagePercent: 50,
        }),
      );
    });

    it('should cap memory usage percent at 100', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockImplementation(async (path: unknown) => {
        if (path === '/sys/fs/cgroup/memory.max') {
          return '1073741824\n' as never; // 1GB limit
        }
        throw new Error('ENOENT');
      });

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);
      vi.mocked(ctx.storage.set).mockClear();

      // Memory used exceeds limit (can happen briefly)
      const metrics = createSystemMetrics({ memoryUsed: 2147483648 }); // 2GB
      await plugin.onSystemMetrics!(metrics);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'latestContainerMetrics',
        expect.objectContaining({
          containerMemoryUsagePercent: 100,
        }),
      );
    });

    it('should do nothing when not in Docker', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);
      vi.mocked(ctx.storage.set).mockClear();

      await plugin.onSystemMetrics!(createSystemMetrics());

      expect(ctx.storage.set).not.toHaveBeenCalled();
    });

    it('should not include containerMemoryUsagePercent when memory limit is null', async () => {
      mockedAccess.mockResolvedValueOnce(undefined); // Docker detected
      mockedReadFile.mockRejectedValue(new Error('ENOENT'));

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);
      vi.mocked(ctx.storage.set).mockClear();

      await plugin.onSystemMetrics!(createSystemMetrics());

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'latestContainerMetrics',
        expect.not.objectContaining({
          containerMemoryUsagePercent: expect.anything(),
        }),
      );
    });
  });
});
