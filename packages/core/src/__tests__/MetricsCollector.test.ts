import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock pidusage ---
const mockPidusage = vi.fn();
vi.mock('pidusage', () => ({
  default: (...args: unknown[]) => mockPidusage(...args),
}));

// --- Mock @novapm/shared ---
vi.mock('@novapm/shared', () => ({
  DEFAULT_METRICS_INTERVAL: 5000,
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { MetricsCollector } from '../metrics/MetricsCollector.js';
import type { EventBus } from '../events/EventBus.js';
import type { MetricsRepository } from '../db/repositories/MetricsRepository.js';
import type { ProcessManager } from '../process/ProcessManager.js';
import type { ProcessMetrics } from '@novapm/shared';

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

function createMockMetricsRepo(): MetricsRepository {
  return {
    insert: vi.fn(),
    insertBatch: vi.fn(),
    getLatest: vi.fn(),
    getRange: vi.fn(),
    downsample: vi.fn(),
    cleanup: vi.fn(),
  } as unknown as MetricsRepository;
}

function createMockProcessManager(
  pids: Map<number, number> = new Map(),
  uptimes: Map<number, number> = new Map(),
): ProcessManager {
  return {
    getRunningPids: vi.fn(() => pids),
    getContainer: vi.fn((processId: number) => ({
      getUptime: vi.fn(() => uptimes.get(processId) ?? 100),
      isRunning: vi.fn(() => true),
    })),
    restart: vi.fn(),
  } as unknown as ProcessManager;
}

describe('MetricsCollector', () => {
  let collector: MetricsCollector;
  let eventBus: EventBus;
  let metricsRepo: MetricsRepository;
  let processManager: ProcessManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    eventBus = createMockEventBus();
    metricsRepo = createMockMetricsRepo();
  });

  afterEach(() => {
    collector?.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create collector with default interval', () => {
      processManager = createMockProcessManager();
      collector = new MetricsCollector(eventBus, metricsRepo, processManager);
      expect(collector).toBeDefined();
    });

    it('should accept a custom interval', () => {
      processManager = createMockProcessManager();
      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 1000);
      expect(collector).toBeDefined();
    });
  });

  describe('start / stop', () => {
    it('should call collect immediately on start', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);
      mockPidusage.mockResolvedValue({
        1001: { cpu: 25.5, memory: 1024 * 1024 * 50, elapsed: 10000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      // Allow the initial async collect() to complete
      await vi.advanceTimersByTimeAsync(0);

      expect(processManager.getRunningPids).toHaveBeenCalled();
    });

    it('should collect metrics at the specified interval', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);
      mockPidusage.mockResolvedValue({
        1001: { cpu: 10, memory: 1024, elapsed: 5000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 1000);
      collector.start();

      await vi.advanceTimersByTimeAsync(1000);

      // Initial call + 1 interval call = at least 2 calls
      expect(
        (processManager.getRunningPids as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBeGreaterThanOrEqual(2);
    });

    it('should stop collecting metrics when stop is called', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);
      mockPidusage.mockResolvedValue({
        1001: { cpu: 10, memory: 1024, elapsed: 5000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 1000);
      collector.start();

      await vi.advanceTimersByTimeAsync(1000);
      const callCountAfterStart = (processManager.getRunningPids as ReturnType<typeof vi.fn>).mock
        .calls.length;

      collector.stop();

      await vi.advanceTimersByTimeAsync(5000);
      const callCountAfterStop = (processManager.getRunningPids as ReturnType<typeof vi.fn>).mock
        .calls.length;

      expect(callCountAfterStop).toBe(callCountAfterStart);
    });

    it('should handle stop being called when not started', () => {
      processManager = createMockProcessManager();
      collector = new MetricsCollector(eventBus, metricsRepo, processManager);

      expect(() => collector.stop()).not.toThrow();
    });

    it('should handle stop being called multiple times', () => {
      processManager = createMockProcessManager();
      collector = new MetricsCollector(eventBus, metricsRepo, processManager);
      collector.start();

      expect(() => {
        collector.stop();
        collector.stop();
      }).not.toThrow();
    });
  });

  describe('collect', () => {
    it('should skip collection when no running pids exist', async () => {
      processManager = createMockProcessManager(new Map());
      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 1000);
      collector.start();

      // Advance just enough time to flush the initial sync call (no async work since pids are empty)
      await vi.advanceTimersByTimeAsync(0);

      expect(mockPidusage).not.toHaveBeenCalled();
      expect(metricsRepo.insertBatch).not.toHaveBeenCalled();
    });

    it('should collect metrics for running processes', async () => {
      const pids = new Map([[1, 1001]]);
      const uptimes = new Map([[1, 300]]);
      processManager = createMockProcessManager(pids, uptimes);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 45.678, memory: 1024 * 1024 * 128, elapsed: 60000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(mockPidusage).toHaveBeenCalledWith([1001]);
    });

    it('should round CPU to 2 decimal places', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 45.6789, memory: 1024, elapsed: 1000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      const latest = collector.getLatest(1);
      expect(latest).toBeDefined();
      expect(latest!.cpu).toBe(45.68);
    });

    it('should store raw memory value from pidusage', async () => {
      const memoryBytes = 1024 * 1024 * 256; // 256MB
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 10, memory: memoryBytes, elapsed: 1000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      const latest = collector.getLatest(1);
      expect(latest!.memory).toBe(memoryBytes);
    });

    it('should emit metric:process event for each process', async () => {
      const pids = new Map([
        [1, 1001],
        [2, 2002],
      ]);
      processManager = createMockProcessManager(pids);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 10, memory: 1024, elapsed: 1000 },
        2002: { cpu: 20, memory: 2048, elapsed: 2000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      const emitCalls = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls;
      const metricEmits = emitCalls.filter((call) => call[0] === 'metric:process');
      expect(metricEmits).toHaveLength(2);
    });

    it('should insert metrics batch into repository', async () => {
      const pids = new Map([
        [1, 1001],
        [2, 2002],
      ]);
      processManager = createMockProcessManager(pids);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 10, memory: 1024, elapsed: 1000 },
        2002: { cpu: 20, memory: 2048, elapsed: 2000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(metricsRepo.insertBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ processId: 1 }),
          expect.objectContaining({ processId: 2 }),
        ]),
      );
    });

    it('should skip processes whose stats are missing from pidusage response', async () => {
      const pids = new Map([
        [1, 1001],
        [2, 2002],
      ]);
      processManager = createMockProcessManager(pids);

      // Only return stats for pid 1001; 2002 is missing
      mockPidusage.mockResolvedValue({
        1001: { cpu: 10, memory: 1024, elapsed: 1000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(collector.getLatest(1)).toBeDefined();
      expect(collector.getLatest(2)).toBeUndefined();
    });

    it('should handle pidusage errors gracefully', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);

      mockPidusage.mockRejectedValue(new Error('Process not found'));

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      // Should not throw, and no metrics should be stored
      expect(collector.getLatest(1)).toBeUndefined();
      expect(metricsRepo.insertBatch).not.toHaveBeenCalled();
    });

    it('should include uptime from the process container', async () => {
      const pids = new Map([[1, 1001]]);
      const uptimes = new Map([[1, 450]]);
      processManager = createMockProcessManager(pids, uptimes);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 5, memory: 512, elapsed: 1000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      const latest = collector.getLatest(1);
      expect(latest!.uptime).toBe(450);
    });

    it('should set heapUsed, heapTotal, eventLoopLatency, activeHandles, activeRequests to 0', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 5, memory: 512, elapsed: 1000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      const latest = collector.getLatest(1);
      expect(latest!.heapUsed).toBe(0);
      expect(latest!.heapTotal).toBe(0);
      expect(latest!.eventLoopLatency).toBe(0);
      expect(latest!.activeHandles).toBe(0);
      expect(latest!.activeRequests).toBe(0);
    });

    it('should include a timestamp in the metrics', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 5, memory: 512, elapsed: 1000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      const latest = collector.getLatest(1);
      expect(latest!.timestamp).toBeInstanceOf(Date);
    });

    it('should not insert batch when no stats are collected', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);

      // Return empty stats for the pid
      mockPidusage.mockResolvedValue({});

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      expect(metricsRepo.insertBatch).not.toHaveBeenCalled();
    });
  });

  describe('getLatest', () => {
    it('should return undefined for a process with no metrics', () => {
      processManager = createMockProcessManager();
      collector = new MetricsCollector(eventBus, metricsRepo, processManager);

      expect(collector.getLatest(999)).toBeUndefined();
    });

    it('should return the most recent metrics after collection', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 30, memory: 2048, elapsed: 1000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      const latest = collector.getLatest(1);
      expect(latest).toBeDefined();
      expect(latest!.processId).toBe(1);
      expect(latest!.cpu).toBe(30);
      expect(latest!.memory).toBe(2048);
    });

    it('should return updated metrics after subsequent collections', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);

      // First collection
      mockPidusage.mockResolvedValueOnce({
        1001: { cpu: 10, memory: 1024, elapsed: 1000 },
      });
      // Second collection
      mockPidusage.mockResolvedValueOnce({
        1001: { cpu: 50, memory: 4096, elapsed: 2000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 1000);
      collector.start();

      // Let first collection run
      await vi.advanceTimersByTimeAsync(0);

      let latest = collector.getLatest(1);
      expect(latest!.cpu).toBe(10);

      // Advance to trigger second collection
      await vi.advanceTimersByTimeAsync(1000);

      latest = collector.getLatest(1);
      expect(latest!.cpu).toBe(50);
      expect(latest!.memory).toBe(4096);
    });
  });

  describe('getAllLatest', () => {
    it('should return empty map when no metrics collected', () => {
      processManager = createMockProcessManager();
      collector = new MetricsCollector(eventBus, metricsRepo, processManager);

      const all = collector.getAllLatest();
      expect(all.size).toBe(0);
    });

    it('should return a copy of the internal metrics map', async () => {
      const pids = new Map([
        [1, 1001],
        [2, 2002],
      ]);
      processManager = createMockProcessManager(pids);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 10, memory: 1024, elapsed: 1000 },
        2002: { cpu: 20, memory: 2048, elapsed: 2000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      const all = collector.getAllLatest();
      expect(all.size).toBe(2);
      expect(all.get(1)!.cpu).toBe(10);
      expect(all.get(2)!.cpu).toBe(20);
    });

    it('should return a new Map instance (not the internal one)', async () => {
      const pids = new Map([[1, 1001]]);
      processManager = createMockProcessManager(pids);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 10, memory: 1024, elapsed: 1000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      const all1 = collector.getAllLatest();
      const all2 = collector.getAllLatest();

      // Should be different Map instances
      expect(all1).not.toBe(all2);
      // But contain the same data
      expect(all1.get(1)!.cpu).toBe(all2.get(1)!.cpu);
    });
  });

  describe('metrics structure', () => {
    it('should produce a complete ProcessMetrics object', async () => {
      const pids = new Map([[1, 1001]]);
      const uptimes = new Map([[1, 600]]);
      processManager = createMockProcessManager(pids, uptimes);

      mockPidusage.mockResolvedValue({
        1001: { cpu: 12.34, memory: 67108864, elapsed: 5000 },
      });

      collector = new MetricsCollector(eventBus, metricsRepo, processManager, 5000);
      collector.start();

      await vi.advanceTimersByTimeAsync(0);

      const latest = collector.getLatest(1);
      expect(latest).toEqual<ProcessMetrics>({
        processId: 1,
        cpu: 12.34,
        memory: 67108864,
        heapUsed: 0,
        heapTotal: 0,
        eventLoopLatency: 0,
        activeHandles: 0,
        activeRequests: 0,
        uptime: 600,
        timestamp: expect.any(Date),
      });
    });
  });
});
