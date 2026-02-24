import { mean, standardDeviation } from 'simple-statistics';
import type { RateOfChangeResult } from '../types.js';

/**
 * Detects anomalies based on the rate of change (derivative) between
 * consecutive values. Useful for detecting memory leaks (sustained increases)
 * and sudden spikes.
 */
export class RateOfChangeDetector {
  private readonly windowSize: number;

  constructor(options?: { windowSize?: number }) {
    this.windowSize = options?.windowSize ?? 10;
  }

  /**
   * Detect unusually rapid rates of change.
   * @param values - The time series values.
   * @param maxRate - Maximum allowed rate of change. If not provided, uses
   *                  mean + 2*stddev of the rate values as the threshold.
   */
  detect(values: number[], maxRate?: number): RateOfChangeResult[] {
    const results: RateOfChangeResult[] = [];

    if (values.length < 2) {
      return results;
    }

    // Calculate rate of change (derivative) between consecutive points
    const rates: number[] = [];
    for (let i = 1; i < values.length; i++) {
      rates.push(values[i] - values[i - 1]);
    }

    // Determine the threshold
    let threshold: number;
    if (maxRate !== undefined) {
      threshold = maxRate;
    } else {
      if (rates.length < 2) {
        return results;
      }
      const rateMean = mean(rates);
      const rateStdDev = standardDeviation(rates);
      threshold = rateMean + 2 * rateStdDev;
    }

    // Flag values with rates exceeding the threshold
    for (let i = 0; i < rates.length; i++) {
      if (Math.abs(rates[i]) > threshold) {
        results.push({
          index: i + 1, // +1 because rate[i] corresponds to values[i+1]
          value: values[i + 1],
          rate: rates[i],
        });
      }
    }

    return results;
  }

  /**
   * Detect sustained increases over a sliding window.
   * Returns true if the values have been consistently increasing
   * over the window.
   */
  detectSustainedIncrease(values: number[]): boolean {
    if (values.length < this.windowSize) {
      return false;
    }

    // Check the last windowSize values
    const window = values.slice(-this.windowSize);
    let increasingCount = 0;

    for (let i = 1; i < window.length; i++) {
      if (window[i] > window[i - 1]) {
        increasingCount++;
      }
    }

    // Consider sustained if > 80% of intervals are increasing
    return increasingCount / (window.length - 1) > 0.8;
  }
}
