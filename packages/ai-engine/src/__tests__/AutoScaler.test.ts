import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoScaler } from '../scaling/AutoScaler.js';
import type { ProcessMetrics } from '@novapm/shared';

// Mock os.totalmem to return a predictable value (16 GB)
vi.mock('node:os', () => ({
  totalmem: () => 16 * 1024 * 1024 * 1024, // 16 GB
}));

function createMetrics(
  overrides: Partial<ProcessMetrics>[] | Partial<ProcessMetrics>,
  count = 10,
): ProcessMetrics[] {
  if (Array.isArray(overrides)) {
    return overrides.map((override, i) => ({
      processId: 1,
      cpu: 50,
      memory: 500 * 1024 * 1024, // 500 MB
      heapUsed: 200 * 1024 * 1024,
      heapTotal: 400 * 1024 * 1024,
      eventLoopLatency: 5,
      activeHandles: 10,
      activeRequests: 2,
      uptime: 3600,
      timestamp: new Date(Date.now() - (overrides.length - i) * 60_000),
      ...override,
    }));
  }

  return Array.from({ length: count }, (_, i) => ({
    processId: 1,
    cpu: 50,
    memory: 500 * 1024 * 1024,
    heapUsed: 200 * 1024 * 1024,
    heapTotal: 400 * 1024 * 1024,
    eventLoopLatency: 5,
    activeHandles: 10,
    activeRequests: 2,
    uptime: 3600,
    timestamp: new Date(Date.now() - (count - i) * 60_000),
    ...overrides,
  }));
}

describe('AutoScaler', () => {
  let scaler: AutoScaler;

  beforeEach(() => {
    scaler = new AutoScaler({
      min: 1,
      max: 10,
      cpuThreshold: 70,
      memoryThreshold: 80,
      cooldown: 0, // Disable cooldown for testing
      scaleUpStep: 1,
      scaleDownStep: 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scale up when high CPU', () => {
    it('should scale up when average CPU exceeds threshold with sustained readings', () => {
      // All readings at 85% CPU (above 70% threshold)
      const metrics = createMetrics({ cpu: 85 }, 10);
      const event = scaler.evaluate(1, 'my-app', 2, metrics);
      expect(event).not.toBeNull();
      expect(event!.direction).toBe('up');
      expect(event!.fromInstances).toBe(2);
      expect(event!.toInstances).toBe(3);
    });

    it('should not scale up when CPU is below threshold', () => {
      const metrics = createMetrics({ cpu: 50 }, 10);
      const event = scaler.evaluate(1, 'my-app', 2, metrics);
      // CPU is at 50%, below 70% threshold, and also below 35% (half threshold) scale-down
      // It should not scale up, but may scale down
      if (event) {
        expect(event.direction).not.toBe('up');
      }
    });

    it('should require sustained high CPU (>60% of readings above threshold)', () => {
      // Only 3 out of 10 readings above threshold - not sustained
      const metrics = createMetrics(
        Array.from({ length: 10 }, (_, i) => ({
          cpu: i < 3 ? 85 : 50, // 30% above threshold
        })),
      );
      const event = scaler.evaluate(1, 'my-app', 2, metrics);
      // Should not scale up since only 30% of readings are above threshold
      if (event) {
        expect(event.direction).not.toBe('up');
      }
    });

    it('should scale up with sustained high CPU (>60% of readings)', () => {
      // 8 out of 10 readings above threshold = 80% sustained
      const metrics = createMetrics(
        Array.from({ length: 10 }, (_, i) => ({
          cpu: i < 8 ? 85 : 50,
        })),
      );
      const event = scaler.evaluate(1, 'my-app', 2, metrics);
      expect(event).not.toBeNull();
      expect(event!.direction).toBe('up');
    });

    it('should include reason in scaling event', () => {
      const metrics = createMetrics({ cpu: 90 }, 10);
      const event = scaler.evaluate(1, 'my-app', 2, metrics);
      expect(event).not.toBeNull();
      expect(event!.reason).toContain('CPU');
    });
  });

  describe('scale up when high memory', () => {
    it('should scale up when memory exceeds threshold percentage', () => {
      // 16 GB total, 80% threshold = 12.8 GB
      // Set memory to 14 GB per process (87.5% of total)
      const metrics = createMetrics({ memory: 14 * 1024 * 1024 * 1024, cpu: 50 }, 10);
      const event = scaler.evaluate(1, 'my-app', 2, metrics);
      expect(event).not.toBeNull();
      expect(event!.direction).toBe('up');
      expect(event!.reason).toContain('Memory');
    });

    it('should not scale up when memory is below threshold', () => {
      // 500 MB = ~3% of 16 GB, well below 80% threshold
      const metrics = createMetrics({ memory: 500 * 1024 * 1024, cpu: 50 }, 10);
      const event = scaler.evaluate(1, 'my-app', 2, metrics);
      // Should scale down due to low CPU, not up due to memory
      if (event) {
        expect(event.direction).not.toBe('up');
      }
    });
  });

  describe('scale down when underutilized', () => {
    it('should scale down when CPU is consistently below half the threshold', () => {
      // Half of 70% = 35%. Set CPU to 10% (well below 35%)
      const metrics = createMetrics({ cpu: 10 }, 10);
      const event = scaler.evaluate(1, 'my-app', 3, metrics);
      expect(event).not.toBeNull();
      expect(event!.direction).toBe('down');
      expect(event!.fromInstances).toBe(3);
      expect(event!.toInstances).toBe(2);
    });

    it('should require sustained low CPU (>80% of readings below half threshold)', () => {
      // Only 5 out of 10 readings below half threshold
      const metrics = createMetrics(
        Array.from({ length: 10 }, (_, i) => ({
          cpu: i < 5 ? 10 : 60, // 50% below half threshold
        })),
      );
      const event = scaler.evaluate(1, 'my-app', 3, metrics);
      // Avg CPU is (5*10 + 5*60)/10 = 35, which is exactly the half-threshold
      // But sustained ratio is only 50%, less than 80% needed
      if (event) {
        expect(event.direction).not.toBe('down');
      }
    });

    it('should not scale down when already at minimum instances', () => {
      const metrics = createMetrics({ cpu: 5 }, 10);
      const event = scaler.evaluate(1, 'my-app', 1, metrics);
      // Already at min=1, should not scale down
      expect(event).toBeNull();
    });
  });

  describe('min/max instance bounds', () => {
    it('should not scale up beyond max instances', () => {
      const metrics = createMetrics({ cpu: 95 }, 10);
      const event = scaler.evaluate(1, 'my-app', 10, metrics);
      // Already at max=10, should not scale up
      expect(event).toBeNull();
    });

    it('should not scale down below min instances', () => {
      const metrics = createMetrics({ cpu: 5 }, 10);
      const event = scaler.evaluate(1, 'my-app', 1, metrics);
      expect(event).toBeNull();
    });

    it('should respect scaleUpStep and clamp to max', () => {
      const bigStepScaler = new AutoScaler({
        min: 1,
        max: 5,
        cpuThreshold: 70,
        memoryThreshold: 80,
        cooldown: 0,
        scaleUpStep: 3,
        scaleDownStep: 1,
      });
      const metrics = createMetrics({ cpu: 95 }, 10);
      const event = bigStepScaler.evaluate(1, 'my-app', 4, metrics);
      expect(event).not.toBeNull();
      expect(event!.toInstances).toBe(5); // Clamped to max
    });

    it('should respect scaleDownStep and clamp to min', () => {
      const bigStepScaler = new AutoScaler({
        min: 1,
        max: 10,
        cpuThreshold: 70,
        memoryThreshold: 80,
        cooldown: 0,
        scaleUpStep: 1,
        scaleDownStep: 5,
      });
      const metrics = createMetrics({ cpu: 5 }, 10);
      const event = bigStepScaler.evaluate(1, 'my-app', 3, metrics);
      expect(event).not.toBeNull();
      expect(event!.toInstances).toBe(1); // Clamped to min
    });
  });

  describe('cooldown periods', () => {
    it('should respect cooldown period between scaling events', () => {
      const cooldownScaler = new AutoScaler({
        min: 1,
        max: 10,
        cpuThreshold: 70,
        memoryThreshold: 80,
        cooldown: 60_000, // 60 seconds
        scaleUpStep: 1,
        scaleDownStep: 1,
      });

      const metrics = createMetrics({ cpu: 95 }, 10);

      // First scaling should succeed
      const event1 = cooldownScaler.evaluate(1, 'my-app', 2, metrics);
      expect(event1).not.toBeNull();

      // Second scaling should be blocked by cooldown
      const event2 = cooldownScaler.evaluate(1, 'my-app', 3, metrics);
      expect(event2).toBeNull();
    });

    it('should allow scaling different processes independently', () => {
      const cooldownScaler = new AutoScaler({
        min: 1,
        max: 10,
        cpuThreshold: 70,
        memoryThreshold: 80,
        cooldown: 60_000,
        scaleUpStep: 1,
        scaleDownStep: 1,
      });

      const metrics = createMetrics({ cpu: 95 }, 10);

      // Scale process 1
      const event1 = cooldownScaler.evaluate(1, 'app-1', 2, metrics);
      expect(event1).not.toBeNull();

      // Scale process 2 should still work (different process)
      const event2 = cooldownScaler.evaluate(2, 'app-2', 2, metrics);
      expect(event2).not.toBeNull();
    });

    it('should allow scaling after cooldown period expires', () => {
      const cooldownScaler = new AutoScaler({
        min: 1,
        max: 10,
        cpuThreshold: 70,
        memoryThreshold: 80,
        cooldown: 100, // Very short cooldown for testing
        scaleUpStep: 1,
        scaleDownStep: 1,
      });

      const metrics = createMetrics({ cpu: 95 }, 10);

      // First scaling
      const event1 = cooldownScaler.evaluate(1, 'my-app', 2, metrics);
      expect(event1).not.toBeNull();

      // Wait for cooldown to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const event2 = cooldownScaler.evaluate(1, 'my-app', 3, metrics);
          expect(event2).not.toBeNull();
          resolve();
        }, 150);
      });
    });
  });

  describe('empty metrics', () => {
    it('should return null for empty metrics array', () => {
      const event = scaler.evaluate(1, 'my-app', 2, []);
      expect(event).toBeNull();
    });
  });

  describe('scaling history', () => {
    it('should record scaling events in history', () => {
      const metrics = createMetrics({ cpu: 95 }, 10);
      scaler.evaluate(1, 'my-app', 2, metrics);
      const history = scaler.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].processId).toBe(1);
      expect(history[0].processName).toBe('my-app');
      expect(history[0].direction).toBe('up');
    });

    it('should accumulate multiple scaling events', () => {
      const highMetrics = createMetrics({ cpu: 95 }, 10);
      scaler.evaluate(1, 'app-1', 2, highMetrics);
      scaler.evaluate(2, 'app-2', 3, highMetrics);
      const history = scaler.getHistory();
      expect(history).toHaveLength(2);
    });

    it('should return a copy of the history array', () => {
      const metrics = createMetrics({ cpu: 95 }, 10);
      scaler.evaluate(1, 'my-app', 2, metrics);
      const history1 = scaler.getHistory();
      const history2 = scaler.getHistory();
      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });
  });

  describe('getConfig', () => {
    it('should return the current configuration', () => {
      const config = scaler.getConfig();
      expect(config.min).toBe(1);
      expect(config.max).toBe(10);
      expect(config.cpuThreshold).toBe(70);
      expect(config.memoryThreshold).toBe(80);
      expect(config.scaleUpStep).toBe(1);
      expect(config.scaleDownStep).toBe(1);
    });

    it('should return a copy of the config', () => {
      const config1 = scaler.getConfig();
      const config2 = scaler.getConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('default configuration', () => {
    it('should use defaults when no config provided', () => {
      const defaultScaler = new AutoScaler();
      const config = defaultScaler.getConfig();
      expect(config.min).toBe(1);
      expect(config.max).toBe(10);
      expect(config.cpuThreshold).toBe(70);
      expect(config.memoryThreshold).toBe(80);
      expect(config.cooldown).toBe(60_000);
      expect(config.scaleUpStep).toBe(1);
      expect(config.scaleDownStep).toBe(1);
    });
  });

  describe('getPredictiveScaler', () => {
    it('should return a PredictiveScaler instance', () => {
      const predictive = scaler.getPredictiveScaler();
      expect(predictive).toBeDefined();
      expect(typeof predictive.predict).toBe('function');
      expect(typeof predictive.isTrained).toBe('function');
    });
  });
});
