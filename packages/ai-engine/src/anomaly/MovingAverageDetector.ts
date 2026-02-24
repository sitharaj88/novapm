import { standardDeviation } from 'simple-statistics';
import type { MovingAverageResult } from '../types.js';

/**
 * Detects anomalies by comparing values against an Exponential Moving Average (EMA).
 * Flags when the current value deviates from the EMA by more than
 * sensitivity * standard_deviation.
 */
export class MovingAverageDetector {
  private readonly alpha: number;
  private readonly sensitivity: number;

  constructor(options?: { alpha?: number; sensitivity?: number }) {
    this.alpha = options?.alpha ?? 0.3;
    this.sensitivity = options?.sensitivity ?? 2;
  }

  /**
   * Detect anomalies relative to an exponential moving average.
   */
  detect(values: number[], sensitivity?: number): MovingAverageResult[] {
    const effectiveSensitivity = sensitivity ?? this.sensitivity;
    const results: MovingAverageResult[] = [];

    if (values.length < 2) {
      return results;
    }

    // Calculate EMA for all values
    const emaValues: number[] = [];
    emaValues[0] = values[0];
    for (let i = 1; i < values.length; i++) {
      emaValues[i] = this.alpha * values[i] + (1 - this.alpha) * emaValues[i - 1];
    }

    // Calculate deviations from EMA
    const deviations = values.map((val, i) => Math.abs(val - emaValues[i]));

    // We need at least a few points to compute a meaningful std dev of deviations
    if (deviations.length < 3) {
      return results;
    }

    const deviationStdDev = standardDeviation(deviations);

    if (deviationStdDev === 0) {
      return results;
    }

    for (let i = 0; i < values.length; i++) {
      const deviation = Math.abs(values[i] - emaValues[i]);

      if (deviation > effectiveSensitivity * deviationStdDev) {
        results.push({
          index: i,
          value: values[i],
          ema: emaValues[i],
          deviation,
        });
      }
    }

    return results;
  }
}
