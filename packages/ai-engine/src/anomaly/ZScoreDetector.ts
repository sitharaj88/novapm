import { mean, standardDeviation } from 'simple-statistics';
import type { ZScoreResult } from '../types.js';

/**
 * Detects anomalies using z-score analysis.
 * Flags values that deviate more than a configurable threshold
 * (in standard deviations) from the rolling mean.
 */
export class ZScoreDetector {
  private readonly windowSize: number;
  private readonly threshold: number;

  constructor(options?: { windowSize?: number; threshold?: number }) {
    this.windowSize = options?.windowSize ?? 30;
    this.threshold = options?.threshold ?? 3;
  }

  /**
   * Detect anomalies in a series of values using rolling z-score.
   * Returns indices where the z-score exceeds the threshold.
   */
  detect(values: number[], threshold?: number): ZScoreResult[] {
    const effectiveThreshold = threshold ?? this.threshold;
    const results: ZScoreResult[] = [];

    if (values.length < 2) {
      return results;
    }

    for (let i = 0; i < values.length; i++) {
      // Use a rolling window ending at the current index
      const windowStart = Math.max(0, i - this.windowSize + 1);
      const window = values.slice(windowStart, i + 1);

      if (window.length < 2) {
        continue;
      }

      const windowMean = mean(window);
      const windowStdDev = standardDeviation(window);

      // Avoid division by zero when all values are identical
      if (windowStdDev === 0) {
        continue;
      }

      const zScore = Math.abs((values[i] - windowMean) / windowStdDev);

      if (zScore > effectiveThreshold) {
        results.push({
          index: i,
          value: values[i],
          zScore,
        });
      }
    }

    return results;
  }
}
