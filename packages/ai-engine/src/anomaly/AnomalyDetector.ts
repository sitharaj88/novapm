import type { ProcessMetrics, ProcessEvent } from '@novapm/shared';
import type { AnomalyEvent, AnomalyType, AnomalySeverity } from '../types.js';
import { ZScoreDetector } from './ZScoreDetector.js';
import { IQRDetector } from './IQRDetector.js';
import { MovingAverageDetector } from './MovingAverageDetector.js';
import { RateOfChangeDetector } from './RateOfChangeDetector.js';
import { PatternDetector } from './PatternDetector.js';

let nextId = 1;

function generateId(): string {
  return `anomaly-${Date.now()}-${nextId++}`;
}

/**
 * Main anomaly detection coordinator. Runs all detection methods against
 * process metrics and events, deduplicates alerts, and maintains history.
 */
export class AnomalyDetector {
  private readonly zScoreDetector: ZScoreDetector;
  private readonly iqrDetector: IQRDetector;
  private readonly movingAverageDetector: MovingAverageDetector;
  private readonly rateOfChangeDetector: RateOfChangeDetector;
  private readonly patternDetector: PatternDetector;

  /** History of anomalies keyed by deduplication key */
  private readonly anomalyHistory: Map<string, AnomalyEvent> = new Map();

  /** Deduplication window in milliseconds (5 minutes) */
  private readonly deduplicationWindowMs = 5 * 60 * 1000;

  constructor() {
    this.zScoreDetector = new ZScoreDetector();
    this.iqrDetector = new IQRDetector();
    this.movingAverageDetector = new MovingAverageDetector();
    this.rateOfChangeDetector = new RateOfChangeDetector();
    this.patternDetector = new PatternDetector();
  }

  /**
   * Analyze a single process's metrics and events for anomalies.
   */
  analyze(
    processId: number,
    processName: string,
    metrics: ProcessMetrics[],
    events: ProcessEvent[],
  ): AnomalyEvent[] {
    const anomalies: AnomalyEvent[] = [];

    if (metrics.length === 0) {
      return anomalies;
    }

    // Extract time-series arrays from metrics
    const cpuValues = metrics.map((m) => m.cpu);
    const memoryValues = metrics.map((m) => m.memory);
    const latencyValues = metrics.map((m) => m.eventLoopLatency);

    // --- CPU spike detection ---
    const cpuZScoreResults = this.zScoreDetector.detect(cpuValues, 2.5);
    for (const result of cpuZScoreResults) {
      const anomaly = this.createAnomaly({
        type: 'cpu-spike',
        severity: result.zScore > 4 ? 'critical' : result.zScore > 3 ? 'high' : 'medium',
        processId,
        processName,
        metric: 'cpu',
        description: `CPU usage spiked to ${result.value.toFixed(1)}% (z-score: ${result.zScore.toFixed(2)})`,
        value: result.value,
        threshold: 80,
        recommendation:
          'Investigate CPU-intensive operations. Consider profiling the process or scaling horizontally.',
      });
      if (anomaly) anomalies.push(anomaly);
    }

    // --- CPU threshold detection ---
    const avgCpu = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
    if (avgCpu > 90) {
      const anomaly = this.createAnomaly({
        type: 'cpu-threshold',
        severity: 'high',
        processId,
        processName,
        metric: 'cpu',
        description: `Average CPU usage is ${avgCpu.toFixed(1)}%, exceeding the 90% threshold`,
        value: avgCpu,
        threshold: 90,
        recommendation:
          'The process is consistently using high CPU. Scale up instances or optimize hot code paths.',
      });
      if (anomaly) anomalies.push(anomaly);
    }

    // --- Memory threshold detection ---
    const avgMemory = memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length;
    const memoryMB = avgMemory / (1024 * 1024);
    if (memoryMB > 512) {
      const anomaly = this.createAnomaly({
        type: 'memory-threshold',
        severity: memoryMB > 1024 ? 'critical' : 'high',
        processId,
        processName,
        metric: 'memory',
        description: `Average memory usage is ${memoryMB.toFixed(0)} MB, exceeding safe threshold`,
        value: avgMemory,
        threshold: 512 * 1024 * 1024,
        recommendation:
          'Review memory usage patterns. Consider setting max_memory_restart or investigating memory allocations.',
      });
      if (anomaly) anomalies.push(anomaly);
    }

    // --- Memory leak detection ---
    const memoryTimeSeries = metrics.map((m) => ({
      memory: m.memory,
      timestamp: m.timestamp.getTime(),
    }));
    if (this.patternDetector.detectMemoryLeak(memoryTimeSeries)) {
      const latestMemory = memoryValues[memoryValues.length - 1];
      const anomaly = this.createAnomaly({
        type: 'memory-leak',
        severity: 'critical',
        processId,
        processName,
        metric: 'memory',
        description: `Potential memory leak detected. Memory usage is consistently increasing over time.`,
        value: latestMemory,
        threshold: memoryValues[0],
        recommendation:
          'Investigate memory leaks using heap snapshots. Check for growing arrays, event listener leaks, or closure-retained references.',
      });
      if (anomaly) anomalies.push(anomaly);
    }

    // --- Memory rate of change detection ---
    const memoryRocResults = this.rateOfChangeDetector.detect(memoryValues);
    for (const result of memoryRocResults) {
      if (result.rate > 0) {
        const anomaly = this.createAnomaly({
          type: 'memory-leak',
          severity: 'medium',
          processId,
          processName,
          metric: 'memory',
          description: `Rapid memory increase detected at index ${result.index}: rate of ${(result.rate / (1024 * 1024)).toFixed(1)} MB/interval`,
          value: result.value,
          threshold: 0,
          recommendation:
            'Monitor memory usage closely. A sudden increase may indicate a memory leak or large allocation.',
        });
        if (anomaly) anomalies.push(anomaly);
      }
    }

    // --- Latency anomaly detection via IQR ---
    const latencyIQRResults = this.iqrDetector.detect(latencyValues);
    const latencyOutliers = latencyIQRResults.filter((r) => r.isOutlier && r.value > 100);
    for (const outlier of latencyOutliers) {
      const anomaly = this.createAnomaly({
        type: 'latency',
        severity: outlier.value > 500 ? 'high' : 'medium',
        processId,
        processName,
        metric: 'eventLoopLatency',
        description: `Event loop latency spike of ${outlier.value.toFixed(1)}ms detected`,
        value: outlier.value,
        threshold: 100,
        recommendation:
          'High event loop latency indicates blocking operations. Review synchronous code, heavy computations, or large JSON parsing.',
      });
      if (anomaly) anomalies.push(anomaly);
    }

    // --- Latency anomaly detection via Moving Average ---
    const latencyMAResults = this.movingAverageDetector.detect(latencyValues);
    for (const result of latencyMAResults) {
      if (result.value > 50) {
        const anomaly = this.createAnomaly({
          type: 'latency',
          severity: result.value > 200 ? 'high' : 'medium',
          processId,
          processName,
          metric: 'eventLoopLatency',
          description: `Event loop latency of ${result.value.toFixed(1)}ms deviates significantly from EMA (${result.ema.toFixed(1)}ms)`,
          value: result.value,
          threshold: result.ema,
          recommendation: 'Check for blocking operations or unexpected workload increases.',
        });
        if (anomaly) anomalies.push(anomaly);
      }
    }

    // --- Restart loop detection ---
    const eventTimeSeries = events.map((e) => ({
      type: e.type,
      timestamp: e.timestamp.getTime(),
    }));
    if (this.patternDetector.detectRestartLoop(eventTimeSeries)) {
      const anomaly = this.createAnomaly({
        type: 'restart-loop',
        severity: 'critical',
        processId,
        processName,
        metric: 'restarts',
        description: `Process is in a restart loop (more than 5 restarts in the last 10 minutes)`,
        value: events.filter((e) => e.type === 'restart').length,
        threshold: 5,
        recommendation:
          'The process is crash-looping. Check logs for the root cause. Consider disabling autorestart temporarily to investigate.',
      });
      if (anomaly) anomalies.push(anomaly);
    }

    return anomalies;
  }

  /**
   * Detect anomalies across all processes.
   */
  detectAll(
    metricsMap: Map<number, { name: string; metrics: ProcessMetrics[]; events: ProcessEvent[] }>,
  ): AnomalyEvent[] {
    const allAnomalies: AnomalyEvent[] = [];

    for (const [processId, data] of metricsMap) {
      const anomalies = this.analyze(processId, data.name, data.metrics, data.events);
      allAnomalies.push(...anomalies);
    }

    return allAnomalies;
  }

  /**
   * Get all anomalies in history.
   */
  getHistory(): AnomalyEvent[] {
    return Array.from(this.anomalyHistory.values());
  }

  /**
   * Resolve an anomaly by ID.
   */
  resolve(anomalyId: string): boolean {
    const anomaly = this.anomalyHistory.get(anomalyId);
    if (anomaly) {
      anomaly.resolved = true;
      return true;
    }
    return false;
  }

  /**
   * Clear resolved anomalies from history.
   */
  clearResolved(): void {
    for (const [key, anomaly] of this.anomalyHistory) {
      if (anomaly.resolved) {
        this.anomalyHistory.delete(key);
      }
    }
  }

  /**
   * Create an anomaly event with deduplication.
   * Returns null if a similar anomaly was already raised within the deduplication window.
   */
  private createAnomaly(params: {
    type: AnomalyType;
    severity: AnomalySeverity;
    processId: number;
    processName: string;
    metric: string;
    description: string;
    value: number;
    threshold: number;
    recommendation: string;
  }): AnomalyEvent | null {
    const deduplicationKey = `${params.processId}-${params.type}-${params.metric}`;
    const existing = this.anomalyHistory.get(deduplicationKey);

    if (existing && !existing.resolved) {
      const timeSinceLastAlert = Date.now() - existing.timestamp.getTime();
      if (timeSinceLastAlert < this.deduplicationWindowMs) {
        return null;
      }
    }

    const anomaly: AnomalyEvent = {
      id: generateId(),
      type: params.type,
      severity: params.severity,
      processId: params.processId,
      processName: params.processName,
      metric: params.metric,
      description: params.description,
      value: params.value,
      threshold: params.threshold,
      recommendation: params.recommendation,
      timestamp: new Date(),
      resolved: false,
    };

    this.anomalyHistory.set(deduplicationKey, anomaly);
    return anomaly;
  }
}
