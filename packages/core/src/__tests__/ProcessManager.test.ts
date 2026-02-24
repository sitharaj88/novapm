import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { AppConfig } from '@novapm/shared';
import { ProcessAlreadyExistsError, ProcessNotFoundError } from '@novapm/shared';
import type { ProcessRepository } from '../db/repositories/ProcessRepository.js';
import type { ProcessRow } from '../db/repositories/ProcessRepository.js';
import type { EventRepository } from '../db/repositories/EventRepository.js';

// Create a mock child process factory
function createMockChildProcess(pid: number = 12345): ChildProcess {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter() as Readable;
  const stderr = new EventEmitter() as Readable;

  const child = Object.assign(emitter, {
    pid,
    stdin: null,
    stdout,
    stderr,
    stdio: [null, stdout, stderr, null, null] as ChildProcess['stdio'],
    connected: false,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    killed: false,
    channel: undefined,
    kill: vi.fn().mockReturnValue(true),
    send: vi.fn(),
    disconnect: vi.fn(),
    unref: vi.fn(),
    ref: vi.fn(),
    [Symbol.dispose]: vi.fn(),
    serialization: 'json' as const,
  }) as unknown as ChildProcess;

  return child;
}

// Mock child_process module
const mockFork = vi.fn();
const mockSpawn = vi.fn();

vi.mock('node:child_process', () => ({
  fork: (...args: unknown[]) => mockFork(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock GracefulShutdown
const mockGracefulShutdown = vi.fn().mockResolvedValue(0);

vi.mock('../process/GracefulShutdown.js', () => ({
  gracefulShutdown: (...args: unknown[]) => mockGracefulShutdown(...args),
}));

import { ProcessManager } from '../process/ProcessManager.js';
import { EventBus } from '../events/EventBus.js';

// Mock nanoid for EventBus
vi.mock('nanoid', () => ({
  nanoid: () => 'mock-id',
}));

describe('ProcessManager', () => {
  let processManager: ProcessManager;
  let eventBus: EventBus;
  let mockProcessRepo: ProcessRepository;
  let mockEventRepo: EventRepository;
  let mockChild: ChildProcess;
  let nextPid: number;

  const baseConfig: AppConfig = {
    name: 'test-app',
    script: 'app.js',
    cwd: '/tmp/test-project',
  };

  function createMockProcessRepo(): ProcessRepository {
    let idCounter = 0;
    return {
      findAll: vi.fn().mockReturnValue([]),
      findById: vi.fn(),
      findByName: vi.fn().mockReturnValue(undefined),
      create: vi.fn().mockImplementation((name: string, config: AppConfig) => {
        idCounter++;
        return {
          id: idCounter,
          name,
          config: JSON.stringify(config),
          status: 'stopped',
          pid: null,
          started_at: null,
          restarts: 0,
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        } as ProcessRow;
      }),
      updateConfig: vi.fn(),
      updateStatus: vi.fn(),
      updateStarted: vi.fn(),
      incrementRestarts: vi.fn(),
      resetRestarts: vi.fn(),
      delete: vi.fn(),
      deleteAll: vi.fn(),
      parseConfig: vi.fn().mockImplementation((row: ProcessRow) => JSON.parse(row.config)),
    } as unknown as ProcessRepository;
  }

  function createMockEventRepo(): EventRepository {
    return {
      insert: vi.fn(),
      getByProcess: vi.fn().mockReturnValue([]),
      getByType: vi.fn().mockReturnValue([]),
      getRecent: vi.fn().mockReturnValue([]),
      getRange: vi.fn().mockReturnValue([]),
      cleanup: vi.fn(),
      deleteByProcess: vi.fn(),
    } as unknown as EventRepository;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    nextPid = 12345;
    mockFork.mockImplementation(() => {
      mockChild = createMockChildProcess(nextPid++);
      return mockChild;
    });
    mockSpawn.mockImplementation(() => {
      mockChild = createMockChildProcess(nextPid++);
      return mockChild;
    });

    eventBus = new EventBus();
    mockProcessRepo = createMockProcessRepo();
    mockEventRepo = createMockEventRepo();
    processManager = new ProcessManager(eventBus, mockProcessRepo, mockEventRepo);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    eventBus.removeAllListeners();
  });

  describe('start', () => {
    it('should create and start a new process', async () => {
      const result = await processManager.start(baseConfig);

      expect(result).toBeDefined();
      expect(result.name).toBe('test-app');
      expect(result.status).toBe('online');
      expect(result.pid).toBe(12345);
    });

    it('should call processRepo.create for a new process', async () => {
      await processManager.start(baseConfig);

      expect(mockProcessRepo.create).toHaveBeenCalledWith('test-app', baseConfig);
    });

    it('should reuse existing process row if name exists but process is not registered', async () => {
      const existingRow: ProcessRow = {
        id: 99,
        name: 'test-app',
        config: JSON.stringify(baseConfig),
        status: 'stopped',
        pid: null,
        started_at: null,
        restarts: 0,
        created_at: 1000,
        updated_at: 1000,
      };
      (mockProcessRepo.findByName as ReturnType<typeof vi.fn>).mockReturnValue(existingRow);

      const result = await processManager.start(baseConfig);

      expect(mockProcessRepo.create).not.toHaveBeenCalled();
      expect(mockProcessRepo.updateConfig).toHaveBeenCalledWith(99, baseConfig);
      expect(result.id).toBe(99);
    });

    it('should throw ProcessAlreadyExistsError if process with same name is running', async () => {
      await processManager.start(baseConfig);

      await expect(processManager.start(baseConfig)).rejects.toThrow(ProcessAlreadyExistsError);
    });

    it('should emit process:start event', async () => {
      const handler = vi.fn();
      eventBus.on('process:start', handler);

      await processManager.start(baseConfig);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'start',
          processName: 'test-app',
        }),
      );
    });

    it('should insert a start event into the event repository', async () => {
      await processManager.start(baseConfig);

      expect(mockEventRepo.insert).toHaveBeenCalledWith(
        expect.any(Number),
        'test-app',
        'start',
        expect.objectContaining({ pid: 12345 }),
      );
    });

    it('should call processRepo.updateStarted with pid', async () => {
      await processManager.start(baseConfig);

      expect(mockProcessRepo.updateStarted).toHaveBeenCalledWith(1, 12345);
    });

    it('should be able to start multiple processes with different names', async () => {
      const config2: AppConfig = { name: 'second-app', script: 'other.js', cwd: '/tmp' };

      const proc1 = await processManager.start(baseConfig);
      const proc2 = await processManager.start(config2);

      expect(proc1.name).toBe('test-app');
      expect(proc2.name).toBe('second-app');
      expect(proc1.id).not.toBe(proc2.id);
    });
  });

  describe('stop', () => {
    it('should stop a running process by name', async () => {
      await processManager.start(baseConfig);

      await processManager.stop('test-app');

      expect(mockGracefulShutdown).toHaveBeenCalled();
    });

    it('should stop a running process by id', async () => {
      const proc = await processManager.start(baseConfig);

      await processManager.stop(proc.id);

      expect(mockGracefulShutdown).toHaveBeenCalled();
    });

    it('should emit process:stop event', async () => {
      await processManager.start(baseConfig);
      const handler = vi.fn();
      eventBus.on('process:stop', handler);

      await processManager.stop('test-app');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stop',
          processName: 'test-app',
        }),
      );
    });

    it('should update process status in repository', async () => {
      await processManager.start(baseConfig);

      await processManager.stop('test-app');

      expect(mockProcessRepo.updateStatus).toHaveBeenCalledWith(1, 'stopped');
    });

    it('should insert stop event into event repository', async () => {
      await processManager.start(baseConfig);

      await processManager.stop('test-app');

      expect(mockEventRepo.insert).toHaveBeenCalledWith(1, 'test-app', 'stop', { force: false });
    });

    it('should support force stop', async () => {
      await processManager.start(baseConfig);

      await processManager.stop('test-app', true);

      expect(mockEventRepo.insert).toHaveBeenCalledWith(1, 'test-app', 'stop', { force: true });
    });

    it('should throw ProcessNotFoundError if process was already stopped (removed from map)', async () => {
      await processManager.start(baseConfig);
      await processManager.stop('test-app');

      await expect(processManager.stop('test-app')).rejects.toThrow(ProcessNotFoundError);
    });

    it('should remove process from list after stop', async () => {
      await processManager.start(baseConfig);
      expect(processManager.list()).toHaveLength(1);

      await processManager.stop('test-app');

      expect(processManager.list()).toHaveLength(0);
    });

    it('should throw ProcessNotFoundError if process does not exist', async () => {
      await expect(processManager.stop('nonexistent')).rejects.toThrow(ProcessNotFoundError);
    });

    it('should not auto-restart after intentional stop (wasIntentionallyStopped fix)', async () => {
      const config: AppConfig = {
        name: 'restartable-app',
        script: 'app.js',
        cwd: '/tmp/test-project',
        autorestart: true,
        max_restarts: 10,
      };

      await processManager.start(config);
      const childRef = mockChild;

      // Make gracefulShutdown simulate the child exiting during shutdown,
      // which is what really happens: stop() sets status='stopping', then
      // gracefulShutdown triggers exit, and the exit handler sees 'stopping'.
      mockGracefulShutdown.mockImplementationOnce(() => {
        childRef.emit('exit', 0, null);
        return Promise.resolve(0);
      });

      // Stop the process intentionally
      await processManager.stop('restartable-app');

      // Advance timers to ensure no restart timer fires
      vi.advanceTimersByTime(30000);

      // The process should be removed from the list after stop
      expect(processManager.list()).toHaveLength(0);
      // fork should have been called only once for the initial start
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
  });

  describe('restart', () => {
    it('should stop and restart a running process', async () => {
      await processManager.start(baseConfig);

      await processManager.restart('test-app');

      expect(mockGracefulShutdown).toHaveBeenCalled();
      // fork called twice: initial start + restart
      expect(mockFork).toHaveBeenCalledTimes(2);
    });

    it('should throw ProcessNotFoundError when restarting a stopped (removed) process', async () => {
      await processManager.start(baseConfig);
      await processManager.stop('test-app');

      // Process was removed from map after stop, so restart should throw
      await expect(processManager.restart('test-app')).rejects.toThrow(ProcessNotFoundError);
    });

    it('should emit process:restart event', async () => {
      await processManager.start(baseConfig);
      const handler = vi.fn();
      eventBus.on('process:restart', handler);

      await processManager.restart('test-app');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'restart',
          processName: 'test-app',
        }),
      );
    });

    it('should reset restart counter', async () => {
      await processManager.start(baseConfig);

      await processManager.restart('test-app');

      expect(mockProcessRepo.resetRestarts).toHaveBeenCalledWith(1);
    });

    it('should update started info in repository', async () => {
      await processManager.start(baseConfig);

      await processManager.restart('test-app');

      // Called for both start and restart
      expect(mockProcessRepo.updateStarted).toHaveBeenCalledTimes(2);
    });

    it('should throw ProcessNotFoundError for nonexistent process', async () => {
      await expect(processManager.restart('ghost')).rejects.toThrow(ProcessNotFoundError);
    });
  });

  describe('delete', () => {
    it('should stop and remove a running process', async () => {
      await processManager.start(baseConfig);

      await processManager.delete('test-app');

      expect(processManager.list()).toHaveLength(0);
    });

    it('should force-stop a running process during delete', async () => {
      await processManager.start(baseConfig);

      await processManager.delete('test-app');

      // Force stop passes true to container.stop()
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should remove process from repository', async () => {
      await processManager.start(baseConfig);

      await processManager.delete('test-app');

      expect(mockProcessRepo.delete).toHaveBeenCalledWith(1);
    });

    it('should throw ProcessNotFoundError when deleting an already stopped (removed) process', async () => {
      await processManager.start(baseConfig);
      await processManager.stop('test-app');

      // Process was removed from map after stop, so delete should throw
      await expect(processManager.delete('test-app')).rejects.toThrow(ProcessNotFoundError);
    });

    it('should throw ProcessNotFoundError for nonexistent process', async () => {
      await expect(processManager.delete('ghost')).rejects.toThrow(ProcessNotFoundError);
    });
  });

  describe('list', () => {
    it('should return an empty array when no processes exist', () => {
      const result = processManager.list();

      expect(result).toEqual([]);
    });

    it('should return all processes', async () => {
      await processManager.start(baseConfig);
      await processManager.start({ name: 'app2', script: 'app2.js', cwd: '/tmp' });

      const result = processManager.list();

      expect(result).toHaveLength(2);
      expect(result.map((p) => p.name)).toContain('test-app');
      expect(result.map((p) => p.name)).toContain('app2');
    });

    it('should return NovaProcess objects', async () => {
      await processManager.start(baseConfig);

      const result = processManager.list();

      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('script');
      expect(result[0]).toHaveProperty('status');
      expect(result[0]).toHaveProperty('pid');
    });
  });

  describe('info', () => {
    it('should return process info by name', async () => {
      await processManager.start(baseConfig);

      const info = processManager.info('test-app');

      expect(info.name).toBe('test-app');
      expect(info.status).toBe('online');
    });

    it('should return process info by id', async () => {
      const proc = await processManager.start(baseConfig);

      const info = processManager.info(proc.id);

      expect(info.name).toBe('test-app');
      expect(info.id).toBe(proc.id);
    });

    it('should return process info by numeric string id', async () => {
      const proc = await processManager.start(baseConfig);

      const info = processManager.info(String(proc.id));

      expect(info.id).toBe(proc.id);
    });

    it('should throw ProcessNotFoundError for unknown name', () => {
      expect(() => processManager.info('nonexistent')).toThrow(ProcessNotFoundError);
    });

    it('should throw ProcessNotFoundError for unknown id', () => {
      expect(() => processManager.info(9999)).toThrow(ProcessNotFoundError);
    });
  });

  describe('stopAll', () => {
    it('should stop all running processes', async () => {
      await processManager.start(baseConfig);
      await processManager.start({ name: 'app2', script: 'app2.js', cwd: '/tmp' });
      await processManager.start({ name: 'app3', script: 'app3.js', cwd: '/tmp' });

      await processManager.stopAll();

      // gracefulShutdown should be called for each running process
      expect(mockGracefulShutdown).toHaveBeenCalledTimes(3);
    });

    it('should support force stop all', async () => {
      await processManager.start(baseConfig);
      const childRef = mockChild;
      await processManager.start({ name: 'app2', script: 'app2.js', cwd: '/tmp' });

      await processManager.stopAll(true);

      // Force stop sends SIGKILL directly
      expect(childRef.kill).toHaveBeenCalledWith('SIGKILL');
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should handle no running processes without error', async () => {
      await expect(processManager.stopAll()).resolves.toBeUndefined();
    });

    it('should skip already stopped (removed) processes', async () => {
      await processManager.start(baseConfig);
      await processManager.stop('test-app');

      mockGracefulShutdown.mockClear();

      await processManager.stopAll();

      // The already-stopped process was removed from map, so nothing to stop
      expect(mockGracefulShutdown).not.toHaveBeenCalled();
    });

    it('should remove all processes from list after stopAll', async () => {
      await processManager.start(baseConfig);
      await processManager.start({ name: 'app2', script: 'app2.js', cwd: '/tmp' });
      expect(processManager.list()).toHaveLength(2);

      await processManager.stopAll();

      expect(processManager.list()).toHaveLength(0);
    });
  });

  describe('getContainer', () => {
    it('should return the container by identifier', async () => {
      await processManager.start(baseConfig);

      const container = processManager.getContainer('test-app');

      expect(container).toBeDefined();
      expect(container.name).toBe('test-app');
    });

    it('should throw ProcessNotFoundError for unknown identifier', () => {
      expect(() => processManager.getContainer('unknown')).toThrow(ProcessNotFoundError);
    });
  });

  describe('getRunningPids', () => {
    it('should return a map of process ids to pids', async () => {
      await processManager.start(baseConfig);
      await processManager.start({ name: 'app2', script: 'app2.js', cwd: '/tmp' });

      const pids = processManager.getRunningPids();

      expect(pids.size).toBe(2);
      expect(pids.get(1)).toBe(12345);
      expect(pids.get(2)).toBe(12346);
    });

    it('should return empty map when no processes are running', () => {
      const pids = processManager.getRunningPids();
      expect(pids.size).toBe(0);
    });
  });

  describe('auto-restart behavior', () => {
    it('should auto-restart when process crashes and autorestart is enabled', async () => {
      const config: AppConfig = {
        name: 'crashable-app',
        script: 'app.js',
        cwd: '/tmp/test-project',
        autorestart: true,
        max_restarts: 5,
        restart_delay: 1000,
      };

      await processManager.start(config);
      const firstChild = mockChild;

      // Simulate crash exit (non-zero code)
      firstChild.emit('exit', 1, null);

      // Container should be in waiting-restart state
      const container = processManager.getContainer('crashable-app');
      expect(container.status).toBe('waiting-restart');

      // Advance past restart delay
      vi.advanceTimersByTime(1500);

      // Should have been restarted (fork called again)
      expect(mockFork).toHaveBeenCalledTimes(2);
    });

    it('should not auto-restart when autorestart is false', async () => {
      const config: AppConfig = {
        name: 'no-restart-app',
        script: 'app.js',
        cwd: '/tmp/test-project',
        autorestart: false,
      };

      await processManager.start(config);
      const firstChild = mockChild;

      firstChild.emit('exit', 1, null);

      vi.advanceTimersByTime(30000);

      // Should not restart
      expect(mockFork).toHaveBeenCalledTimes(1);
    });

    it('should not auto-restart when max restarts is reached', async () => {
      const config: AppConfig = {
        name: 'limited-app',
        script: 'app.js',
        cwd: '/tmp/test-project',
        autorestart: true,
        max_restarts: 0,
      };

      await processManager.start(config);
      const firstChild = mockChild;

      firstChild.emit('exit', 1, null);

      vi.advanceTimersByTime(30000);

      // Should not restart since max_restarts is 0
      expect(mockFork).toHaveBeenCalledTimes(1);
    });

    it('should emit process:crash event on non-zero exit code', async () => {
      const crashHandler = vi.fn();
      eventBus.on('process:crash', crashHandler);

      await processManager.start({
        ...baseConfig,
        autorestart: false,
      });

      mockChild.emit('exit', 1, null);

      expect(crashHandler).toHaveBeenCalledOnce();
      expect(crashHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'crash',
          processName: 'test-app',
          data: expect.objectContaining({ exitCode: 1 }),
        }),
      );
    });

    it('should emit process:exit event on clean exit code 0', async () => {
      const exitHandler = vi.fn();
      eventBus.on('process:exit', exitHandler);

      await processManager.start({
        ...baseConfig,
        autorestart: false,
      });

      mockChild.emit('exit', 0, null);

      expect(exitHandler).toHaveBeenCalledOnce();
      expect(exitHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'exit',
          processName: 'test-app',
        }),
      );
    });

    it('should not auto-restart after intentional stop even when process crashes', async () => {
      const config: AppConfig = {
        name: 'stop-test-app',
        script: 'app.js',
        cwd: '/tmp/test-project',
        autorestart: true,
        max_restarts: 10,
        restart_delay: 100,
      };

      await processManager.start(config);
      const childRef = mockChild;

      // Make gracefulShutdown simulate the child exiting with a crash code
      // during shutdown. The real flow: stop() sets status='stopping', then
      // gracefulShutdown triggers exit with non-zero code, and the exit handler
      // sees status='stopping' and skips auto-restart.
      mockGracefulShutdown.mockImplementationOnce(() => {
        childRef.emit('exit', 1, 'SIGTERM');
        return Promise.resolve(1);
      });

      // Intentionally stop the process
      await processManager.stop('stop-test-app');

      vi.advanceTimersByTime(30000);

      // Process should be removed from list and no restart should have occurred
      expect(processManager.list()).toHaveLength(0);
      expect(mockFork).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolve (identifier resolution)', () => {
    it('should resolve by numeric id', async () => {
      await processManager.start(baseConfig);

      const info = processManager.info(1);
      expect(info.name).toBe('test-app');
    });

    it('should resolve by string numeric id', async () => {
      await processManager.start(baseConfig);

      const info = processManager.info('1');
      expect(info.name).toBe('test-app');
    });

    it('should resolve by name', async () => {
      await processManager.start(baseConfig);

      const info = processManager.info('test-app');
      expect(info.name).toBe('test-app');
    });

    it('should prefer id lookup over name for numeric strings', async () => {
      // If a process has numeric id matching the string, it should find it by id first
      await processManager.start(baseConfig);

      const info = processManager.info('1');
      expect(info.id).toBe(1);
    });

    it('should throw ProcessNotFoundError for completely unknown identifier', () => {
      expect(() => processManager.info('does-not-exist')).toThrow(ProcessNotFoundError);
      expect(() => processManager.info(999)).toThrow(ProcessNotFoundError);
    });
  });

  describe('deleteAll', () => {
    it('should stop all processes and clear them', async () => {
      await processManager.start(baseConfig);
      await processManager.start({ name: 'app2', script: 'app2.js', cwd: '/tmp' });

      await processManager.deleteAll();

      expect(processManager.list()).toHaveLength(0);
      expect(mockProcessRepo.deleteAll).toHaveBeenCalled();
    });
  });

  describe('restartAll', () => {
    it('should restart all processes', async () => {
      await processManager.start(baseConfig);
      await processManager.start({ name: 'app2', script: 'app2.js', cwd: '/tmp' });

      await processManager.restartAll();

      // Each process forked once for start, once for restart = 4 total
      expect(mockFork).toHaveBeenCalledTimes(4);
    });
  });

  describe('setLogAggregator', () => {
    it('should set the log aggregator and use it for output', async () => {
      const mockLogAggregator = {
        write: vi.fn(),
      };

      processManager.setLogAggregator(mockLogAggregator as never);

      await processManager.start(baseConfig);

      // Simulate stdout
      (mockChild.stdout as EventEmitter).emit('data', Buffer.from('test output'));

      expect(mockLogAggregator.write).toHaveBeenCalledWith(
        1,
        'test-app',
        'stdout',
        Buffer.from('test output'),
      );
    });
  });

  describe('restoreFromDb', () => {
    it('should restore processes from database rows', () => {
      const rows: ProcessRow[] = [
        {
          id: 1,
          name: 'restored-app',
          config: JSON.stringify({ name: 'restored-app', script: 'app.js' }),
          status: 'stopped',
          pid: null,
          started_at: null,
          restarts: 5,
          created_at: 1700000000,
          updated_at: 1700000000,
        },
      ];

      (mockProcessRepo.findAll as ReturnType<typeof vi.fn>).mockReturnValue(rows);
      (mockProcessRepo.parseConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        name: 'restored-app',
        script: 'app.js',
      });

      processManager.restoreFromDb();

      const list = processManager.list();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('restored-app');
      expect(list[0].restarts).toBe(5);
    });
  });
});
