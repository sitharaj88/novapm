import type BetterSqlite3 from 'better-sqlite3';

export function up(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'stopped',
      pid INTEGER,
      started_at INTEGER,
      restarts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_id INTEGER NOT NULL,
      cpu REAL,
      memory INTEGER,
      heap_used INTEGER,
      heap_total INTEGER,
      event_loop_latency REAL,
      active_handles INTEGER,
      active_requests INTEGER,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_process_time
      ON metrics(process_id, timestamp);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_id INTEGER NOT NULL,
      process_name TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_process_time
      ON events(process_id, timestamp);

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}
