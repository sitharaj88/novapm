import type BetterSqlite3 from 'better-sqlite3';
import type { AppConfig, ProcessStatus } from '@novapm/shared';

export interface ProcessRow {
  id: number;
  name: string;
  config: string;
  status: string;
  pid: number | null;
  started_at: number | null;
  restarts: number;
  created_at: number;
  updated_at: number;
}

export class ProcessRepository {
  private db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  findAll(): ProcessRow[] {
    return this.db.prepare('SELECT * FROM processes ORDER BY id').all() as ProcessRow[];
  }

  findById(id: number): ProcessRow | undefined {
    return this.db.prepare('SELECT * FROM processes WHERE id = ?').get(id) as
      | ProcessRow
      | undefined;
  }

  findByName(name: string): ProcessRow | undefined {
    return this.db.prepare('SELECT * FROM processes WHERE name = ?').get(name) as
      | ProcessRow
      | undefined;
  }

  create(name: string, config: AppConfig): ProcessRow {
    const stmt = this.db.prepare('INSERT INTO processes (name, config) VALUES (?, ?) RETURNING *');
    return stmt.get(name, JSON.stringify(config)) as ProcessRow;
  }

  updateStatus(id: number, status: ProcessStatus, pid: number | null = null): void {
    this.db
      .prepare('UPDATE processes SET status = ?, pid = ?, updated_at = unixepoch() WHERE id = ?')
      .run(status, pid, id);
  }

  updateStarted(id: number, pid: number): void {
    this.db
      .prepare(
        'UPDATE processes SET status = ?, pid = ?, started_at = unixepoch(), updated_at = unixepoch() WHERE id = ?',
      )
      .run('online', pid, id);
  }

  incrementRestarts(id: number): void {
    this.db
      .prepare(
        'UPDATE processes SET restarts = restarts + 1, updated_at = unixepoch() WHERE id = ?',
      )
      .run(id);
  }

  resetRestarts(id: number): void {
    this.db
      .prepare('UPDATE processes SET restarts = 0, updated_at = unixepoch() WHERE id = ?')
      .run(id);
  }

  updateConfig(id: number, config: AppConfig): void {
    this.db
      .prepare('UPDATE processes SET config = ?, updated_at = unixepoch() WHERE id = ?')
      .run(JSON.stringify(config), id);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM processes WHERE id = ?').run(id);
  }

  deleteAll(): void {
    this.db.prepare('DELETE FROM processes').run();
  }

  parseConfig(row: ProcessRow): AppConfig {
    return JSON.parse(row.config) as AppConfig;
  }
}
