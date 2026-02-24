import { describe, it, expect, beforeEach } from 'vitest';
import { PerformanceAdvisor } from '../analysis/PerformanceAdvisor.js';
import type { ProcessMetrics } from '@novapm/shared';

function createMetrics(overrides: Partial<ProcessMetrics>, count: number): ProcessMetrics[] {
  return Array.from({ length: count }, (_, i) => ({
    processId: 1,
    cpu: 30,
    memory: 100 * 1024 * 1024, // 100 MB
    heapUsed: 50 * 1024 * 1024,
    heapTotal: 200 * 1024 * 1024,
    eventLoopLatency: 5,
    activeHandles: 10,
    activeRequests: 2,
    uptime: 3600,
    timestamp: new Date(Date.now() - (count - i) * 60_000),
    ...overrides,
  }));
}

function createMetricsArray(overridesArr: Partial<ProcessMetrics>[]): ProcessMetrics[] {
  return overridesArr.map((overrides, i) => ({
    processId: 1,
    cpu: 30,
    memory: 100 * 1024 * 1024,
    heapUsed: 50 * 1024 * 1024,
    heapTotal: 200 * 1024 * 1024,
    eventLoopLatency: 5,
    activeHandles: 10,
    activeRequests: 2,
    uptime: 3600,
    timestamp: new Date(Date.now() - (overridesArr.length - i) * 60_000),
    ...overrides,
  }));
}

describe('PerformanceAdvisor', () => {
  let advisor: PerformanceAdvisor;

  beforeEach(() => {
    advisor = new PerformanceAdvisor();
  });

  describe('minimal data', () => {
    it('should return no insights with fewer than 3 data points', () => {
      const metrics = createMetrics({}, 2);
      const insights = advisor.analyzeProcess(1, metrics);
      expect(insights).toHaveLength(0);
    });

    it('should return no insights for empty metrics', () => {
      const insights = advisor.analyzeProcess(1, []);
      expect(insights).toHaveLength(0);
    });
  });

  describe('high memory usage', () => {
    it('should flag high memory usage above 512MB', () => {
      const metrics = createMetrics({ memory: 600 * 1024 * 1024 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const highMemoryInsight = insights.find((i) => i.type === 'high-memory');
      expect(highMemoryInsight).toBeDefined();
      expect(highMemoryInsight!.severity).toBe('medium');
    });

    it('should flag critical high memory above 1024MB', () => {
      const metrics = createMetrics({ memory: 1500 * 1024 * 1024 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const highMemoryInsight = insights.find((i) => i.type === 'high-memory');
      expect(highMemoryInsight).toBeDefined();
      expect(highMemoryInsight!.severity).toBe('high');
    });

    it('should not flag memory below 512MB', () => {
      const metrics = createMetrics({ memory: 200 * 1024 * 1024 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const highMemoryInsight = insights.find((i) => i.type === 'high-memory');
      expect(highMemoryInsight).toBeUndefined();
    });
  });

  describe('memory growth detection', () => {
    it('should detect memory growth when second half is 30% higher', () => {
      // 10 metrics: first 5 at 100MB, second 5 at 150MB (50% increase)
      const overrides = Array.from({ length: 10 }, (_, i) => ({
        memory: i < 5 ? 100 * 1024 * 1024 : 150 * 1024 * 1024,
      }));
      const metrics = createMetricsArray(overrides);
      const insights = advisor.analyzeProcess(1, metrics);
      const growthInsight = insights.find((i) => i.type === 'memory-growth');
      expect(growthInsight).toBeDefined();
      expect(growthInsight!.severity).toBe('medium');
    });

    it('should not flag when memory growth is less than 30%', () => {
      const overrides = Array.from({ length: 10 }, (_, i) => ({
        memory: i < 5 ? 100 * 1024 * 1024 : 110 * 1024 * 1024,
      }));
      const metrics = createMetricsArray(overrides);
      const insights = advisor.analyzeProcess(1, metrics);
      const growthInsight = insights.find((i) => i.type === 'memory-growth');
      expect(growthInsight).toBeUndefined();
    });

    it('should require at least 10 data points for memory growth check', () => {
      const overrides = Array.from({ length: 8 }, (_, i) => ({
        memory: i < 4 ? 100 * 1024 * 1024 : 200 * 1024 * 1024,
      }));
      const metrics = createMetricsArray(overrides);
      const insights = advisor.analyzeProcess(1, metrics);
      const growthInsight = insights.find((i) => i.type === 'memory-growth');
      expect(growthInsight).toBeUndefined();
    });
  });

  describe('bursty CPU usage', () => {
    it('should flag bursty CPU when stddev > 30 and avg > 20', () => {
      // Mix of low and high CPU to create high variance
      const overrides = Array.from({ length: 20 }, (_, i) => ({
        cpu: i % 2 === 0 ? 10 : 80,
      }));
      const metrics = createMetricsArray(overrides);
      const insights = advisor.analyzeProcess(1, metrics);
      const burstyInsight = insights.find((i) => i.type === 'bursty-cpu');
      expect(burstyInsight).toBeDefined();
      expect(burstyInsight!.severity).toBe('low');
    });

    it('should not flag bursty CPU when avg is below 20', () => {
      const overrides = Array.from({ length: 20 }, (_, i) => ({
        cpu: i % 2 === 0 ? 0 : 10,
      }));
      const metrics = createMetricsArray(overrides);
      const insights = advisor.analyzeProcess(1, metrics);
      const burstyInsight = insights.find((i) => i.type === 'bursty-cpu');
      expect(burstyInsight).toBeUndefined();
    });
  });

  describe('sustained high CPU', () => {
    it('should flag sustained high CPU above 80%', () => {
      const metrics = createMetrics({ cpu: 90 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const highCpuInsight = insights.find((i) => i.type === 'sustained-high-cpu');
      expect(highCpuInsight).toBeDefined();
      expect(highCpuInsight!.severity).toBe('high');
    });

    it('should not flag CPU below 80%', () => {
      const metrics = createMetrics({ cpu: 60 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const highCpuInsight = insights.find((i) => i.type === 'sustained-high-cpu');
      expect(highCpuInsight).toBeUndefined();
    });
  });

  describe('instance scaling recommendations', () => {
    it('should recommend scaling up when average CPU > 70%', () => {
      const metrics = createMetrics({ cpu: 85 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const scaleUpInsight = insights.find((i) => i.type === 'scale-up-recommendation');
      expect(scaleUpInsight).toBeDefined();
      expect(scaleUpInsight!.recommendation).toContain('instances');
    });

    it('should recommend scaling down when average CPU < 5% with enough data', () => {
      const metrics = createMetrics({ cpu: 2 }, 15);
      const insights = advisor.analyzeProcess(1, metrics);
      const scaleDownInsight = insights.find((i) => i.type === 'scale-down-recommendation');
      expect(scaleDownInsight).toBeDefined();
      expect(scaleDownInsight!.severity).toBe('low');
    });

    it('should not recommend scaling down without enough data points', () => {
      const metrics = createMetrics({ cpu: 2 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const scaleDownInsight = insights.find((i) => i.type === 'scale-down-recommendation');
      expect(scaleDownInsight).toBeUndefined();
    });
  });

  describe('memory limit recommendations', () => {
    it('should suggest memory limit when peak memory > 200MB', () => {
      const metrics = createMetrics({ memory: 300 * 1024 * 1024 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const limitInsight = insights.find((i) => i.type === 'memory-limit-recommendation');
      expect(limitInsight).toBeDefined();
      expect(limitInsight!.recommendation).toContain('max_memory_restart');
    });

    it('should not suggest memory limit when peak is below 200MB', () => {
      const metrics = createMetrics({ memory: 100 * 1024 * 1024 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const limitInsight = insights.find((i) => i.type === 'memory-limit-recommendation');
      expect(limitInsight).toBeUndefined();
    });
  });

  describe('idle process detection', () => {
    it('should detect idle process with CPU < 1% and memory < 50MB', () => {
      const metrics = createMetrics({ cpu: 0.1, memory: 20 * 1024 * 1024 }, 15);
      const insights = advisor.analyzeProcess(1, metrics);
      const idleInsight = insights.find((i) => i.type === 'idle-process');
      expect(idleInsight).toBeDefined();
      expect(idleInsight!.severity).toBe('low');
    });

    it('should not flag process with CPU > 1%', () => {
      const metrics = createMetrics({ cpu: 5, memory: 20 * 1024 * 1024 }, 15);
      const insights = advisor.analyzeProcess(1, metrics);
      const idleInsight = insights.find((i) => i.type === 'idle-process');
      expect(idleInsight).toBeUndefined();
    });

    it('should not flag idle detection with < 10 data points', () => {
      const metrics = createMetrics({ cpu: 0.1, memory: 20 * 1024 * 1024 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const idleInsight = insights.find((i) => i.type === 'idle-process');
      expect(idleInsight).toBeUndefined();
    });
  });

  describe('event loop health', () => {
    it('should flag slow event loop when avg latency > 50ms', () => {
      const metrics = createMetrics({ eventLoopLatency: 80 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const eventLoopInsight = insights.find((i) => i.type === 'event-loop-slow');
      expect(eventLoopInsight).toBeDefined();
      expect(eventLoopInsight!.severity).toBe('medium');
    });

    it('should flag high severity when avg latency > 100ms', () => {
      const metrics = createMetrics({ eventLoopLatency: 150 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const eventLoopInsight = insights.find((i) => i.type === 'event-loop-slow');
      expect(eventLoopInsight).toBeDefined();
      expect(eventLoopInsight!.severity).toBe('high');
    });

    it('should not flag healthy event loop under 50ms', () => {
      const metrics = createMetrics({ eventLoopLatency: 5 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const eventLoopInsight = insights.find((i) => i.type === 'event-loop-slow');
      expect(eventLoopInsight).toBeUndefined();
    });
  });

  describe('heap fragmentation', () => {
    it('should flag low heap utilization when ratio < 0.3', () => {
      const metrics = createMetrics(
        {
          heapUsed: 20 * 1024 * 1024,
          heapTotal: 200 * 1024 * 1024, // 10% utilization
        },
        5,
      );
      const insights = advisor.analyzeProcess(1, metrics);
      const heapInsight = insights.find((i) => i.type === 'heap-fragmentation');
      expect(heapInsight).toBeDefined();
      expect(heapInsight!.severity).toBe('low');
    });

    it('should flag high heap pressure when ratio > 0.9', () => {
      const metrics = createMetrics(
        {
          heapUsed: 190 * 1024 * 1024,
          heapTotal: 200 * 1024 * 1024, // 95% utilization
        },
        5,
      );
      const insights = advisor.analyzeProcess(1, metrics);
      const heapInsight = insights.find((i) => i.type === 'heap-pressure');
      expect(heapInsight).toBeDefined();
      expect(heapInsight!.severity).toBe('high');
    });

    it('should not flag heap when utilization is between 0.3 and 0.9', () => {
      const metrics = createMetrics(
        {
          heapUsed: 100 * 1024 * 1024,
          heapTotal: 200 * 1024 * 1024, // 50% utilization
        },
        5,
      );
      const insights = advisor.analyzeProcess(1, metrics);
      const fragInsight = insights.find((i) => i.type === 'heap-fragmentation');
      const pressureInsight = insights.find((i) => i.type === 'heap-pressure');
      expect(fragInsight).toBeUndefined();
      expect(pressureInsight).toBeUndefined();
    });

    it('should skip heap check when heapTotal is 0', () => {
      const metrics = createMetrics({ heapUsed: 0, heapTotal: 0 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);
      const heapInsights = insights.filter(
        (i) => i.type === 'heap-fragmentation' || i.type === 'heap-pressure',
      );
      expect(heapInsights).toHaveLength(0);
    });
  });

  describe('insight structure', () => {
    it('should produce properly structured insights', () => {
      const metrics = createMetrics({ cpu: 90 }, 5);
      const insights = advisor.analyzeProcess(1, metrics);

      for (const insight of insights) {
        expect(insight.id).toBeDefined();
        expect(typeof insight.id).toBe('string');
        expect(insight.type).toBeDefined();
        expect(insight.title).toBeDefined();
        expect(insight.description).toBeDefined();
        expect(['low', 'medium', 'high', 'critical']).toContain(insight.severity);
        expect(insight.processId).toBe(1);
        expect(insight.recommendation).toBeDefined();
        expect(insight.timestamp).toBeInstanceOf(Date);
        expect(insight.acknowledged).toBe(false);
      }
    });
  });
});
