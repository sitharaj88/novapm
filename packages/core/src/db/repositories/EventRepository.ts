import type BetterSqlite3 from 'better-sqlite3';
import type { ProcessEventType } from '@novapm/shared';

export interface EventRow {
  id: number;
  process_id: number;
  process_name: string;
  type: string;
  data: string | null;
  timestamp: number;
}

export class EventRepository {
  private db: BetterSqlite3.Database;
  private insertStmt: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
    this.insertStmt = db.prepare(
      'INSERT INTO events (process_id, process_name, type, data) VALUES (?, ?, ?, ?)',
    );
  }

  insert(
    processId: number,
    processName: string,
    type: ProcessEventType,
    data?: Record<string, unknown>,
  ): void {
    this.insertStmt.run(processId, processName, type, data ? JSON.stringify(data) : null);
  }

  getByProcess(processId: number, limit: number = 100): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE process_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(processId, limit) as EventRow[];
  }

  getByType(type: ProcessEventType, limit: number = 100): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE type = ? ORDER BY timestamp DESC LIMIT ?')
      .all(type, limit) as EventRow[];
  }

  getRecent(limit: number = 100): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as EventRow[];
  }

  getRange(startTime: number, endTime: number): EventRow[] {
    return this.db
      .prepare('SELECT * FROM events WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp')
      .all(startTime, endTime) as EventRow[];
  }

  cleanup(olderThanDays: number = 30): void {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
    this.db.prepare('DELETE FROM events WHERE timestamp < ?').run(cutoff);
  }

  deleteByProcess(processId: number): void {
    this.db.prepare('DELETE FROM events WHERE process_id = ?').run(processId);
  }
}
