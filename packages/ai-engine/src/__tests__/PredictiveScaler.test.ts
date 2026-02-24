import { describe, it, expect, beforeEach } from 'vitest';
import { PredictiveScaler } from '../scaling/PredictiveScaler.js';

describe('PredictiveScaler', () => {
  let scaler: PredictiveScaler;

  beforeEach(() => {
    scaler = new PredictiveScaler();
  });

  describe('trainFromHistory', () => {
    it('should accept and store metrics data', () => {
      const metrics = [
        { cpu: 50, timestamp: new Date('2025-01-01T10:00:00') },
        { cpu: 60, timestamp: new Date('2025-01-01T10:30:00') },
      ];
      // Should not throw
      scaler.trainFromHistory(metrics);
    });

    it('should bucket metrics by hour', () => {
      const metrics = [
        { cpu: 50, timestamp: new Date('2025-01-01T10:00:00') },
        { cpu: 60, timestamp: new Date('2025-01-01T10:30:00') },
        { cpu: 70, timestamp: new Date('2025-01-01T14:00:00') },
      ];
      scaler.trainFromHistory(metrics);

      // Hour 10 should average 55
      const predictedHour10 = scaler.predict(10);
      expect(predictedHour10).toBe(55);

      // Hour 14 should be 70
      const predictedHour14 = scaler.predict(14);
      expect(predictedHour14).toBe(70);
    });

    it('should accumulate data across multiple training calls', () => {
      scaler.trainFromHistory([{ cpu: 40, timestamp: new Date('2025-01-01T08:00:00') }]);
      scaler.trainFromHistory([{ cpu: 60, timestamp: new Date('2025-01-02T08:00:00') }]);

      // Hour 8 should average 50
      const predicted = scaler.predict(8);
      expect(predicted).toBe(50);
    });
  });

  describe('predict', () => {
    it('should return -1 for hours with no data', () => {
      expect(scaler.predict(5)).toBe(-1);
    });

    it('should return the average CPU for a given hour', () => {
      scaler.trainFromHistory([
        { cpu: 30, timestamp: new Date('2025-01-01T12:00:00') },
        { cpu: 40, timestamp: new Date('2025-01-02T12:00:00') },
        { cpu: 50, timestamp: new Date('2025-01-03T12:00:00') },
      ]);
      expect(scaler.predict(12)).toBe(40);
    });

    it('should clamp hour to valid range (0-23)', () => {
      scaler.trainFromHistory([
        { cpu: 80, timestamp: new Date('2025-01-01T00:00:00') },
        { cpu: 90, timestamp: new Date('2025-01-01T23:00:00') },
      ]);

      // Negative hour should clamp to 0
      expect(scaler.predict(-5)).toBe(80);

      // Hour > 23 should clamp to 23
      expect(scaler.predict(30)).toBe(90);
    });

    it('should floor fractional hours', () => {
      scaler.trainFromHistory([{ cpu: 50, timestamp: new Date('2025-01-01T10:00:00') }]);
      expect(scaler.predict(10.7)).toBe(50);
    });
  });

  describe('predictRange', () => {
    it('should return predictions for the next N hours', () => {
      // Populate data for hours 10, 11, 12
      scaler.trainFromHistory([
        { cpu: 50, timestamp: new Date('2025-01-01T10:00:00') },
        { cpu: 60, timestamp: new Date('2025-01-01T11:00:00') },
        { cpu: 70, timestamp: new Date('2025-01-01T12:00:00') },
      ]);

      const predictions = scaler.predictRange(10, 3);
      expect(predictions).toHaveLength(3);
      expect(predictions[0]).toBe(50);
      expect(predictions[1]).toBe(60);
      expect(predictions[2]).toBe(70);
    });

    it('should wrap around midnight', () => {
      scaler.trainFromHistory([
        { cpu: 80, timestamp: new Date('2025-01-01T23:00:00') },
        { cpu: 20, timestamp: new Date('2025-01-01T00:00:00') },
        { cpu: 30, timestamp: new Date('2025-01-01T01:00:00') },
      ]);

      const predictions = scaler.predictRange(23, 3);
      expect(predictions).toHaveLength(3);
      expect(predictions[0]).toBe(80); // hour 23
      expect(predictions[1]).toBe(20); // hour 0
      expect(predictions[2]).toBe(30); // hour 1
    });

    it('should return -1 for hours with no data', () => {
      const predictions = scaler.predictRange(0, 5);
      expect(predictions).toHaveLength(5);
      for (const p of predictions) {
        expect(p).toBe(-1);
      }
    });

    it('should return empty array for count 0', () => {
      const predictions = scaler.predictRange(0, 0);
      expect(predictions).toHaveLength(0);
    });
  });

  describe('isTrained', () => {
    it('should return false when no data has been provided', () => {
      expect(scaler.isTrained()).toBe(false);
    });

    it('should return false with insufficient data', () => {
      // Need >= 3 observations per hour for at least 12 hours
      scaler.trainFromHistory([
        { cpu: 50, timestamp: new Date('2025-01-01T10:00:00') },
        { cpu: 60, timestamp: new Date('2025-01-01T10:30:00') },
        { cpu: 70, timestamp: new Date('2025-01-01T10:45:00') },
      ]);
      // Only 1 hour has >= 3 observations, need 12
      expect(scaler.isTrained()).toBe(false);
    });

    it('should return true when enough hours have >= 3 observations', () => {
      const metrics: { cpu: number; timestamp: Date }[] = [];
      // Create 3 observations for each of 12 hours (0-11)
      for (let hour = 0; hour < 12; hour++) {
        for (let i = 0; i < 3; i++) {
          const date = new Date(`2025-01-0${i + 1}T${String(hour).padStart(2, '0')}:00:00`);
          metrics.push({ cpu: 50 + hour, timestamp: date });
        }
      }
      scaler.trainFromHistory(metrics);
      expect(scaler.isTrained()).toBe(true);
    });

    it('should return false with 11 hours of sufficient data', () => {
      const metrics: { cpu: number; timestamp: Date }[] = [];
      for (let hour = 0; hour < 11; hour++) {
        for (let i = 0; i < 3; i++) {
          const date = new Date(`2025-01-0${i + 1}T${String(hour).padStart(2, '0')}:00:00`);
          metrics.push({ cpu: 50, timestamp: date });
        }
      }
      scaler.trainFromHistory(metrics);
      expect(scaler.isTrained()).toBe(false);
    });
  });

  describe('getPeakHour', () => {
    it('should return the hour with highest predicted CPU', () => {
      scaler.trainFromHistory([
        { cpu: 30, timestamp: new Date('2025-01-01T08:00:00') },
        { cpu: 90, timestamp: new Date('2025-01-01T14:00:00') },
        { cpu: 50, timestamp: new Date('2025-01-01T20:00:00') },
      ]);

      const peak = scaler.getPeakHour();
      expect(peak.hour).toBe(14);
      expect(peak.predictedCpu).toBe(90);
    });

    it('should return hour 0 with -1 CPU when no data exists', () => {
      const peak = scaler.getPeakHour();
      // All hours return -1, first one (hour 0) is found first with maxCpu = -1
      expect(peak.hour).toBe(0);
      expect(peak.predictedCpu).toBe(-1);
    });

    it('should handle ties by returning the earliest hour', () => {
      scaler.trainFromHistory([
        { cpu: 90, timestamp: new Date('2025-01-01T10:00:00') },
        { cpu: 90, timestamp: new Date('2025-01-01T15:00:00') },
      ]);
      const peak = scaler.getPeakHour();
      expect(peak.hour).toBe(10);
      expect(peak.predictedCpu).toBe(90);
    });
  });

  describe('reset', () => {
    it('should clear all training data', () => {
      scaler.trainFromHistory([{ cpu: 50, timestamp: new Date('2025-01-01T10:00:00') }]);
      expect(scaler.predict(10)).toBe(50);

      scaler.reset();
      expect(scaler.predict(10)).toBe(-1);
    });

    it('should allow retraining after reset', () => {
      scaler.trainFromHistory([{ cpu: 50, timestamp: new Date('2025-01-01T10:00:00') }]);
      scaler.reset();

      scaler.trainFromHistory([{ cpu: 80, timestamp: new Date('2025-01-01T10:00:00') }]);
      expect(scaler.predict(10)).toBe(80);
    });

    it('should reset isTrained to false', () => {
      const metrics: { cpu: number; timestamp: Date }[] = [];
      for (let hour = 0; hour < 12; hour++) {
        for (let i = 0; i < 3; i++) {
          const date = new Date(`2025-01-0${i + 1}T${String(hour).padStart(2, '0')}:00:00`);
          metrics.push({ cpu: 50, timestamp: date });
        }
      }
      scaler.trainFromHistory(metrics);
      expect(scaler.isTrained()).toBe(true);

      scaler.reset();
      expect(scaler.isTrained()).toBe(false);
    });
  });
});
