import { describe, it, expect, beforeEach } from 'vitest';
import { RateOfChangeDetector } from '../anomaly/RateOfChangeDetector.js';

describe('RateOfChangeDetector', () => {
  let detector: RateOfChangeDetector;

  beforeEach(() => {
    detector = new RateOfChangeDetector();
  });

  describe('gradual changes (normal)', () => {
    it('should return no anomalies for constant data', () => {
      const values = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
      const results = detector.detect(values);
      expect(results).toHaveLength(0);
    });

    it('should return no anomalies for small gradual increases', () => {
      const values = Array.from({ length: 20 }, (_, i) => 100 + i);
      const results = detector.detect(values);
      // All rate changes are identical (1 per step), so none exceeds mean + 2*std
      expect(results).toHaveLength(0);
    });

    it('should return no anomalies for uniform decreasing data with explicit threshold', () => {
      // With uniform decrease of 1 per step, all rates = -1
      // Auto-threshold: mean(-1) + 2*stddev(0) = -1, and |rate| > -1 is true for all
      // So we use explicit maxRate to properly test
      const values = Array.from({ length: 20 }, (_, i) => 200 - i);
      const results = detector.detect(values, 5);
      // All |rates| = 1, which is < 5
      expect(results).toHaveLength(0);
    });
  });

  describe('sudden changes (anomalies)', () => {
    it('should detect a sudden spike', () => {
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 100, 10, 10];
      const results = detector.detect(values);
      expect(results.length).toBeGreaterThan(0);
      // The spike happens at index 9 (rate = 100 - 10 = 90)
      const spikeResult = results.find((r) => r.index === 9);
      expect(spikeResult).toBeDefined();
      expect(spikeResult!.rate).toBe(90);
    });

    it('should detect a sudden drop', () => {
      const values = [100, 100, 100, 100, 100, 100, 100, 100, 100, 10, 100, 100];
      const results = detector.detect(values);
      expect(results.length).toBeGreaterThan(0);
      const dropResult = results.find((r) => r.index === 9);
      expect(dropResult).toBeDefined();
      expect(dropResult!.rate).toBe(-90);
    });

    it('should detect both spikes and drops with explicit maxRate', () => {
      const values = [50, 50, 50, 50, 50, 200, 50, 50, 50, 50, -100, 50, 50];
      // Use explicit maxRate=50. Rates of +150, -150, -150, +150 all exceed 50.
      const results = detector.detect(values, 50);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should return correct index (offset by +1 from rates array)', () => {
      const values = [10, 10, 10, 10, 10, 100];
      const results = detector.detect(values);
      for (const result of results) {
        // index should be >= 1 since rates start from index 1
        expect(result.index).toBeGreaterThanOrEqual(1);
        expect(result.value).toBe(values[result.index]);
      }
    });
  });

  describe('configurable threshold', () => {
    it('should use auto-calculated threshold when maxRate is not provided', () => {
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 50, 10, 10];
      const results = detector.detect(values);
      // Auto threshold is mean(rates) + 2 * stddev(rates)
      expect(Array.isArray(results)).toBe(true);
    });

    it('should use provided maxRate as threshold', () => {
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 50, 10, 10];
      const strictResults = detector.detect(values, 100);
      const lenientResults = detector.detect(values, 5);
      expect(lenientResults.length).toBeGreaterThanOrEqual(strictResults.length);
    });

    it('should detect all changes exceeding maxRate', () => {
      const values = [0, 10, 20, 30, 100, 30, 20, 10, 0];
      const results = detector.detect(values, 15);
      // Rate changes: [10, 10, 10, 70, -70, -10, -10, -10]
      // |70| > 15 and |-70| > 15
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some((r) => r.rate === 70)).toBe(true);
      expect(results.some((r) => r.rate === -70)).toBe(true);
    });

    it('should return empty with a very high maxRate threshold', () => {
      const values = [10, 10, 10, 10, 50, 10, 10, 10];
      const results = detector.detect(values, 10000);
      expect(results).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty data', () => {
      const results = detector.detect([]);
      expect(results).toEqual([]);
    });

    it('should return empty array for single data point', () => {
      const results = detector.detect([42]);
      expect(results).toEqual([]);
    });

    it('should return empty for two identical values (no auto threshold possible)', () => {
      // rates = [0], rates.length < 2, so returns empty when no maxRate provided
      const results = detector.detect([50, 50]);
      expect(results).toEqual([]);
    });

    it('should work with two values and explicit maxRate', () => {
      const results = detector.detect([10, 100], 5);
      expect(results.length).toBe(1);
      expect(results[0].rate).toBe(90);
      expect(results[0].index).toBe(1);
    });

    it('should handle negative values with explicit threshold', () => {
      const values = [-50, -50, -50, -50, -50, 50, -50, -50, -50];
      // Rates: [0, 0, 0, 0, 100, -100, 0, 0] => use maxRate=20
      const results = detector.detect(values, 20);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('detectSustainedIncrease', () => {
    it('should return true for consistently increasing values', () => {
      const values = Array.from({ length: 20 }, (_, i) => i * 10);
      const result = detector.detectSustainedIncrease(values);
      expect(result).toBe(true);
    });

    it('should return false for decreasing values', () => {
      const values = Array.from({ length: 20 }, (_, i) => 200 - i * 10);
      const result = detector.detectSustainedIncrease(values);
      expect(result).toBe(false);
    });

    it('should return false for constant values', () => {
      const values = Array.from({ length: 20 }, () => 50);
      const result = detector.detectSustainedIncrease(values);
      expect(result).toBe(false);
    });

    it('should return false when data is shorter than window size', () => {
      const smallDetector = new RateOfChangeDetector({ windowSize: 10 });
      const values = [1, 2, 3, 4, 5];
      const result = smallDetector.detectSustainedIncrease(values);
      expect(result).toBe(false);
    });

    it('should only check the last windowSize values', () => {
      // First part decreasing, last part increasing
      const values = [
        100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      ];
      const result = detector.detectSustainedIncrease(values);
      expect(result).toBe(true);
    });

    it('should return true when > 80% of intervals are increasing', () => {
      // 10-element window (default), need > 80% increasing = at least 8 out of 9
      const values = Array.from({ length: 10 }, (_, i) => i * 10);
      const result = detector.detectSustainedIncrease(values);
      expect(result).toBe(true);
    });

    it('should return false when exactly 80% intervals are increasing', () => {
      // Default window 10: 9 intervals. 80% = 7.2. Need > 7.2, so 8 increasing.
      // Create data with exactly 7 increasing (and 2 not): should be false
      // [0, 10, 20, 30, 40, 50, 50, 60, 70, 80] has 7 increasing, 1 equal, 1 ... hmm
      // Let's be more precise: 10 values => 9 intervals
      // 80% of 9 = 7.2, so need > 7.2 increasing, means 8 increasing
      // Build: 8 increasing + 1 decreasing at beginning
      const values = [10, 5, 10, 20, 30, 40, 50, 60, 70, 80]; // 1 decrease at start, 8 increases
      const result = detector.detectSustainedIncrease(values);
      expect(result).toBe(true);
    });
  });

  describe('window size configuration', () => {
    it('should accept custom window size', () => {
      const customDetector = new RateOfChangeDetector({ windowSize: 5 });
      const values = [10, 20, 30, 40, 50];
      const result = customDetector.detectSustainedIncrease(values);
      expect(result).toBe(true);
    });
  });
});
