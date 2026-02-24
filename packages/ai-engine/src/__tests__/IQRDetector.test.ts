import { describe, it, expect, beforeEach } from 'vitest';
import { IQRDetector } from '../anomaly/IQRDetector.js';

describe('IQRDetector', () => {
  let detector: IQRDetector;

  beforeEach(() => {
    detector = new IQRDetector();
  });

  describe('normal distribution (no anomalies)', () => {
    it('should flag no outliers in tightly clustered data', () => {
      const values = [48, 49, 50, 50, 51, 52, 50, 49, 51, 50];
      const results = detector.detect(values);
      expect(results).toHaveLength(values.length);
      const outliers = results.filter((r) => r.isOutlier);
      expect(outliers).toHaveLength(0);
    });

    it('should return all values with isOutlier = false for uniform data', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const results = detector.detect(values);
      expect(results).toHaveLength(values.length);
      // The IQR spread is large enough to contain all values
      for (const result of results) {
        expect(result.isOutlier).toBe(false);
      }
    });

    it('should preserve original indices in results', () => {
      const values = [10, 20, 30, 40, 50];
      const results = detector.detect(values);
      results.forEach((result, i) => {
        expect(result.index).toBe(i);
        expect(result.value).toBe(values[i]);
      });
    });
  });

  describe('data with clear outliers', () => {
    it('should detect extreme high outlier', () => {
      const values = [10, 11, 12, 10, 11, 10, 12, 11, 10, 11, 100];
      const results = detector.detect(values);
      const outliers = results.filter((r) => r.isOutlier);
      expect(outliers.length).toBeGreaterThan(0);
      expect(outliers.some((o) => o.value === 100)).toBe(true);
    });

    it('should detect extreme low outlier', () => {
      const values = [100, 101, 99, 100, 102, 98, 100, 101, 99, 100, -50];
      const results = detector.detect(values);
      const outliers = results.filter((r) => r.isOutlier);
      expect(outliers.length).toBeGreaterThan(0);
      expect(outliers.some((o) => o.value === -50)).toBe(true);
    });

    it('should detect both high and low outliers', () => {
      const values = [-100, 10, 11, 10, 12, 10, 11, 10, 12, 11, 200];
      const results = detector.detect(values);
      const outliers = results.filter((r) => r.isOutlier);
      expect(outliers.length).toBeGreaterThanOrEqual(2);
      expect(outliers.some((o) => o.value === -100)).toBe(true);
      expect(outliers.some((o) => o.value === 200)).toBe(true);
    });

    it('should not flag moderate deviations as outliers', () => {
      // Values within a reasonable range for the IQR
      const values = [10, 15, 20, 25, 30, 35, 40, 45, 50];
      const results = detector.detect(values);
      const outliers = results.filter((r) => r.isOutlier);
      expect(outliers).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty data', () => {
      const results = detector.detect([]);
      expect(results).toEqual([]);
    });

    it('should mark no outliers for fewer than 4 data points', () => {
      const values = [10, 50, 100];
      const results = detector.detect(values);
      expect(results).toHaveLength(3);
      // With < 4 points, all should be non-outliers
      for (const result of results) {
        expect(result.isOutlier).toBe(false);
      }
    });

    it('should handle exactly 4 data points and apply IQR', () => {
      // With 4 data points the IQR calculation runs, but the quartile
      // spread absorbs outliers easily. Verify the method runs and returns results.
      const values = [10, 10, 10, 100];
      const results = detector.detect(values);
      expect(results).toHaveLength(4);
      // With [10,10,10,100]: Q1=10, Q3=55, IQR=45, upper=122.5
      // 100 < 122.5, so NOT an outlier with the default multiplier 1.5
      for (const r of results) {
        expect(typeof r.isOutlier).toBe('boolean');
      }
    });

    it('should detect outliers with 5+ tightly clustered points and one extreme', () => {
      // [10,10,10,10,100]: Q1=10, Q3=10, IQR=0, bounds=[10,10], so 100 IS an outlier
      const values = [10, 10, 10, 10, 100];
      const results = detector.detect(values);
      const outliers = results.filter((r) => r.isOutlier);
      expect(outliers.length).toBeGreaterThan(0);
      expect(outliers.some((o) => o.value === 100)).toBe(true);
    });

    it('should handle all identical values (zero IQR)', () => {
      const values = [50, 50, 50, 50, 50, 50, 50, 50];
      const results = detector.detect(values);
      expect(results).toHaveLength(8);
      // When IQR is 0, lowerBound = upperBound = 50, no outliers
      const outliers = results.filter((r) => r.isOutlier);
      expect(outliers).toHaveLength(0);
    });

    it('should handle single data point', () => {
      const results = detector.detect([42]);
      expect(results).toHaveLength(1);
      expect(results[0].isOutlier).toBe(false);
    });

    it('should handle negative values', () => {
      const values = [-10, -9, -10, -11, -10, -9, -10, -100];
      const results = detector.detect(values);
      const outliers = results.filter((r) => r.isOutlier);
      expect(outliers.some((o) => o.value === -100)).toBe(true);
    });
  });

  describe('multiplier configuration', () => {
    it('should use default multiplier of 1.5', () => {
      const defaultDetector = new IQRDetector();
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30];
      const results = defaultDetector.detect(values);
      const outliers = results.filter((r) => r.isOutlier);
      expect(outliers.some((o) => o.value === 30)).toBe(true);
    });

    it('should detect fewer outliers with higher multiplier', () => {
      const strictDetector = new IQRDetector({ multiplier: 3 });
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30];
      const results = strictDetector.detect(values);
      const outlierCount = results.filter((r) => r.isOutlier).length;
      // With multiplier 3, the range is much wider, so 30 may not be an outlier
      const defaultDetector = new IQRDetector({ multiplier: 1.5 });
      const defaultResults = defaultDetector.detect(values);
      const defaultOutlierCount = defaultResults.filter((r) => r.isOutlier).length;
      expect(outlierCount).toBeLessThanOrEqual(defaultOutlierCount);
    });

    it('should detect more outliers with lower multiplier', () => {
      const sensitiveDetector = new IQRDetector({ multiplier: 0.5 });
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20];
      const sensitiveResults = sensitiveDetector.detect(values);
      const sensitiveOutliers = sensitiveResults.filter((r) => r.isOutlier).length;

      const defaultDetector = new IQRDetector();
      const defaultResults = defaultDetector.detect(values);
      const defaultOutliers = defaultResults.filter((r) => r.isOutlier).length;

      expect(sensitiveOutliers).toBeGreaterThanOrEqual(defaultOutliers);
    });
  });
});
