import { describe, it, expect, beforeEach } from 'vitest';
import { RootCauseAnalyzer } from '../analysis/RootCauseAnalyzer.js';
import type { ProcessMetrics, ProcessEvent } from '@novapm/shared';

function createMetrics(overrides: Partial<ProcessMetrics>, count: number): ProcessMetrics[] {
  return Array.from({ length: count }, (_, i) => ({
    processId: 1,
    cpu: 30,
    memory: 200 * 1024 * 1024,
    heapUsed: 100 * 1024 * 1024,
    heapTotal: 200 * 1024 * 1024,
    eventLoopLatency: 5,
    activeHandles: 10,
    activeRequests: 2,
    uptime: 3600,
    timestamp: new Date(Date.now() - (count - i) * 60_000),
    ...overrides,
  }));
}

function createEvent(overrides: Partial<ProcessEvent>): ProcessEvent {
  return {
    type: 'crash',
    processId: 1,
    processName: 'my-app',
    timestamp: new Date(),
    data: {},
    ...overrides,
  };
}

describe('RootCauseAnalyzer', () => {
  let analyzer: RootCauseAnalyzer;

  beforeEach(() => {
    analyzer = new RootCauseAnalyzer();
  });

  describe('log pattern analysis', () => {
    it('should detect OOM crash from logs', () => {
      const logs = [
        'FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory',
      ];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const oomInsight = result.insights.find((i) => i.type === 'oom');
      expect(oomInsight).toBeDefined();
      expect(oomInsight!.severity).toBe('critical');
    });

    it('should detect unhandled promise rejection', () => {
      const logs = ['UnhandledPromiseRejection: Error: connection timeout'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const insight = result.insights.find((i) => i.type === 'unhandled-rejection');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('high');
    });

    it('should detect uncaught exception', () => {
      const logs = ['TypeError: Cannot read property "x" of undefined'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const insight = result.insights.find((i) => i.type === 'uncaught-exception');
      expect(insight).toBeDefined();
    });

    it('should detect EADDRINUSE error', () => {
      const logs = ['Error: listen EADDRINUSE: address already in use :::3000'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const insight = result.insights.find((i) => i.type === 'port-in-use');
      expect(insight).toBeDefined();
    });

    it('should detect ECONNREFUSED error', () => {
      const logs = ['Error: connect ECONNREFUSED 127.0.0.1:5432'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const insight = result.insights.find((i) => i.type === 'connection-refused');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('medium');
    });

    it('should detect missing module', () => {
      const logs = ['Error: Cannot find module "some-package"'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const insight = result.insights.find((i) => i.type === 'missing-module');
      expect(insight).toBeDefined();
    });

    it('should detect MODULE_NOT_FOUND error', () => {
      const logs = ['Error [MODULE_NOT_FOUND]: Cannot find package "@scope/pkg"'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const insight = result.insights.find((i) => i.type === 'missing-module');
      expect(insight).toBeDefined();
    });

    it('should detect ENOSPC error', () => {
      const logs = ['Error: ENOSPC: no space left on device, write'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const insight = result.insights.find((i) => i.type === 'disk-full');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('critical');
    });

    it('should detect EMFILE (too many open files)', () => {
      const logs = ['Error: EMFILE: too many open files'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const insight = result.insights.find((i) => i.type === 'file-descriptor-exhaustion');
      expect(insight).toBeDefined();
    });

    it('should detect SIGKILL', () => {
      const logs = ['Process killed by SIGKILL signal'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const insight = result.insights.find((i) => i.type === 'killed');
      expect(insight).toBeDefined();
    });

    it('should deduplicate multiple log lines matching the same pattern', () => {
      const logs = [
        'FATAL ERROR: heap limit Allocation failed',
        'FATAL ERROR: another heap allocation error',
      ];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const oomInsights = result.insights.filter((i) => i.type === 'oom');
      // Should only match once per type due to deduplication
      expect(oomInsights).toHaveLength(1);
    });

    it('should detect multiple different patterns', () => {
      const logs = [
        'FATAL ERROR: heap limit Allocation failed',
        'Error: connect ECONNREFUSED 127.0.0.1:5432',
      ];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      expect(result.insights.length).toBeGreaterThanOrEqual(2);
      expect(result.insights.some((i) => i.type === 'oom')).toBe(true);
      expect(result.insights.some((i) => i.type === 'connection-refused')).toBe(true);
    });

    it('should return no insights for clean logs', () => {
      const logs = ['Server started on port 3000', 'Request handled successfully'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      const logInsights = result.insights.filter((i) =>
        [
          'oom',
          'unhandled-rejection',
          'uncaught-exception',
          'port-in-use',
          'connection-refused',
          'missing-module',
          'disk-full',
          'file-descriptor-exhaustion',
          'killed',
        ].includes(i.type),
      );
      expect(logInsights).toHaveLength(0);
    });

    it('should handle empty logs', () => {
      const result = analyzer.analyzeProcessCrash(1, [], [], []);
      expect(result.summary).toContain('no clear root cause');
    });
  });

  describe('metrics-based analysis', () => {
    it('should detect memory spike before crash', () => {
      // Average memory is ~200MB, last metric spikes to 600MB (> 2x average and > 256MB)
      const metrics = createMetrics({ memory: 200 * 1024 * 1024 }, 9);
      metrics.push({
        ...metrics[0],
        memory: 600 * 1024 * 1024,
        timestamp: new Date(),
      });
      const result = analyzer.analyzeProcessCrash(1, [], metrics, []);
      const insight = result.insights.find((i) => i.type === 'memory-spike-before-crash');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('high');
    });

    it('should not flag memory when last reading is within normal range', () => {
      const metrics = createMetrics({ memory: 200 * 1024 * 1024 }, 10);
      const result = analyzer.analyzeProcessCrash(1, [], metrics, []);
      const insight = result.insights.find((i) => i.type === 'memory-spike-before-crash');
      expect(insight).toBeUndefined();
    });

    it('should detect high CPU before crash', () => {
      const metrics = createMetrics({ cpu: 30 }, 9);
      metrics.push({
        ...metrics[0],
        cpu: 98,
        timestamp: new Date(),
      });
      const result = analyzer.analyzeProcessCrash(1, [], metrics, []);
      const insight = result.insights.find((i) => i.type === 'high-cpu-before-crash');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('high');
    });

    it('should detect event loop blocked before crash', () => {
      const metrics = createMetrics({ eventLoopLatency: 10 }, 9);
      metrics.push({
        ...metrics[0],
        eventLoopLatency: 600,
        timestamp: new Date(),
      });
      const result = analyzer.analyzeProcessCrash(1, [], metrics, []);
      const insight = result.insights.find((i) => i.type === 'event-loop-blocked');
      expect(insight).toBeDefined();
    });

    it('should detect heap exhaustion before crash', () => {
      const metrics = createMetrics(
        {
          heapUsed: 100 * 1024 * 1024,
          heapTotal: 200 * 1024 * 1024,
        },
        9,
      );
      metrics.push({
        ...metrics[0],
        heapUsed: 195 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        timestamp: new Date(),
      });
      const result = analyzer.analyzeProcessCrash(1, [], metrics, []);
      const insight = result.insights.find((i) => i.type === 'heap-exhaustion');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('critical');
    });

    it('should return no metrics insights with fewer than 2 data points', () => {
      const metrics = createMetrics({ cpu: 99, memory: 1024 * 1024 * 1024 }, 1);
      const result = analyzer.analyzeProcessCrash(1, [], metrics, []);
      const metricsInsights = result.insights.filter((i) =>
        [
          'memory-spike-before-crash',
          'high-cpu-before-crash',
          'event-loop-blocked',
          'heap-exhaustion',
        ].includes(i.type),
      );
      expect(metricsInsights).toHaveLength(0);
    });
  });

  describe('event correlation', () => {
    it('should detect correlated crashes across processes', () => {
      const crashTime = new Date();
      const events: ProcessEvent[] = [
        createEvent({
          type: 'crash',
          processId: 1,
          processName: 'my-app',
          timestamp: crashTime,
        }),
        createEvent({
          type: 'crash',
          processId: 2,
          processName: 'worker',
          timestamp: new Date(crashTime.getTime() + 30_000), // 30s later
        }),
      ];
      const result = analyzer.analyzeProcessCrash(1, [], [], events);
      const insight = result.insights.find((i) => i.type === 'correlated-crashes');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('critical');
      expect(insight!.description).toContain('worker');
    });

    it('should not flag correlated crashes outside 1-minute window', () => {
      const crashTime = new Date();
      const events: ProcessEvent[] = [
        createEvent({
          type: 'crash',
          processId: 1,
          processName: 'my-app',
          timestamp: crashTime,
        }),
        createEvent({
          type: 'crash',
          processId: 2,
          processName: 'worker',
          timestamp: new Date(crashTime.getTime() + 120_000), // 2 minutes later
        }),
      ];
      const result = analyzer.analyzeProcessCrash(1, [], [], events);
      const insight = result.insights.find((i) => i.type === 'correlated-crashes');
      expect(insight).toBeUndefined();
    });

    it('should detect restart loop', () => {
      const now = new Date();
      const events: ProcessEvent[] = [createEvent({ type: 'crash', processId: 1, timestamp: now })];
      // Add 6 restarts within 10 minutes
      for (let i = 0; i < 6; i++) {
        events.push(
          createEvent({
            type: 'restart',
            processId: 1,
            timestamp: new Date(now.getTime() - i * 60_000),
          }),
        );
      }
      const result = analyzer.analyzeProcessCrash(1, [], [], events);
      const insight = result.insights.find((i) => i.type === 'restart-loop');
      expect(insight).toBeDefined();
      expect(insight!.severity).toBe('critical');
    });

    it('should not flag restart loop with 5 or fewer restarts', () => {
      const now = new Date();
      const events: ProcessEvent[] = [createEvent({ type: 'crash', processId: 1, timestamp: now })];
      for (let i = 0; i < 5; i++) {
        events.push(
          createEvent({
            type: 'restart',
            processId: 1,
            timestamp: new Date(now.getTime() - i * 60_000),
          }),
        );
      }
      const result = analyzer.analyzeProcessCrash(1, [], [], events);
      const insight = result.insights.find((i) => i.type === 'restart-loop');
      expect(insight).toBeUndefined();
    });

    it('should return no event insights when no crash/error events exist', () => {
      const events: ProcessEvent[] = [
        createEvent({ type: 'start', processId: 1 }),
        createEvent({ type: 'online', processId: 1 }),
      ];
      const result = analyzer.analyzeProcessCrash(1, [], [], events);
      const correlationInsights = result.insights.filter((i) =>
        ['correlated-crashes', 'restart-loop'].includes(i.type),
      );
      expect(correlationInsights).toHaveLength(0);
    });
  });

  describe('summary generation', () => {
    it('should mention critical issues in summary', () => {
      const logs = ['FATAL ERROR: heap limit Allocation failed'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      expect(result.summary).toContain('Critical issues');
    });

    it('should mention high-severity issues in summary', () => {
      const logs = ['TypeError: Cannot read property "x" of undefined'];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      expect(result.summary).toContain('High-severity issues');
    });

    it('should indicate no clear root cause when no insights found', () => {
      const result = analyzer.analyzeProcessCrash(1, [], [], []);
      expect(result.summary).toContain('no clear root cause');
    });

    it('should mention crash count when multiple crashes occurred', () => {
      const now = new Date();
      const events: ProcessEvent[] = [
        createEvent({ type: 'crash', processId: 1, timestamp: now }),
        createEvent({
          type: 'crash',
          processId: 1,
          timestamp: new Date(now.getTime() - 60_000),
        }),
        createEvent({
          type: 'error',
          processId: 2,
          processName: 'worker',
          timestamp: new Date(now.getTime() - 30_000),
        }),
      ];
      const result = analyzer.analyzeProcessCrash(1, [], [], events);
      expect(result.summary).toContain('crashed 2 times');
    });
  });

  describe('recommendations', () => {
    it('should collect unique recommendations from all insights', () => {
      const logs = [
        'FATAL ERROR: heap limit Allocation failed',
        'Error: connect ECONNREFUSED 127.0.0.1:5432',
      ];
      const result = analyzer.analyzeProcessCrash(1, logs, [], []);
      expect(result.recommendations.length).toBeGreaterThanOrEqual(2);
      // All recommendations should be unique
      const uniqueRecs = new Set(result.recommendations);
      expect(uniqueRecs.size).toBe(result.recommendations.length);
    });

    it('should return empty recommendations when no insights', () => {
      const result = analyzer.analyzeProcessCrash(1, [], [], []);
      expect(result.recommendations).toHaveLength(0);
    });
  });

  describe('result structure', () => {
    it('should return a valid AnalysisResult', () => {
      const result = analyzer.analyzeProcessCrash(1, [], [], []);
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('insights');
      expect(result).toHaveProperty('recommendations');
      expect(result).toHaveProperty('anomalies');
      expect(typeof result.summary).toBe('string');
      expect(Array.isArray(result.insights)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(Array.isArray(result.anomalies)).toBe(true);
      expect(result.anomalies).toHaveLength(0);
    });
  });
});
