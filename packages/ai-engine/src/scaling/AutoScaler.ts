import { totalmem } from 'node:os';
import { mean } from 'simple-statistics';
import type { ProcessMetrics } from '@novapm/shared';
import type { ScalingEvent, AutoScalerConfig } from '../types.js';
import { PredictiveScaler } from './PredictiveScaler.js';

const DEFAULT_CONFIG: AutoScalerConfig = {
  min: 1,
  max: 10,
  cpuThreshold: 70,
  memoryThreshold: 80,
  cooldown: 60_000, // 60 seconds
  scaleUpStep: 1,
  scaleDownStep: 1,
};

/**
 * AutoScaler evaluates process metrics and determines whether to
 * scale instances up or down based on CPU/memory thresholds and
 * predictive analysis.
 */
export class AutoScaler {
  private readonly config: AutoScalerConfig;
  private readonly predictiveScaler: PredictiveScaler;
  private readonly scalingHistory: ScalingEvent[] = [];
  private lastScaleTimestamp: Map<number, number> = new Map();

  constructor(config?: Partial<AutoScalerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.predictiveScaler = new PredictiveScaler();
  }

  /**
   * Evaluate whether a process needs scaling.
   * Returns a ScalingEvent if scaling should occur, or null otherwise.
   */
  evaluate(
    processId: number,
    processName: string,
    currentInstances: number,
    metrics: ProcessMetrics[],
  ): ScalingEvent | null {
    if (metrics.length === 0) {
      return null;
    }

    // Enforce cooldown
    if (this.isInCooldown(processId)) {
      return null;
    }

    // Train predictive scaler with recent data
    this.predictiveScaler.trainFromHistory(
      metrics.map((m) => ({ cpu: m.cpu, timestamp: m.timestamp })),
    );

    // Check if we should scale up
    const scaleUpResult = this.shouldScaleUp(metrics);
    if (scaleUpResult.shouldScale && currentInstances < this.config.max) {
      const newInstances = Math.min(currentInstances + this.config.scaleUpStep, this.config.max);

      const event = this.createScalingEvent(
        processId,
        processName,
        'up',
        currentInstances,
        newInstances,
        scaleUpResult.reason,
      );

      return event;
    }

    // Check if we should scale down
    const scaleDownResult = this.shouldScaleDown(metrics);
    if (scaleDownResult.shouldScale && currentInstances > this.config.min) {
      const newInstances = Math.max(currentInstances - this.config.scaleDownStep, this.config.min);

      const event = this.createScalingEvent(
        processId,
        processName,
        'down',
        currentInstances,
        newInstances,
        scaleDownResult.reason,
      );

      return event;
    }

    // Predictive scaling: check if upcoming load warrants preemptive scaling
    if (this.predictiveScaler.isTrained()) {
      const nextHour = (new Date().getHours() + 1) % 24;
      const predictedCpu = this.predictiveScaler.predict(nextHour);

      if (predictedCpu > this.config.cpuThreshold && currentInstances < this.config.max) {
        const newInstances = Math.min(currentInstances + this.config.scaleUpStep, this.config.max);

        const event = this.createScalingEvent(
          processId,
          processName,
          'up',
          currentInstances,
          newInstances,
          `Predictive scaling: expected CPU ${predictedCpu.toFixed(1)}% in the next hour`,
        );

        return event;
      }
    }

    return null;
  }

  /**
   * Determine if the process should scale up based on sustained high CPU
   * or high memory usage.
   */
  private shouldScaleUp(metrics: ProcessMetrics[]): { shouldScale: boolean; reason: string } {
    const cpuValues = metrics.map((m) => m.cpu);
    const memoryValues = metrics.map((m) => m.memory);

    const avgCpu = mean(cpuValues);
    const avgMemoryBytes = mean(memoryValues);
    const avgMemoryPercent = (avgMemoryBytes / totalmem()) * 100;

    // Check sustained high CPU (average above threshold)
    if (avgCpu > this.config.cpuThreshold) {
      // Verify it's sustained: at least 60% of recent readings above threshold
      const aboveThresholdCount = cpuValues.filter((v) => v > this.config.cpuThreshold).length;
      const sustainedRatio = aboveThresholdCount / cpuValues.length;

      if (sustainedRatio > 0.6) {
        return {
          shouldScale: true,
          reason: `CPU usage sustained at ${avgCpu.toFixed(1)}% (${(sustainedRatio * 100).toFixed(0)}% of readings above ${this.config.cpuThreshold}% threshold)`,
        };
      }
    }

    // Check memory threshold (using raw memory value as a proportion indicator)
    if (avgMemoryPercent > this.config.memoryThreshold) {
      return {
        shouldScale: true,
        reason: `Memory usage at ${avgMemoryPercent.toFixed(1)}% exceeds ${this.config.memoryThreshold}% threshold`,
      };
    }

    return { shouldScale: false, reason: '' };
  }

  /**
   * Determine if the process should scale down.
   * Requires CPU to be below half the threshold for twice the cooldown period.
   */
  private shouldScaleDown(metrics: ProcessMetrics[]): { shouldScale: boolean; reason: string } {
    const cpuValues = metrics.map((m) => m.cpu);
    const avgCpu = mean(cpuValues);

    // Scale down if average CPU is below half the threshold
    const scaleDownThreshold = this.config.cpuThreshold / 2;

    if (avgCpu < scaleDownThreshold) {
      // Verify it's sustained: at least 80% of readings below the scale-down threshold
      const belowThresholdCount = cpuValues.filter((v) => v < scaleDownThreshold).length;
      const sustainedRatio = belowThresholdCount / cpuValues.length;

      if (sustainedRatio > 0.8) {
        return {
          shouldScale: true,
          reason: `CPU usage low at ${avgCpu.toFixed(1)}% (below ${scaleDownThreshold.toFixed(0)}% for ${(sustainedRatio * 100).toFixed(0)}% of readings)`,
        };
      }
    }

    return { shouldScale: false, reason: '' };
  }

  /**
   * Check if the process is in a cooldown period since the last scaling event.
   */
  private isInCooldown(processId: number): boolean {
    const lastScale = this.lastScaleTimestamp.get(processId);
    if (lastScale === undefined) {
      return false;
    }
    return Date.now() - lastScale < this.config.cooldown;
  }

  /**
   * Create a scaling event and record it in history.
   */
  private createScalingEvent(
    processId: number,
    processName: string,
    direction: 'up' | 'down',
    fromInstances: number,
    toInstances: number,
    reason: string,
  ): ScalingEvent {
    const event: ScalingEvent = {
      processId,
      processName,
      direction,
      fromInstances,
      toInstances,
      reason,
      timestamp: new Date(),
    };

    this.scalingHistory.push(event);
    this.lastScaleTimestamp.set(processId, Date.now());

    return event;
  }

  /**
   * Get the full history of scaling events.
   */
  getHistory(): ScalingEvent[] {
    return [...this.scalingHistory];
  }

  /**
   * Get the predictive scaler instance for direct access.
   */
  getPredictiveScaler(): PredictiveScaler {
    return this.predictiveScaler;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): AutoScalerConfig {
    return { ...this.config };
  }
}
