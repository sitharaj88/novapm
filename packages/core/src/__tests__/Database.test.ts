import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { AppConfig, ProcessMetrics, ProcessEventType } from '@novapm/shared';
import { runMigrations } from '../db/migrations/index.js';
import { ProcessRepository } from '../db/repositories/ProcessRepository.js';
import { MetricsRepository } from '../db/repositories/MetricsRepository.js';
import { EventRepository } from '../db/repositories/EventRepository.js';

describe('Database', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('migrations', () => {
    it('should create the processes table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='processes'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('should create the metrics table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metrics'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('should create the events table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('should create the config table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='config'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('should create the _migrations tracking table', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it('should record the migration version', () => {
      const migration = db.prepare('SELECT * FROM _migrations WHERE version = 1').get() as {
        version: number;
        name: string;
      };
      expect(migration).toBeDefined();
      expect(migration.name).toBe('001_initial');
    });

    it('should create the metrics index', () => {
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_metrics_process_time'",
        )
        .all();
      expect(indexes).toHaveLength(1);
    });

    it('should create the events index', () => {
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_events_process_time'",
        )
        .all();
      expect(indexes).toHaveLength(1);
    });

    it('should be idempotent when run multiple times', () => {
      // Running migrations again should not throw
      runMigrations(db);
      runMigrations(db);

      const migrations = db.prepare('SELECT * FROM _migrations').all();
      expect(migrations).toHaveLength(1); // Still just one migration
    });
  });

  describe('ProcessRepository', () => {
    let repo: ProcessRepository;

    const testConfig: AppConfig = {
      name: 'test-app',
      script: 'index.js',
      cwd: '/app',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'test' },
    };

    beforeEach(() => {
      repo = new ProcessRepository(db);
    });

    describe('create', () => {
      it('should create a process and return the row', () => {
        const row = repo.create('test-app', testConfig);

        expect(row).toBeDefined();
        expect(row.id).toBe(1);
        expect(row.name).toBe('test-app');
        expect(row.status).toBe('stopped');
        expect(row.pid).toBeNull();
        expect(row.restarts).toBe(0);
        expect(row.created_at).toBeGreaterThan(0);
        expect(row.updated_at).toBeGreaterThan(0);
      });

      it('should store config as JSON string', () => {
        const row = repo.create('test-app', testConfig);
        const parsed = JSON.parse(row.config);

        expect(parsed.name).toBe('test-app');
        expect(parsed.script).toBe('index.js');
        expect(parsed.env).toEqual({ NODE_ENV: 'test' });
      });

      it('should enforce unique name constraint', () => {
        repo.create('test-app', testConfig);

        expect(() => repo.create('test-app', testConfig)).toThrow();
      });

      it('should auto-increment IDs', () => {
        const row1 = repo.create('app-1', testConfig);
        const row2 = repo.create('app-2', { ...testConfig, name: 'app-2' });

        expect(row1.id).toBe(1);
        expect(row2.id).toBe(2);
      });
    });

    describe('findAll', () => {
      it('should return empty array when no processes exist', () => {
        const rows = repo.findAll();

        expect(rows).toEqual([]);
      });

      it('should return all processes ordered by id', () => {
        repo.create('app-1', { ...testConfig, name: 'app-1' });
        repo.create('app-2', { ...testConfig, name: 'app-2' });
        repo.create('app-3', { ...testConfig, name: 'app-3' });

        const rows = repo.findAll();

        expect(rows).toHaveLength(3);
        expect(rows[0].name).toBe('app-1');
        expect(rows[1].name).toBe('app-2');
        expect(rows[2].name).toBe('app-3');
      });
    });

    describe('findById', () => {
      it('should find a process by id', () => {
        const created = repo.create('test-app', testConfig);
        const found = repo.findById(created.id);

        expect(found).toBeDefined();
        expect(found!.name).toBe('test-app');
      });

      it('should return undefined for non-existent id', () => {
        const found = repo.findById(999);

        expect(found).toBeUndefined();
      });
    });

    describe('findByName', () => {
      it('should find a process by name', () => {
        repo.create('test-app', testConfig);
        const found = repo.findByName('test-app');

        expect(found).toBeDefined();
        expect(found!.name).toBe('test-app');
      });

      it('should return undefined for non-existent name', () => {
        const found = repo.findByName('non-existent');

        expect(found).toBeUndefined();
      });
    });

    describe('updateStatus', () => {
      it('should update process status and pid', () => {
        const created = repo.create('test-app', testConfig);
        repo.updateStatus(created.id, 'online', 1234);

        const updated = repo.findById(created.id);
        expect(updated!.status).toBe('online');
        expect(updated!.pid).toBe(1234);
      });

      it('should set pid to null when not provided', () => {
        const created = repo.create('test-app', testConfig);
        repo.updateStatus(created.id, 'online', 1234);
        repo.updateStatus(created.id, 'stopped');

        const updated = repo.findById(created.id);
        expect(updated!.status).toBe('stopped');
        expect(updated!.pid).toBeNull();
      });

      it('should update the updated_at timestamp', () => {
        const created = repo.create('test-app', testConfig);
        const originalUpdatedAt = created.updated_at;

        // Small delay to ensure timestamp changes
        repo.updateStatus(created.id, 'online', 1234);
        const updated = repo.findById(created.id);

        expect(updated!.updated_at).toBeGreaterThanOrEqual(originalUpdatedAt);
      });
    });

    describe('updateStarted', () => {
      it('should set status to online and update pid and started_at', () => {
        const created = repo.create('test-app', testConfig);
        repo.updateStarted(created.id, 5678);

        const updated = repo.findById(created.id);
        expect(updated!.status).toBe('online');
        expect(updated!.pid).toBe(5678);
        expect(updated!.started_at).toBeGreaterThan(0);
      });
    });

    describe('incrementRestarts', () => {
      it('should increment restart count', () => {
        const created = repo.create('test-app', testConfig);
        expect(created.restarts).toBe(0);

        repo.incrementRestarts(created.id);
        const after1 = repo.findById(created.id);
        expect(after1!.restarts).toBe(1);

        repo.incrementRestarts(created.id);
        const after2 = repo.findById(created.id);
        expect(after2!.restarts).toBe(2);
      });
    });

    describe('resetRestarts', () => {
      it('should reset restart count to zero', () => {
        const created = repo.create('test-app', testConfig);
        repo.incrementRestarts(created.id);
        repo.incrementRestarts(created.id);
        repo.incrementRestarts(created.id);

        repo.resetRestarts(created.id);
        const updated = repo.findById(created.id);
        expect(updated!.restarts).toBe(0);
      });
    });

    describe('updateConfig', () => {
      it('should update the config JSON', () => {
        const created = repo.create('test-app', testConfig);
        const newConfig: AppConfig = {
          ...testConfig,
          instances: 4,
          env: { NODE_ENV: 'production' },
        };

        repo.updateConfig(created.id, newConfig);
        const updated = repo.findById(created.id);
        const parsed = JSON.parse(updated!.config);
        expect(parsed.instances).toBe(4);
        expect(parsed.env.NODE_ENV).toBe('production');
      });
    });

    describe('delete', () => {
      it('should delete a process by id', () => {
        const created = repo.create('test-app', testConfig);
        repo.delete(created.id);

        const found = repo.findById(created.id);
        expect(found).toBeUndefined();
      });

      it('should not throw when deleting non-existent process', () => {
        expect(() => repo.delete(999)).not.toThrow();
      });
    });

    describe('deleteAll', () => {
      it('should delete all processes', () => {
        repo.create('app-1', { ...testConfig, name: 'app-1' });
        repo.create('app-2', { ...testConfig, name: 'app-2' });
        repo.create('app-3', { ...testConfig, name: 'app-3' });

        repo.deleteAll();
        const rows = repo.findAll();
        expect(rows).toHaveLength(0);
      });

      it('should not throw when there are no processes', () => {
        expect(() => repo.deleteAll()).not.toThrow();
      });
    });

    describe('parseConfig', () => {
      it('should parse config JSON from a row', () => {
        const row = repo.create('test-app', testConfig);
        const parsed = repo.parseConfig(row);

        expect(parsed.name).toBe('test-app');
        expect(parsed.script).toBe('index.js');
        expect(parsed.cwd).toBe('/app');
        expect(parsed.env).toEqual({ NODE_ENV: 'test' });
      });
    });
  });

  describe('MetricsRepository', () => {
    let metricsRepo: MetricsRepository;
    let processRepo: ProcessRepository;
    let processId: number;

    beforeEach(() => {
      processRepo = new ProcessRepository(db);
      metricsRepo = new MetricsRepository(db);

      // Create a process for foreign key reference
      const proc = processRepo.create('test-app', {
        name: 'test-app',
        script: 'index.js',
      });
      processId = proc.id;
    });

    function createTestMetrics(overrides: Partial<ProcessMetrics> = {}): ProcessMetrics {
      return {
        processId,
        cpu: 25.5,
        memory: 104857600,
        heapUsed: 52428800,
        heapTotal: 67108864,
        eventLoopLatency: 1.5,
        activeHandles: 10,
        activeRequests: 2,
        uptime: 3600,
        timestamp: new Date('2025-01-15T12:00:00Z'),
        ...overrides,
      };
    }

    describe('insert', () => {
      it('should insert metrics for a process', () => {
        const metrics = createTestMetrics();
        metricsRepo.insert(metrics);

        const latest = metricsRepo.getLatest(processId);
        expect(latest).toBeDefined();
        expect(latest!.process_id).toBe(processId);
        expect(latest!.cpu).toBeCloseTo(25.5);
        expect(latest!.memory).toBe(104857600);
        expect(latest!.heap_used).toBe(52428800);
        expect(latest!.heap_total).toBe(67108864);
        expect(latest!.event_loop_latency).toBeCloseTo(1.5);
        expect(latest!.active_handles).toBe(10);
        expect(latest!.active_requests).toBe(2);
      });

      it('should store timestamp as unix epoch seconds', () => {
        const timestamp = new Date('2025-06-15T12:00:00Z');
        const metrics = createTestMetrics({ timestamp });
        metricsRepo.insert(metrics);

        const latest = metricsRepo.getLatest(processId);
        expect(latest!.timestamp).toBe(Math.floor(timestamp.getTime() / 1000));
      });
    });

    describe('insertBatch', () => {
      it('should insert multiple metrics in a transaction', () => {
        const metrics1 = createTestMetrics({
          cpu: 10,
          timestamp: new Date('2025-01-15T12:00:00Z'),
        });
        const metrics2 = createTestMetrics({
          cpu: 20,
          timestamp: new Date('2025-01-15T12:01:00Z'),
        });
        const metrics3 = createTestMetrics({
          cpu: 30,
          timestamp: new Date('2025-01-15T12:02:00Z'),
        });

        metricsRepo.insertBatch([metrics1, metrics2, metrics3]);

        const startTime = Math.floor(new Date('2025-01-15T11:59:00Z').getTime() / 1000);
        const endTime = Math.floor(new Date('2025-01-15T12:03:00Z').getTime() / 1000);
        const range = metricsRepo.getRange(processId, startTime, endTime);

        expect(range).toHaveLength(3);
      });

      it('should handle empty batch', () => {
        expect(() => metricsRepo.insertBatch([])).not.toThrow();
      });
    });

    describe('getLatest', () => {
      it('should return the most recent metric for a process', () => {
        const metrics1 = createTestMetrics({
          cpu: 10,
          timestamp: new Date('2025-01-15T12:00:00Z'),
        });
        const metrics2 = createTestMetrics({
          cpu: 50,
          timestamp: new Date('2025-01-15T12:05:00Z'),
        });

        metricsRepo.insert(metrics1);
        metricsRepo.insert(metrics2);

        const latest = metricsRepo.getLatest(processId);
        expect(latest).toBeDefined();
        expect(latest!.cpu).toBeCloseTo(50);
      });

      it('should return undefined when no metrics exist', () => {
        const latest = metricsRepo.getLatest(processId);
        expect(latest).toBeUndefined();
      });

      it('should return undefined for non-existent process', () => {
        const latest = metricsRepo.getLatest(999);
        expect(latest).toBeUndefined();
      });
    });

    describe('getRange', () => {
      it('should return metrics within the specified time range', () => {
        const baseTime = new Date('2025-01-15T12:00:00Z');
        for (let i = 0; i < 10; i++) {
          const timestamp = new Date(baseTime.getTime() + i * 60000); // Each minute
          metricsRepo.insert(createTestMetrics({ cpu: i * 10, timestamp }));
        }

        const startTime = Math.floor(new Date('2025-01-15T12:02:00Z').getTime() / 1000);
        const endTime = Math.floor(new Date('2025-01-15T12:05:00Z').getTime() / 1000);
        const range = metricsRepo.getRange(processId, startTime, endTime);

        expect(range).toHaveLength(4); // minutes 2, 3, 4, 5
        expect(range[0].cpu).toBeCloseTo(20);
        expect(range[range.length - 1].cpu).toBeCloseTo(50);
      });

      it('should return empty array when no metrics in range', () => {
        metricsRepo.insert(createTestMetrics());

        const range = metricsRepo.getRange(processId, 0, 100);
        expect(range).toHaveLength(0);
      });

      it('should return results ordered by timestamp', () => {
        const times = [
          new Date('2025-01-15T12:05:00Z'),
          new Date('2025-01-15T12:01:00Z'),
          new Date('2025-01-15T12:03:00Z'),
        ];

        for (const timestamp of times) {
          metricsRepo.insert(createTestMetrics({ timestamp }));
        }

        const startTime = Math.floor(new Date('2025-01-15T12:00:00Z').getTime() / 1000);
        const endTime = Math.floor(new Date('2025-01-15T12:10:00Z').getTime() / 1000);
        const range = metricsRepo.getRange(processId, startTime, endTime);

        for (let i = 1; i < range.length; i++) {
          expect(range[i].timestamp).toBeGreaterThanOrEqual(range[i - 1].timestamp);
        }
      });
    });

    describe('cleanup', () => {
      it('should delete all metrics for a specific process', () => {
        metricsRepo.insert(createTestMetrics());
        metricsRepo.insert(createTestMetrics({ timestamp: new Date('2025-01-15T12:01:00Z') }));

        metricsRepo.cleanup(processId);

        const latest = metricsRepo.getLatest(processId);
        expect(latest).toBeUndefined();
      });

      it('should not affect metrics for other processes', () => {
        const proc2 = processRepo.create('app-2', { name: 'app-2', script: 'app2.js' });
        metricsRepo.insert(createTestMetrics());
        metricsRepo.insert(createTestMetrics({ processId: proc2.id }));

        metricsRepo.cleanup(processId);

        const latest = metricsRepo.getLatest(proc2.id);
        expect(latest).toBeDefined();
      });
    });

    describe('downsample', () => {
      it('should not throw when called on empty data', () => {
        expect(() => metricsRepo.downsample()).not.toThrow();
      });

      it('should delete data older than one month', () => {
        const twoMonthsAgo = new Date(Date.now() - 2 * 30 * 24 * 60 * 60 * 1000);
        metricsRepo.insert(createTestMetrics({ timestamp: twoMonthsAgo }));

        metricsRepo.downsample();

        const startTime = 0;
        const endTime = Math.floor(Date.now() / 1000);
        const range = metricsRepo.getRange(processId, startTime, endTime);
        expect(range).toHaveLength(0);
      });
    });
  });

  describe('EventRepository', () => {
    let eventRepo: EventRepository;
    let processRepo: ProcessRepository;
    let processId: number;

    beforeEach(() => {
      processRepo = new ProcessRepository(db);
      eventRepo = new EventRepository(db);

      const proc = processRepo.create('test-app', {
        name: 'test-app',
        script: 'index.js',
      });
      processId = proc.id;
    });

    describe('insert', () => {
      it('should insert an event', () => {
        eventRepo.insert(processId, 'test-app', 'start');

        const events = eventRepo.getByProcess(processId);
        expect(events).toHaveLength(1);
        expect(events[0].process_id).toBe(processId);
        expect(events[0].process_name).toBe('test-app');
        expect(events[0].type).toBe('start');
      });

      it('should store optional data as JSON', () => {
        eventRepo.insert(processId, 'test-app', 'error', {
          message: 'Out of memory',
          exitCode: 137,
        });

        const events = eventRepo.getByProcess(processId);
        expect(events).toHaveLength(1);
        expect(events[0].data).toBeDefined();
        const parsed = JSON.parse(events[0].data!);
        expect(parsed.message).toBe('Out of memory');
        expect(parsed.exitCode).toBe(137);
      });

      it('should store null data when not provided', () => {
        eventRepo.insert(processId, 'test-app', 'start');

        const events = eventRepo.getByProcess(processId);
        expect(events[0].data).toBeNull();
      });

      it('should support all event types', () => {
        const types: ProcessEventType[] = [
          'start',
          'stop',
          'restart',
          'error',
          'exit',
          'crash',
          'online',
          'log',
          'metric',
          'health-check-fail',
          'health-check-restore',
          'scaling',
        ];

        for (const type of types) {
          eventRepo.insert(processId, 'test-app', type);
        }

        const events = eventRepo.getByProcess(processId, 100);
        expect(events).toHaveLength(types.length);
      });
    });

    describe('getByProcess', () => {
      it('should return events ordered by timestamp descending', () => {
        eventRepo.insert(processId, 'test-app', 'start');
        eventRepo.insert(processId, 'test-app', 'online');
        eventRepo.insert(processId, 'test-app', 'stop');

        const events = eventRepo.getByProcess(processId);

        expect(events).toHaveLength(3);
        // Most recent first
        for (let i = 1; i < events.length; i++) {
          expect(events[i - 1].timestamp).toBeGreaterThanOrEqual(events[i].timestamp);
        }
      });

      it('should respect the limit parameter', () => {
        for (let i = 0; i < 10; i++) {
          eventRepo.insert(processId, 'test-app', 'start');
        }

        const events = eventRepo.getByProcess(processId, 5);
        expect(events).toHaveLength(5);
      });

      it('should return empty array for non-existent process', () => {
        const events = eventRepo.getByProcess(999);
        expect(events).toHaveLength(0);
      });

      it('should default limit to 100', () => {
        for (let i = 0; i < 120; i++) {
          eventRepo.insert(processId, 'test-app', 'start');
        }

        const events = eventRepo.getByProcess(processId);
        expect(events).toHaveLength(100);
      });
    });

    describe('getByType', () => {
      it('should return events of a specific type', () => {
        eventRepo.insert(processId, 'test-app', 'start');
        eventRepo.insert(processId, 'test-app', 'error');
        eventRepo.insert(processId, 'test-app', 'start');
        eventRepo.insert(processId, 'test-app', 'stop');

        const startEvents = eventRepo.getByType('start');
        expect(startEvents).toHaveLength(2);
        for (const event of startEvents) {
          expect(event.type).toBe('start');
        }
      });

      it('should return empty array for type with no events', () => {
        eventRepo.insert(processId, 'test-app', 'start');

        const crashEvents = eventRepo.getByType('crash');
        expect(crashEvents).toHaveLength(0);
      });

      it('should respect the limit parameter', () => {
        for (let i = 0; i < 10; i++) {
          eventRepo.insert(processId, 'test-app', 'error');
        }

        const events = eventRepo.getByType('error', 3);
        expect(events).toHaveLength(3);
      });
    });

    describe('getRecent', () => {
      it('should return all recent events across processes', () => {
        const proc2 = processRepo.create('app-2', { name: 'app-2', script: 'app2.js' });

        eventRepo.insert(processId, 'test-app', 'start');
        eventRepo.insert(proc2.id, 'app-2', 'start');
        eventRepo.insert(processId, 'test-app', 'error');

        const recent = eventRepo.getRecent();
        expect(recent).toHaveLength(3);
      });

      it('should respect the limit parameter', () => {
        for (let i = 0; i < 10; i++) {
          eventRepo.insert(processId, 'test-app', 'start');
        }

        const recent = eventRepo.getRecent(3);
        expect(recent).toHaveLength(3);
      });

      it('should return events ordered by timestamp descending', () => {
        eventRepo.insert(processId, 'test-app', 'start');
        eventRepo.insert(processId, 'test-app', 'online');
        eventRepo.insert(processId, 'test-app', 'error');

        const recent = eventRepo.getRecent();
        for (let i = 1; i < recent.length; i++) {
          expect(recent[i - 1].timestamp).toBeGreaterThanOrEqual(recent[i].timestamp);
        }
      });
    });

    describe('getRange', () => {
      it('should return events within a time range', () => {
        eventRepo.insert(processId, 'test-app', 'start');
        eventRepo.insert(processId, 'test-app', 'online');

        const now = Math.floor(Date.now() / 1000);
        const events = eventRepo.getRange(now - 60, now + 60);
        expect(events.length).toBeGreaterThanOrEqual(2);
      });

      it('should return empty array when no events in range', () => {
        eventRepo.insert(processId, 'test-app', 'start');

        const events = eventRepo.getRange(0, 100);
        expect(events).toHaveLength(0);
      });

      it('should return events ordered by timestamp ascending', () => {
        eventRepo.insert(processId, 'test-app', 'start');
        eventRepo.insert(processId, 'test-app', 'online');
        eventRepo.insert(processId, 'test-app', 'stop');

        const now = Math.floor(Date.now() / 1000);
        const events = eventRepo.getRange(now - 60, now + 60);
        for (let i = 1; i < events.length; i++) {
          expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
        }
      });
    });

    describe('cleanup', () => {
      it('should delete events older than the specified number of days', () => {
        eventRepo.insert(processId, 'test-app', 'start');

        // Manually insert an old event for testing
        db.prepare(
          'INSERT INTO events (process_id, process_name, type, timestamp) VALUES (?, ?, ?, ?)',
        ).run(processId, 'test-app', 'start', Math.floor(Date.now() / 1000) - 40 * 86400);

        eventRepo.cleanup(30);

        const events = eventRepo.getRecent();
        // The recent event should remain, the old one should be deleted
        expect(events).toHaveLength(1);
      });

      it('should use default 30 days when no argument provided', () => {
        // Insert a very old event
        db.prepare(
          'INSERT INTO events (process_id, process_name, type, timestamp) VALUES (?, ?, ?, ?)',
        ).run(processId, 'test-app', 'start', Math.floor(Date.now() / 1000) - 31 * 86400);

        eventRepo.cleanup();

        const events = eventRepo.getRecent();
        expect(events).toHaveLength(0);
      });
    });

    describe('deleteByProcess', () => {
      it('should delete all events for a specific process', () => {
        const proc2 = processRepo.create('app-2', { name: 'app-2', script: 'app2.js' });

        eventRepo.insert(processId, 'test-app', 'start');
        eventRepo.insert(processId, 'test-app', 'online');
        eventRepo.insert(proc2.id, 'app-2', 'start');

        eventRepo.deleteByProcess(processId);

        const testAppEvents = eventRepo.getByProcess(processId);
        expect(testAppEvents).toHaveLength(0);

        const app2Events = eventRepo.getByProcess(proc2.id);
        expect(app2Events).toHaveLength(1);
      });
    });
  });

  describe('foreign key constraints', () => {
    it('should cascade delete metrics when process is deleted', () => {
      const processRepo = new ProcessRepository(db);
      const metricsRepo = new MetricsRepository(db);

      const proc = processRepo.create('test-app', { name: 'test-app', script: 'index.js' });
      metricsRepo.insert({
        processId: proc.id,
        cpu: 10,
        memory: 1000,
        heapUsed: 500,
        heapTotal: 1000,
        eventLoopLatency: 1,
        activeHandles: 5,
        activeRequests: 1,
        uptime: 100,
        timestamp: new Date(),
      });

      expect(metricsRepo.getLatest(proc.id)).toBeDefined();

      processRepo.delete(proc.id);

      expect(metricsRepo.getLatest(proc.id)).toBeUndefined();
    });

    it('should cascade delete events when process is deleted', () => {
      const processRepo = new ProcessRepository(db);
      const eventRepo = new EventRepository(db);

      const proc = processRepo.create('test-app', { name: 'test-app', script: 'index.js' });
      eventRepo.insert(proc.id, 'test-app', 'start');
      eventRepo.insert(proc.id, 'test-app', 'online');

      expect(eventRepo.getByProcess(proc.id)).toHaveLength(2);

      processRepo.delete(proc.id);

      expect(eventRepo.getByProcess(proc.id)).toHaveLength(0);
    });
  });
});
