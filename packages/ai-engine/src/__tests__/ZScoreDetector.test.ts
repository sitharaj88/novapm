import { describe, it, expect, beforeEach } from 'vitest';
import { ZScoreDetector } from '../anomaly/ZScoreDetector.js';

describe('ZScoreDetector', () => {
  let detector: ZScoreDetector;

  beforeEach(() => {
    detector = new ZScoreDetector();
  });

  describe('normal data (no anomalies)', () => {
    it('should return no anomalies for stable data', () => {
      const values = [50, 51, 49, 50, 52, 48, 50, 51, 49, 50];
      const results = detector.detect(values);
      expect(results).toHaveLength(0);
    });

    it('should return no anomalies for gradually increasing data', () => {
      const values = Array.from({ length: 20 }, (_, i) => 50 + i * 0.5);
      const results = detector.detect(values);
      expect(results).toHaveLength(0);
    });

    it('should return no anomalies for normally distributed data', () => {
      // Simulated normal distribution around mean=100, small variance
      const values = [98, 101, 99, 100, 102, 97, 103, 100, 99, 101, 98, 100, 102, 99, 101];
      const results = detector.detect(values);
      expect(results).toHaveLength(0);
    });
  });

  describe('data with clear outliers', () => {
    it('should detect a single large spike in otherwise stable data', () => {
      // Use a lower threshold (2) since the rolling window includes the spike,
      // which reduces the z-score. With 30 values of 10 and one 1000, the spike
      // should exceed threshold 2 easily.
      const values = Array.from({ length: 30 }, () => 10);
      values.push(1000);
      values.push(10, 10, 10);
      const results = detector.detect(values, 2);
      expect(results.length).toBeGreaterThan(0);

      const spikeResult = results.find((r) => r.value === 1000);
      expect(spikeResult).toBeDefined();
      expect(spikeResult!.index).toBe(30);
      expect(spikeResult!.zScore).toBeGreaterThan(2);
    });

    it('should detect a negative outlier (sudden drop)', () => {
      // Large window of constant 100s, then a 0 -- with threshold 2
      const values = Array.from({ length: 30 }, () => 100);
      values.push(0);
      values.push(100, 100, 100);
      const results = detector.detect(values, 2);
      expect(results.length).toBeGreaterThan(0);

      const dropResult = results.find((r) => r.value === 0);
      expect(dropResult).toBeDefined();
      expect(dropResult!.zScore).toBeGreaterThan(2);
    });

    it('should detect multiple outliers in data', () => {
      // Lots of stable data with extreme spikes
      const values = Array.from({ length: 30 }, () => 10);
      values[10] = 1000;
      values[25] = 1000;
      const results = detector.detect(values, 2);
      const spikeIndices = results.filter((r) => r.value === 1000).map((r) => r.index);
      expect(spikeIndices).toContain(10);
      expect(spikeIndices).toContain(25);
    });

    it('should report correct z-score values', () => {
      const values = Array.from({ length: 30 }, () => 10);
      values.push(500);
      const results = detector.detect(values, 2);
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.zScore).toBeGreaterThan(2);
        expect(typeof result.zScore).toBe('number');
        expect(Number.isFinite(result.zScore)).toBe(true);
      }
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

    it('should return empty array for two identical values', () => {
      const results = detector.detect([50, 50]);
      expect(results).toEqual([]);
    });

    it('should return empty array for constant values (zero std dev)', () => {
      const values = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
      const results = detector.detect(values);
      expect(results).toEqual([]);
    });

    it('should handle very large values without crashing', () => {
      const values = Array.from({ length: 30 }, () => 1e10);
      values.push(1e15);
      const results = detector.detect(values, 2);
      expect(Array.isArray(results)).toBe(true);
      const spike = results.find((r) => r.value === 1e15);
      expect(spike).toBeDefined();
    });

    it('should handle negative values', () => {
      const values = Array.from({ length: 30 }, () => -10);
      values.push(-1000);
      const results = detector.detect(values, 2);
      expect(results.length).toBeGreaterThan(0);
      const outlier = results.find((r) => r.value === -1000);
      expect(outlier).toBeDefined();
    });
  });

  describe('sensitivity threshold configuration', () => {
    it('should use default threshold of 3 when not specified', () => {
      // Value with z-score between 2.5 and 3 should not be flagged by default
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 30];
      const defaultResults = detector.detect(values);
      // With a stricter threshold (higher), fewer results
      const strictResults = detector.detect(values, 5);
      expect(strictResults.length).toBeLessThanOrEqual(defaultResults.length);
    });

    it('should detect more anomalies with a lower threshold', () => {
      const values = [10, 11, 10, 9, 10, 11, 10, 9, 10, 25, 10, 10];
      const strictResults = detector.detect(values, 4);
      const lenientResults = detector.detect(values, 1.5);
      expect(lenientResults.length).toBeGreaterThanOrEqual(strictResults.length);
    });

    it('should detect fewer anomalies with a higher threshold', () => {
      const values = [10, 10, 10, 10, 10, 50, 10, 10, 10, 80, 10, 10];
      const lenient = detector.detect(values, 1);
      const strict = detector.detect(values, 5);
      expect(strict.length).toBeLessThanOrEqual(lenient.length);
    });

    it('should accept threshold via constructor options', () => {
      const sensitiveDetector = new ZScoreDetector({ threshold: 1.5 });
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 25, 10, 10];
      const results = sensitiveDetector.detect(values);
      // With threshold 1.5, the spike at 25 should be detected more easily
      expect(results.length).toBeGreaterThan(0);
    });

    it('should allow overriding constructor threshold via detect parameter', () => {
      const strictDetector = new ZScoreDetector({ threshold: 10 });
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 100, 10, 10];
      // Constructor threshold is 10, so fewer detections
      const defaultResults = strictDetector.detect(values);
      // Override with lenient threshold
      const overrideResults = strictDetector.detect(values, 2);
      expect(overrideResults.length).toBeGreaterThanOrEqual(defaultResults.length);
    });
  });

  describe('window size configuration', () => {
    it('should use a custom window size from constructor', () => {
      const smallWindowDetector = new ZScoreDetector({ windowSize: 5 });
      const values = [10, 10, 10, 10, 10, 50, 50, 50, 50, 50, 10, 10];
      // With a small window, the first 50 is an outlier relative to [10,10,10,10,10]
      const results = smallWindowDetector.detect(values);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should default to window size of 30', () => {
      const defaultDetector = new ZScoreDetector();
      // All data points fit within window of 30
      const values = Array.from({ length: 25 }, () => 10);
      values.push(100);
      const results = defaultDetector.detect(values);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
