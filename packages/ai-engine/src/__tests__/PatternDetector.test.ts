import { describe, it, expect, beforeEach } from 'vitest';
import { PatternDetector } from '../anomaly/PatternDetector.js';

describe('PatternDetector', () => {
  let detector: PatternDetector;

  beforeEach(() => {
    detector = new PatternDetector();
  });

  describe('detectMemoryLeak', () => {
    it('should detect a clear linear memory increase', () => {
      const now = Date.now();
      const metrics = Array.from({ length: 20 }, (_, i) => ({
        memory: 100_000_000 + i * 5_000_000,
        timestamp: now + i * 60_000,
      }));
      expect(detector.detectMemoryLeak(metrics)).toBe(true);
    });

    it('should not flag stable memory usage', () => {
      const now = Date.now();
      const metrics = Array.from({ length: 20 }, (_, i) => ({
        memory: 100_000_000 + (i % 2 === 0 ? 1_000_000 : -1_000_000),
        timestamp: now + i * 60_000,
      }));
      expect(detector.detectMemoryLeak(metrics)).toBe(false);
    });

    it('should not flag decreasing memory', () => {
      const now = Date.now();
      const metrics = Array.from({ length: 20 }, (_, i) => ({
        memory: 200_000_000 - i * 5_000_000,
        timestamp: now + i * 60_000,
      }));
      expect(detector.detectMemoryLeak(metrics)).toBe(false);
    });

    it('should return false for fewer than 5 data points', () => {
      const now = Date.now();
      const metrics = Array.from({ length: 4 }, (_, i) => ({
        memory: 100_000_000 + i * 10_000_000,
        timestamp: now + i * 60_000,
      }));
      expect(detector.detectMemoryLeak(metrics)).toBe(false);
    });

    it('should return false for exactly 5 points with no clear trend', () => {
      const now = Date.now();
      const metrics = [
        { memory: 100_000_000, timestamp: now },
        { memory: 50_000_000, timestamp: now + 60_000 },
        { memory: 150_000_000, timestamp: now + 120_000 },
        { memory: 60_000_000, timestamp: now + 180_000 },
        { memory: 110_000_000, timestamp: now + 240_000 },
      ];
      expect(detector.detectMemoryLeak(metrics)).toBe(false);
    });

    it('should detect memory leak with exactly 5 points on a perfect line', () => {
      const now = Date.now();
      const metrics = Array.from({ length: 5 }, (_, i) => ({
        memory: 100_000_000 + i * 20_000_000,
        timestamp: now + i * 60_000,
      }));
      expect(detector.detectMemoryLeak(metrics)).toBe(true);
    });

    it('should require R-squared > 0.8 (noisy data should not be flagged)', () => {
      const now = Date.now();
      // Add significant noise to a slight upward trend
      const metrics = Array.from({ length: 20 }, (_, i) => ({
        memory: 100_000_000 + i * 1_000_000 + Math.sin(i) * 50_000_000,
        timestamp: now + i * 60_000,
      }));
      // With heavy sinusoidal noise, R-squared should be low
      expect(detector.detectMemoryLeak(metrics)).toBe(false);
    });

    it('should return false for empty metrics', () => {
      expect(detector.detectMemoryLeak([])).toBe(false);
    });
  });

  describe('detectRestartLoop', () => {
    it('should detect more than 5 restarts in the last 10 minutes', () => {
      const now = Date.now();
      const events = Array.from({ length: 6 }, (_, i) => ({
        type: 'restart',
        timestamp: now - i * 60_000, // 0, 1, 2, 3, 4, 5 minutes ago
      }));
      expect(detector.detectRestartLoop(events)).toBe(true);
    });

    it('should not flag exactly 5 restarts', () => {
      const now = Date.now();
      const events = Array.from({ length: 5 }, (_, i) => ({
        type: 'restart',
        timestamp: now - i * 60_000,
      }));
      expect(detector.detectRestartLoop(events)).toBe(false);
    });

    it('should not flag old restarts outside the 10-minute window', () => {
      const now = Date.now();
      const events = Array.from({ length: 10 }, (_, i) => ({
        type: 'restart',
        timestamp: now - (15 + i) * 60_000, // 15-24 minutes ago, all outside window
      }));
      expect(detector.detectRestartLoop(events)).toBe(false);
    });

    it('should not count non-restart events', () => {
      const now = Date.now();
      const events = [
        { type: 'start', timestamp: now - 60_000 },
        { type: 'stop', timestamp: now - 120_000 },
        { type: 'error', timestamp: now - 180_000 },
        { type: 'restart', timestamp: now - 240_000 },
        { type: 'crash', timestamp: now - 300_000 },
        { type: 'restart', timestamp: now - 360_000 },
        { type: 'restart', timestamp: now - 420_000 },
      ];
      expect(detector.detectRestartLoop(events)).toBe(false);
    });

    it('should return false for empty events', () => {
      expect(detector.detectRestartLoop([])).toBe(false);
    });

    it('should handle a mix of recent and old restarts', () => {
      const now = Date.now();
      const events = [
        // 3 recent restarts
        { type: 'restart', timestamp: now - 60_000 },
        { type: 'restart', timestamp: now - 120_000 },
        { type: 'restart', timestamp: now - 180_000 },
        // 5 old restarts (outside window)
        { type: 'restart', timestamp: now - 20 * 60_000 },
        { type: 'restart', timestamp: now - 21 * 60_000 },
        { type: 'restart', timestamp: now - 22 * 60_000 },
        { type: 'restart', timestamp: now - 23 * 60_000 },
        { type: 'restart', timestamp: now - 24 * 60_000 },
      ];
      expect(detector.detectRestartLoop(events)).toBe(false);
    });
  });

  describe('detectErrorRateSpike', () => {
    it('should detect a spike in the latest error rate', () => {
      const now = Date.now();
      const metrics = [
        { errors: 2, timestamp: now - 5 * 60_000 },
        { errors: 3, timestamp: now - 4 * 60_000 },
        { errors: 2, timestamp: now - 3 * 60_000 },
        { errors: 3, timestamp: now - 2 * 60_000 },
        { errors: 2, timestamp: now - 60_000 },
        { errors: 50, timestamp: now }, // Big spike
      ];
      expect(detector.detectErrorRateSpike(metrics)).toBe(true);
    });

    it('should not flag normal error rates', () => {
      const now = Date.now();
      const metrics = Array.from({ length: 10 }, (_, i) => ({
        errors: 5 + (i % 2),
        timestamp: now - (10 - i) * 60_000,
      }));
      expect(detector.detectErrorRateSpike(metrics)).toBe(false);
    });

    it('should return false for fewer than 5 data points', () => {
      const now = Date.now();
      const metrics = [
        { errors: 1, timestamp: now - 60_000 },
        { errors: 100, timestamp: now },
      ];
      expect(detector.detectErrorRateSpike(metrics)).toBe(false);
    });

    it('should return false when all error counts are zero', () => {
      const now = Date.now();
      const metrics = Array.from({ length: 10 }, (_, i) => ({
        errors: 0,
        timestamp: now - (10 - i) * 60_000,
      }));
      expect(detector.detectErrorRateSpike(metrics)).toBe(false);
    });

    it('should return false when all error counts are identical', () => {
      const now = Date.now();
      const metrics = Array.from({ length: 10 }, (_, i) => ({
        errors: 10,
        timestamp: now - (10 - i) * 60_000,
      }));
      // stddev = 0, so returns false
      expect(detector.detectErrorRateSpike(metrics)).toBe(false);
    });

    it('should not flag when latest value is only slightly above average', () => {
      const now = Date.now();
      const metrics = [
        { errors: 10, timestamp: now - 5 * 60_000 },
        { errors: 11, timestamp: now - 4 * 60_000 },
        { errors: 9, timestamp: now - 3 * 60_000 },
        { errors: 10, timestamp: now - 2 * 60_000 },
        { errors: 12, timestamp: now - 60_000 },
        { errors: 13, timestamp: now },
      ];
      expect(detector.detectErrorRateSpike(metrics)).toBe(false);
    });

    it('should return false for empty data', () => {
      expect(detector.detectErrorRateSpike([])).toBe(false);
    });
  });
});
