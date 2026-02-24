import { quantile } from 'simple-statistics';
import type { IQRResult } from '../types.js';

/**
 * Detects outliers using the Interquartile Range (IQR) method.
 * Values outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR] are flagged as outliers.
 */
export class IQRDetector {
  private readonly multiplier: number;

  constructor(options?: { multiplier?: number }) {
    this.multiplier = options?.multiplier ?? 1.5;
  }

  /**
   * Detect outliers using IQR method.
   * Returns all values with an outlier flag.
   */
  detect(values: number[]): IQRResult[] {
    if (values.length < 4) {
      // Need at least 4 data points for meaningful quartile calculation
      return values.map((value, index) => ({
        index,
        value,
        isOutlier: false,
      }));
    }

    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;

    const lowerBound = q1 - this.multiplier * iqr;
    const upperBound = q3 + this.multiplier * iqr;

    return values.map((value, index) => ({
      index,
      value,
      isOutlier: value < lowerBound || value > upperBound,
    }));
  }
}
