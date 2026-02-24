import { mean } from 'simple-statistics';

/**
 * Tracks historical usage patterns to predict future load.
 * Uses a 24-hour cycle where each hour has an average CPU usage.
 */
export class PredictiveScaler {
  /**
   * Hourly CPU averages: index 0 = midnight, index 23 = 11pm.
   * Each entry is a list of observed values for that hour.
   */
  private readonly hourlyData: number[][] = Array.from({ length: 24 }, () => []);

  /**
   * Train the model from historical metrics data.
   * Buckets each metric by the hour it occurred.
   */
  trainFromHistory(metrics: { cpu: number; timestamp: Date }[]): void {
    for (const metric of metrics) {
      const hour = metric.timestamp.getHours();
      this.hourlyData[hour].push(metric.cpu);
    }
  }

  /**
   * Predict CPU usage for a given hour of the day (0-23).
   * Returns the average CPU usage observed for that hour.
   * If no data exists for that hour, returns -1.
   */
  predict(hour: number): number {
    const clampedHour = Math.max(0, Math.min(23, Math.floor(hour)));
    const data = this.hourlyData[clampedHour];

    if (data.length === 0) {
      return -1;
    }

    return mean(data);
  }

  /**
   * Predict the next N hours starting from the given hour.
   * Returns an array of predicted CPU values.
   */
  predictRange(startHour: number, count: number): number[] {
    const predictions: number[] = [];
    for (let i = 0; i < count; i++) {
      const hour = (startHour + i) % 24;
      predictions.push(this.predict(hour));
    }
    return predictions;
  }

  /**
   * Check if we have enough data for reliable predictions.
   * Requires at least 3 observations per hour to be considered trained.
   */
  isTrained(): boolean {
    const hoursWithData = this.hourlyData.filter((d) => d.length >= 3).length;
    // Require data for at least 50% of hours
    return hoursWithData >= 12;
  }

  /**
   * Get the peak hour (hour with highest predicted CPU).
   */
  getPeakHour(): { hour: number; predictedCpu: number } {
    let maxCpu = -1;
    let peakHour = 0;

    for (let hour = 0; hour < 24; hour++) {
      const predicted = this.predict(hour);
      if (predicted > maxCpu) {
        maxCpu = predicted;
        peakHour = hour;
      }
    }

    return { hour: peakHour, predictedCpu: maxCpu };
  }

  /**
   * Reset all training data.
   */
  reset(): void {
    for (let i = 0; i < 24; i++) {
      this.hourlyData[i] = [];
    }
  }
}
