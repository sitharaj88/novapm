import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock node:net ---
const mockSocket = {
  on: vi.fn(),
  destroy: vi.fn(),
};
const mockCreateConnection = vi.fn((_opts: unknown, cb?: () => void) => {
  // Default: connection succeeds
  if (cb) process.nextTick(cb);
  return mockSocket;
});

vi.mock('node:net', () => ({
  createConnection: (...args: unknown[]) => mockCreateConnection(...args),
}));

// --- Mock node:child_process ---
const mockChildOn = vi.fn();
const mockSpawn = vi.fn(() => ({
  on: mockChildOn,
  kill: vi.fn(),
  pid: 12345,
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// --- Mock @novapm/shared ---
vi.mock('@novapm/shared', () => ({
  parseDuration: vi.fn((value: string | number) => {
    if (typeof value === 'number') return value;
    const match = value.match(/^(\d+)(ms|s|m|h)$/);
    if (!match) return 0;
    const num = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };
    return num * (multipliers[unit] || 1);
  }),
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// --- Mock global fetch for HTTP checks ---
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { HealthMonitor } from '../health/HealthMonitor.js';
import type { EventBus } from '../events/EventBus.js';
import type { ProcessManager } from '../process/ProcessManager.js';
import type { HealthCheckConfig } from '@novapm/shared';

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    onAny: vi.fn(),
    offAny: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as EventBus;
}

function createMockProcessManager(): ProcessManager {
  return {
    getContainer: vi.fn((_id: number) => ({
      isRunning: vi.fn(() => true),
      getUptime: vi.fn(() => 100),
    })),
    getRunningPids: vi.fn(() => new Map()),
    restart: vi.fn(() => Promise.resolve()),
  } as unknown as ProcessManager;
}

function createHttpConfig(overrides: Partial<HealthCheckConfig> = {}): HealthCheckConfig {
  return {
    type: 'http',
    host: '127.0.0.1',
    port: 3000,
    path: '/health',
    interval: '10s',
    timeout: '5s',
    retries: 3,
    ...overrides,
  };
}

function createTcpConfig(overrides: Partial<HealthCheckConfig> = {}): HealthCheckConfig {
  return {
    type: 'tcp',
    host: '127.0.0.1',
    port: 3000,
    interval: '10s',
    timeout: '5s',
    retries: 3,
    ...overrides,
  };
}

function createScriptConfig(overrides: Partial<HealthCheckConfig> = {}): HealthCheckConfig {
  return {
    type: 'script',
    script: '/usr/local/bin/check.sh',
    interval: '10s',
    timeout: '5s',
    retries: 3,
    ...overrides,
  };
}

/**
 * Flush all pending microtasks (Promises, process.nextTick, queueMicrotask).
 * Uses a chain of real microtask flushes to ensure all async work completes.
 * We cannot use setTimeout here because fake timers intercept it.
 */
async function flushMicrotasks(): Promise<void> {
  // Multiple rounds to ensure nested microtasks resolve
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('HealthMonitor', () => {
  let monitor: HealthMonitor;
  let eventBus: EventBus;
  let processManager: ProcessManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Reset mockSocket event handlers
    mockSocket.on.mockReset();
    mockSocket.destroy.mockReset();

    eventBus = createMockEventBus();
    processManager = createMockProcessManager();
    monitor = new HealthMonitor(eventBus, processManager);
  });

  afterEach(() => {
    monitor.unregisterAll();
    vi.useRealTimers();
  });

  describe('register', () => {
    it('should register a health check for a process', () => {
      const config = createHttpConfig();
      monitor.register(1, 'my-app', config);

      // Process should be considered healthy initially
      expect(monitor.isHealthy(1)).toBe(true);
    });

    it('should replace existing health check when re-registering', () => {
      const config1 = createHttpConfig({ port: 3000 });
      const config2 = createHttpConfig({ port: 4000 });

      monitor.register(1, 'my-app', config1);
      monitor.register(1, 'my-app', config2);

      // Should still be healthy (no errors thrown, old one unregistered)
      expect(monitor.isHealthy(1)).toBe(true);
    });

    it('should handle start_period configuration', () => {
      const config = createHttpConfig({ start_period: '30s' });
      monitor.register(1, 'my-app', config);

      // Process should be healthy during the start period
      expect(monitor.isHealthy(1)).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should unregister a health check', () => {
      const config = createHttpConfig();
      monitor.register(1, 'my-app', config);
      monitor.unregister(1);

      // After unregistering, isHealthy returns true (default for unknown)
      expect(monitor.isHealthy(1)).toBe(true);
    });

    it('should not throw when unregistering non-existent process', () => {
      expect(() => monitor.unregister(999)).not.toThrow();
    });
  });

  describe('unregisterAll', () => {
    it('should unregister all health checks', () => {
      monitor.register(1, 'app-1', createHttpConfig());
      monitor.register(2, 'app-2', createTcpConfig());
      monitor.register(3, 'app-3', createScriptConfig());

      monitor.unregisterAll();

      // All should return default healthy (true)
      expect(monitor.isHealthy(1)).toBe(true);
      expect(monitor.isHealthy(2)).toBe(true);
      expect(monitor.isHealthy(3)).toBe(true);
    });
  });

  describe('isHealthy', () => {
    it('should return true for unregistered processes', () => {
      expect(monitor.isHealthy(999)).toBe(true);
    });

    it('should return true for newly registered processes', () => {
      monitor.register(1, 'my-app', createHttpConfig());
      expect(monitor.isHealthy(1)).toBe(true);
    });
  });

  describe('HTTP health checks', () => {
    it('should mark process as healthy when HTTP returns ok', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const config = createHttpConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      // Advance past the interval to trigger a check
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/health',
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(monitor.isHealthy(1)).toBe(true);
    });

    it('should use default host, port, and path when not specified', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const config: HealthCheckConfig = {
        type: 'http',
        interval: '1s',
        timeout: '5s',
        retries: 1,
      };
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:80/', expect.anything());
    });

    it('should mark process as unhealthy after consecutive failures reaching retries', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      (processManager.restart as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const config = createHttpConfig({ interval: '1s', retries: 3 });
      monitor.register(1, 'my-app', config);

      // 3 consecutive failures needed
      await vi.advanceTimersByTimeAsync(1000); // Failure 1
      await vi.advanceTimersByTimeAsync(1000); // Failure 2
      await vi.advanceTimersByTimeAsync(1000); // Failure 3

      expect(eventBus.emit).toHaveBeenCalledWith(
        'health:fail',
        expect.objectContaining({
          type: 'health-check-fail',
          processId: 1,
          processName: 'my-app',
        }),
      );
    });

    it('should not mark as unhealthy before reaching retry threshold', async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const config = createHttpConfig({ interval: '1s', retries: 3 });
      monitor.register(1, 'my-app', config);

      // Only 2 failures (under the 3 retries threshold)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // health:fail should not have been emitted
      const failEmits = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0] === 'health:fail',
      );
      expect(failEmits).toHaveLength(0);
      expect(monitor.isHealthy(1)).toBe(true);
    });

    it('should resolve false when fetch throws (network error)', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const config = createHttpConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);

      // With retries=1, one failure should trigger unhealthy
      expect(eventBus.emit).toHaveBeenCalledWith(
        'health:fail',
        expect.objectContaining({
          type: 'health-check-fail',
          processId: 1,
        }),
      );
    });

    it('should emit health:restore when an unhealthy process recovers', async () => {
      // First: fail enough times to become unhealthy
      mockFetch.mockResolvedValue({ ok: false });
      (processManager.restart as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const config = createHttpConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000); // Failure -> unhealthy

      // Now succeed
      mockFetch.mockResolvedValue({ ok: true });
      await vi.advanceTimersByTimeAsync(1000);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'health:restore',
        expect.objectContaining({
          type: 'health-check-restore',
          processId: 1,
          processName: 'my-app',
        }),
      );
    });

    it('should reset consecutive failure count on success', async () => {
      // Fail twice, then succeed, then fail twice again
      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: false });

      const config = createHttpConfig({ interval: '1s', retries: 3 });
      monitor.register(1, 'my-app', config);

      // 2 failures
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      // 1 success (resets counter)
      await vi.advanceTimersByTimeAsync(1000);
      // 2 more failures (still under retries=3)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // Should never have reached 3 consecutive failures
      const failEmits = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0] === 'health:fail',
      );
      expect(failEmits).toHaveLength(0);
    });

    it('should auto-restart process on health check failure', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      (processManager.restart as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const config = createHttpConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);

      expect(processManager.restart).toHaveBeenCalledWith(1);
    });

    it('should handle restart failure gracefully', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      (processManager.restart as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Restart failed'),
      );

      const config = createHttpConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      // Should not throw
      await vi.advanceTimersByTimeAsync(1000);

      expect(processManager.restart).toHaveBeenCalledWith(1);
    });
  });

  describe('TCP health checks', () => {
    it('should resolve healthy when TCP connection succeeds', async () => {
      mockCreateConnection.mockImplementation((_opts: unknown, cb?: () => void) => {
        // Call connection callback via nextTick (not affected by fake timers)
        if (cb) process.nextTick(cb);
        return mockSocket;
      });

      const config = createTcpConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);
      // Flush microtasks to let the process.nextTick and async runCheck complete
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockCreateConnection).toHaveBeenCalledWith(
        { host: '127.0.0.1', port: 3000 },
        expect.any(Function),
      );
      expect(monitor.isHealthy(1)).toBe(true);
    });

    it('should resolve unhealthy when TCP connection errors', async () => {
      mockCreateConnection.mockImplementation((_opts: unknown, _cb?: () => void) => {
        // Simulate error event via nextTick so the .on('error') handler is registered first
        process.nextTick(() => {
          const errorHandler = mockSocket.on.mock.calls.find((call) => call[0] === 'error');
          if (errorHandler) {
            errorHandler[1](new Error('ECONNREFUSED'));
          }
        });
        return mockSocket;
      });

      (processManager.restart as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const config = createTcpConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);
      // Flush microtasks for the process.nextTick and subsequent async processing
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(0);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'health:fail',
        expect.objectContaining({
          type: 'health-check-fail',
          processId: 1,
        }),
      );
    });

    it('should use default host and port when not specified', async () => {
      mockCreateConnection.mockImplementation((_opts: unknown, cb?: () => void) => {
        if (cb) process.nextTick(cb);
        return mockSocket;
      });

      const config: HealthCheckConfig = {
        type: 'tcp',
        interval: '1s',
        timeout: '5s',
        retries: 1,
      };
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockCreateConnection).toHaveBeenCalledWith(
        { host: '127.0.0.1', port: 80 },
        expect.any(Function),
      );
    });
  });

  describe('Script health checks', () => {
    it('should resolve healthy when script exits with code 0', async () => {
      mockSpawn.mockImplementation(() => {
        const child = { on: vi.fn(), kill: vi.fn(), pid: 12345 };
        // Use nextTick to fire exit after the .on('exit') handler is registered
        process.nextTick(() => {
          const exitHandler = child.on.mock.calls.find((call) => call[0] === 'exit');
          if (exitHandler) exitHandler[1](0);
        });
        return child;
      });

      const config = createScriptConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSpawn).toHaveBeenCalledWith('sh', ['-c', '/usr/local/bin/check.sh'], {
        timeout: 5000,
        stdio: 'ignore',
      });
      expect(monitor.isHealthy(1)).toBe(true);
    });

    it('should resolve unhealthy when script exits with non-zero code', async () => {
      mockSpawn.mockImplementation(() => {
        const child = { on: vi.fn(), kill: vi.fn(), pid: 12345 };
        process.nextTick(() => {
          const exitHandler = child.on.mock.calls.find((call) => call[0] === 'exit');
          if (exitHandler) exitHandler[1](1);
        });
        return child;
      });

      (processManager.restart as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const config = createScriptConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(0);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'health:fail',
        expect.objectContaining({
          type: 'health-check-fail',
          processId: 1,
        }),
      );
    });

    it('should resolve unhealthy when script spawn errors', async () => {
      mockSpawn.mockImplementation(() => {
        const child = { on: vi.fn(), kill: vi.fn(), pid: 12345 };
        process.nextTick(() => {
          const errorHandler = child.on.mock.calls.find((call) => call[0] === 'error');
          if (errorHandler) errorHandler[1](new Error('ENOENT'));
        });
        return child;
      });

      (processManager.restart as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const config = createScriptConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(0);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'health:fail',
        expect.objectContaining({
          type: 'health-check-fail',
          processId: 1,
        }),
      );
    });

    it('should resolve false when no script is provided', async () => {
      (processManager.restart as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const config: HealthCheckConfig = {
        type: 'script',
        interval: '1s',
        timeout: '5s',
        retries: 1,
        // no script field
      };
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);

      // With retries=1, one failure should trigger unhealthy
      expect(eventBus.emit).toHaveBeenCalledWith(
        'health:fail',
        expect.objectContaining({
          type: 'health-check-fail',
          processId: 1,
        }),
      );
    });
  });

  describe('start period', () => {
    it('should skip health checks during start period', async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const config = createHttpConfig({
        interval: '1s',
        retries: 1,
        start_period: '5s',
      });
      monitor.register(1, 'my-app', config);

      // Check during start period - should be skipped
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      // fetch should not have been called during start period
      expect(mockFetch).not.toHaveBeenCalled();
      expect(monitor.isHealthy(1)).toBe(true);
    });

    it('should run health checks after start period expires', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const config = createHttpConfig({
        interval: '1s',
        retries: 1,
        start_period: '3s',
      });
      monitor.register(1, 'my-app', config);

      // Advance past start period
      await vi.advanceTimersByTimeAsync(3000);

      // Now the next interval tick should run the check
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('process not running', () => {
    it('should skip health check when process is not running', async () => {
      (processManager.getContainer as ReturnType<typeof vi.fn>).mockReturnValue({
        isRunning: vi.fn(() => false),
        getUptime: vi.fn(() => 0),
      });

      mockFetch.mockResolvedValue({ ok: false });

      const config = createHttpConfig({ interval: '1s', retries: 1 });
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);

      // fetch should not be called because process is not running
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('unknown check type', () => {
    it('should default to healthy for unknown check types', async () => {
      const config = {
        type: 'unknown' as 'http',
        interval: '1s',
        timeout: '5s',
        retries: 1,
      };
      monitor.register(1, 'my-app', config);

      await vi.advanceTimersByTimeAsync(1000);

      expect(monitor.isHealthy(1)).toBe(true);
    });
  });

  describe('consecutive failure tracking', () => {
    it('should reset consecutive failures after auto-restart', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      (processManager.restart as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const config = createHttpConfig({ interval: '1s', retries: 2 });
      monitor.register(1, 'my-app', config);

      // 2 failures -> unhealthy -> auto-restart -> counter reset
      await vi.advanceTimersByTimeAsync(1000); // Failure 1
      await vi.advanceTimersByTimeAsync(1000); // Failure 2 -> restart, counter reset

      // Need 2 more failures to trigger again
      await vi.advanceTimersByTimeAsync(1000); // Failure 1 (after reset)

      const failEmits = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0] === 'health:fail',
      );
      // Should have triggered once at failure 2, not at failure 3 (since counter was reset)
      expect(failEmits).toHaveLength(1);
    });

    it('should track failures independently per process', async () => {
      mockFetch.mockResolvedValue({ ok: false });
      (processManager.restart as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const config1 = createHttpConfig({ interval: '1s', retries: 2 });
      const config2 = createHttpConfig({ interval: '2s', retries: 2 });

      monitor.register(1, 'app-1', config1);
      monitor.register(2, 'app-2', config2);

      // After 2 seconds: process 1 has had 2 checks (failures), process 2 has had 1
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      const failEmits = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0] === 'health:fail',
      );

      // Only process 1 should have reached the threshold
      const process1Fails = failEmits.filter((call) => call[1].processId === 1);
      const process2Fails = failEmits.filter((call) => call[1].processId === 2);

      expect(process1Fails).toHaveLength(1);
      expect(process2Fails).toHaveLength(0);
    });
  });
});
