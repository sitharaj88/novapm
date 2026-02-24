import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { NOVA_DB_FILE } from '@novapm/shared';
import { runMigrations } from './migrations/index.js';

let instance: BetterSqlite3.Database | null = null;

export function getDatabase(dbPath: string = NOVA_DB_FILE): BetterSqlite3.Database {
  if (instance) return instance;

  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new BetterSqlite3(dbPath);

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  instance = db;
  return db;
}

export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
