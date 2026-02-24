import { describe, it, expect, beforeEach } from 'vitest';
import { MovingAverageDetector } from '../anomaly/MovingAverageDetector.js';

describe('MovingAverageDetector', () => {
  let detector: MovingAverageDetector;

  beforeEach(() => {
    detector = new MovingAverageDetector();
  });

  describe('stable data', () => {
    it('should return no anomalies for constant data', () => {
      const values = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
      const results = detector.detect(values);
      expect(results).toHaveLength(0);
    });

    it('should return no anomalies for slowly varying data with high sensitivity', () => {
      // With a high sensitivity multiplier, small oscillations should not trigger
      const values = [50, 51, 50, 49, 50, 51, 50, 49, 50, 51];
      const results = detector.detect(values, 5);
      expect(results).toHaveLength(0);
    });

    it('should return no anomalies for a constant linear trend with high sensitivity', () => {
      // A gentle linear trend with high sensitivity threshold should not trigger
      const values = Array.from({ length: 20 }, (_, i) => 50 + i * 0.2);
      const results = detector.detect(values, 10);
      expect(results).toHaveLength(0);
    });
  });

  describe('sudden spikes', () => {
    it('should detect a large spike in stable data', () => {
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 200, 10, 10];
      const results = detector.detect(values);
      expect(results.length).toBeGreaterThan(0);
      const spike = results.find((r) => r.value === 200);
      expect(spike).toBeDefined();
      expect(spike!.deviation).toBeGreaterThan(0);
    });

    it('should detect a sudden drop', () => {
      const values = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 0, 100, 100];
      const results = detector.detect(values);
      expect(results.length).toBeGreaterThan(0);
      const drop = results.find((r) => r.value === 0);
      expect(drop).toBeDefined();
    });

    it('should include EMA in results', () => {
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 100, 10, 10];
      const results = detector.detect(values);
      for (const result of results) {
        expect(typeof result.ema).toBe('number');
        expect(Number.isFinite(result.ema)).toBe(true);
      }
    });

    it('should include deviation in results', () => {
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 100, 10, 10];
      const results = detector.detect(values);
      for (const result of results) {
        expect(typeof result.deviation).toBe('number');
        expect(result.deviation).toBeGreaterThan(0);
      }
    });

    it('should detect multiple spikes', () => {
      const values = [10, 10, 10, 10, 10, 100, 10, 10, 10, 10, 10, 100, 10, 10];
      const results = detector.detect(values);
      const spikeValues = results.filter((r) => r.value === 100);
      expect(spikeValues.length).toBeGreaterThanOrEqual(1);
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

    it('should return empty array for two data points', () => {
      const results = detector.detect([10, 100]);
      // With only 2 points, deviations length is 2 which is < 3, so returns empty
      expect(results).toEqual([]);
    });

    it('should return empty for constant values (zero std dev of deviations)', () => {
      const values = [50, 50, 50, 50, 50, 50, 50, 50];
      const results = detector.detect(values);
      expect(results).toHaveLength(0);
    });

    it('should handle large datasets', () => {
      const values = Array.from({ length: 1000 }, () => 50 + Math.random() * 2);
      // Add a big spike
      values[500] = 500;
      const results = detector.detect(values);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('sensitivity configuration', () => {
    it('should detect more anomalies with lower sensitivity', () => {
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 30, 10, 10, 10];
      const lenientResults = detector.detect(values, 0.5);
      const strictResults = detector.detect(values, 5);
      expect(lenientResults.length).toBeGreaterThanOrEqual(strictResults.length);
    });

    it('should detect fewer anomalies with higher sensitivity', () => {
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 50, 10, 10, 10];
      const lenient = detector.detect(values, 1);
      const strict = detector.detect(values, 10);
      expect(strict.length).toBeLessThanOrEqual(lenient.length);
    });

    it('should accept sensitivity via constructor', () => {
      const sensitiveDetector = new MovingAverageDetector({ sensitivity: 0.5 });
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 25, 10, 10, 10];
      const results = sensitiveDetector.detect(values);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should allow overriding constructor sensitivity via detect parameter', () => {
      const strictDetector = new MovingAverageDetector({ sensitivity: 100 });
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 200, 10, 10, 10];
      // With very high constructor sensitivity, may detect nothing
      const defaultResults = strictDetector.detect(values);
      // Override with low sensitivity to detect the spike
      const overrideResults = strictDetector.detect(values, 0.5);
      expect(overrideResults.length).toBeGreaterThanOrEqual(defaultResults.length);
    });
  });

  describe('alpha (smoothing factor) configuration', () => {
    it('should accept alpha via constructor', () => {
      const fastEma = new MovingAverageDetector({ alpha: 0.9 });
      const slowEma = new MovingAverageDetector({ alpha: 0.1 });
      const values = [10, 10, 10, 10, 10, 10, 10, 10, 10, 100, 10, 10, 10];
      // Both should handle the data without errors
      const fastResults = fastEma.detect(values);
      const slowResults = slowEma.detect(values);
      expect(Array.isArray(fastResults)).toBe(true);
      expect(Array.isArray(slowResults)).toBe(true);
    });
  });
});
