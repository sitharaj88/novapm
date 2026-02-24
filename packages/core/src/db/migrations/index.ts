import type BetterSqlite3 from 'better-sqlite3';
import { up as migration001 } from './001_initial.js';

interface Migration {
  version: number;
  name: string;
  up: (db: BetterSqlite3.Database) => void;
}

const migrations: Migration[] = [{ version: 1, name: '001_initial', up: migration001 }];

export function runMigrations(db: BetterSqlite3.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  const getCurrentVersion = db.prepare('SELECT MAX(version) as version FROM _migrations');
  const insertMigration = db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)');

  const row = getCurrentVersion.get() as { version: number | null } | undefined;
  const currentVersion = row?.version ?? 0;

  const pendingMigrations = migrations.filter((m) => m.version > currentVersion);

  if (pendingMigrations.length === 0) return;

  const runAll = db.transaction(() => {
    for (const migration of pendingMigrations) {
      migration.up(db);
      insertMigration.run(migration.version, migration.name);
    }
  });

  runAll();
}
