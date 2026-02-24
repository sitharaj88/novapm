import {
  linearRegression,
  linearRegressionLine,
  rSquared,
  mean,
  standardDeviation,
} from 'simple-statistics';

/**
 * Detects higher-level behavioral patterns such as memory leaks,
 * restart loops, and error rate spikes by analyzing time-series data.
 */
export class PatternDetector {
  /**
   * Detect a memory leak by checking for a consistent upward trend
   * in memory usage. Uses linear regression and requires a positive slope
   * with R-squared > 0.8.
   */
  detectMemoryLeak(metrics: { memory: number; timestamp: number }[]): boolean {
    if (metrics.length < 5) {
      return false;
    }

    // Prepare data as [x, y] pairs for linear regression
    const dataPoints: [number, number][] = metrics.map((m) => [m.timestamp, m.memory]);

    const regression = linearRegression(dataPoints);

    // Slope must be positive (memory is increasing)
    if (regression.m <= 0) {
      return false;
    }

    // Calculate R-squared to see how well the linear model fits
    const regressionLine = linearRegressionLine(regression);
    const r2 = rSquared(dataPoints, regressionLine);

    // High R-squared indicates a consistent, near-linear increase
    return r2 > 0.8;
  }

  /**
   * Detect a restart loop by checking if a process has restarted
   * more than 5 times in the last 10 minutes.
   */
  detectRestartLoop(events: { type: string; timestamp: number }[]): boolean {
    const tenMinutesMs = 10 * 60 * 1000;
    const now = Date.now();
    const cutoff = now - tenMinutesMs;

    const recentRestarts = events.filter((e) => e.type === 'restart' && e.timestamp > cutoff);

    return recentRestarts.length > 5;
  }

  /**
   * Detect an error rate spike using z-score analysis on the error counts.
   * Returns true if the latest error rate is significantly above normal.
   */
  detectErrorRateSpike(metrics: { errors: number; timestamp: number }[]): boolean {
    if (metrics.length < 5) {
      return false;
    }

    const errorValues = metrics.map((m) => m.errors);
    const errorMean = mean(errorValues);
    const errorStdDev = standardDeviation(errorValues);

    if (errorStdDev === 0) {
      return false;
    }

    // Check the most recent error rate
    const latestErrors = errorValues[errorValues.length - 1];
    const zScore = (latestErrors - errorMean) / errorStdDev;

    // A z-score > 2 indicates a statistically significant spike
    return zScore > 2;
  }
}
