import type BetterSqlite3 from 'better-sqlite3';
import type { ProcessMetrics } from '@novapm/shared';

export interface MetricRow {
  id: number;
  process_id: number;
  cpu: number;
  memory: number;
  heap_used: number;
  heap_total: number;
  event_loop_latency: number;
  active_handles: number;
  active_requests: number;
  timestamp: number;
}

export class MetricsRepository {
  private db: BetterSqlite3.Database;
  private insertStmt: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO metrics (
        process_id, cpu, memory, heap_used, heap_total,
        event_loop_latency, active_handles, active_requests, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  insert(metrics: ProcessMetrics): void {
    this.insertStmt.run(
      metrics.processId,
      metrics.cpu,
      metrics.memory,
      metrics.heapUsed,
      metrics.heapTotal,
      metrics.eventLoopLatency,
      metrics.activeHandles,
      metrics.activeRequests,
      Math.floor(metrics.timestamp.getTime() / 1000),
    );
  }

  insertBatch(metricsList: ProcessMetrics[]): void {
    const insertMany = this.db.transaction((items: ProcessMetrics[]) => {
      for (const metrics of items) {
        this.insert(metrics);
      }
    });
    insertMany(metricsList);
  }

  getLatest(processId: number): MetricRow | undefined {
    return this.db
      .prepare('SELECT * FROM metrics WHERE process_id = ? ORDER BY timestamp DESC LIMIT 1')
      .get(processId) as MetricRow | undefined;
  }

  getRange(processId: number, startTime: number, endTime: number): MetricRow[] {
    return this.db
      .prepare(
        'SELECT * FROM metrics WHERE process_id = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp',
      )
      .all(processId, startTime, endTime) as MetricRow[];
  }

  /**
   * Downsample old metrics to reduce storage:
   * - Keep 5s resolution for last hour
   * - Downsample to 1m resolution for last day
   * - Downsample to 5m resolution for last week
   * - Downsample to 1h resolution for last month
   * - Delete data older than 1 month
   */
  downsample(): void {
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;
    const oneDayAgo = now - 86400;
    const oneWeekAgo = now - 604800;
    const oneMonthAgo = now - 2592000;

    // Delete data older than 1 month
    this.db.prepare('DELETE FROM metrics WHERE timestamp < ?').run(oneMonthAgo);

    // Downsample older than 1 week to 1h resolution
    this.downsampleRange(oneMonthAgo, oneWeekAgo, 3600);

    // Downsample older than 1 day to 5m resolution
    this.downsampleRange(oneWeekAgo, oneDayAgo, 300);

    // Downsample older than 1 hour to 1m resolution
    this.downsampleRange(oneDayAgo, oneHourAgo, 60);
  }

  private downsampleRange(startTime: number, endTime: number, intervalSec: number): void {
    // Keep one row per interval per process by deleting duplicates within each bucket
    this.db
      .prepare(
        `
        DELETE FROM metrics WHERE id NOT IN (
          SELECT MIN(id) FROM metrics
          WHERE timestamp BETWEEN ? AND ?
          GROUP BY process_id, timestamp / ?
        ) AND timestamp BETWEEN ? AND ?
      `,
      )
      .run(startTime, endTime, intervalSec, startTime, endTime);
  }

  cleanup(processId: number): void {
    this.db.prepare('DELETE FROM metrics WHERE process_id = ?').run(processId);
  }
}
