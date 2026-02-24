import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { AppConfig } from '@novapm/shared';

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

import { ProcessContainer } from '../process/ProcessContainer.js';

describe('ProcessContainer', () => {
  let container: ProcessContainer;
  let mockChild: ChildProcess;

  const baseConfig: AppConfig = {
    name: 'test-app',
    script: 'app.js',
    cwd: '/tmp/test-project',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockChild = createMockChildProcess(12345);
    mockFork.mockReturnValue(mockChild);
    mockSpawn.mockReturnValue(mockChild);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct id, name, and config', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);

      expect(container.id).toBe(1);
      expect(container.name).toBe('my-app');
      expect(container.config).toBe(baseConfig);
    });

    it('should have default values for mutable properties', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);

      expect(container.child).toBeNull();
      expect(container.status).toBe('stopped');
      expect(container.pid).toBeNull();
      expect(container.restarts).toBe(0);
      expect(container.startedAt).toBeNull();
      expect(container.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('start', () => {
    it('should fork a node process when interpreter is node (default)', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.start();

      expect(mockFork).toHaveBeenCalledOnce();
      expect(mockFork).toHaveBeenCalledWith(
        expect.stringContaining('app.js'),
        [],
        expect.objectContaining({
          cwd: '/tmp/test-project',
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          detached: false,
        }),
      );
    });

    it('should use spawn when interpreter is not node', () => {
      const pythonConfig: AppConfig = {
        name: 'py-app',
        script: 'main.py',
        interpreter: 'python3',
        cwd: '/tmp/test-python',
      };

      container = new ProcessContainer(2, 'py-app', pythonConfig);
      container.start();

      expect(mockSpawn).toHaveBeenCalledOnce();
      expect(mockSpawn).toHaveBeenCalledWith(
        'python3',
        expect.arrayContaining([expect.stringContaining('main.py')]),
        expect.objectContaining({
          cwd: '/tmp/test-python',
          detached: false,
        }),
      );
      expect(mockFork).not.toHaveBeenCalled();
    });

    it('should transition status from stopped -> launching -> online', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      expect(container.status).toBe('stopped');

      container.start();

      // After start completes synchronously, status should be online
      expect(container.status).toBe('online');
    });

    it('should set pid and startedAt after starting', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      expect(container.pid).toBeNull();
      expect(container.startedAt).toBeNull();

      container.start();

      expect(container.pid).toBe(12345);
      expect(container.startedAt).toBeInstanceOf(Date);
    });

    it('should pass environment variables from config', () => {
      const configWithEnv: AppConfig = {
        name: 'env-app',
        script: 'server.js',
        cwd: '/tmp/test-project',
        env: { NODE_ENV: 'production', PORT: '3000' },
      };

      container = new ProcessContainer(1, 'env-app', configWithEnv);
      container.start();

      const forkCall = mockFork.mock.calls[0];
      const options = forkCall[2] as { env: Record<string, string> };
      expect(options.env.NODE_ENV).toBe('production');
      expect(options.env.PORT).toBe('3000');
    });

    it('should merge process.env with config env', () => {
      const configWithEnv: AppConfig = {
        name: 'env-app',
        script: 'server.js',
        cwd: '/tmp/test-project',
        env: { CUSTOM_VAR: 'custom_value' },
      };

      container = new ProcessContainer(1, 'env-app', configWithEnv);
      container.start();

      const forkCall = mockFork.mock.calls[0];
      const options = forkCall[2] as { env: Record<string, string> };
      // Should contain both process.env keys and custom ones
      expect(options.env.CUSTOM_VAR).toBe('custom_value');
      // process.env PATH should also be there
      expect(options.env.PATH).toBeDefined();
    });

    it('should pass args as array when provided as string', () => {
      const configWithArgs: AppConfig = {
        name: 'arg-app',
        script: 'app.js',
        args: '--port 3000 --verbose',
        cwd: '/tmp/test-project',
      };

      container = new ProcessContainer(1, 'arg-app', configWithArgs);
      container.start();

      const forkCall = mockFork.mock.calls[0];
      const args = forkCall[1] as string[];
      expect(args).toEqual(['--port', '3000', '--verbose']);
    });

    it('should pass args as-is when provided as array', () => {
      const configWithArgs: AppConfig = {
        name: 'arg-app',
        script: 'app.js',
        args: ['--port', '3000'],
        cwd: '/tmp/test-project',
      };

      container = new ProcessContainer(1, 'arg-app', configWithArgs);
      container.start();

      const forkCall = mockFork.mock.calls[0];
      const args = forkCall[1] as string[];
      expect(args).toEqual(['--port', '3000']);
    });

    it('should pass node_args as execArgv for node interpreter', () => {
      const configWithNodeArgs: AppConfig = {
        name: 'node-app',
        script: 'app.js',
        node_args: ['--max-old-space-size=4096', '--inspect'],
        cwd: '/tmp/test-project',
      };

      container = new ProcessContainer(1, 'node-app', configWithNodeArgs);
      container.start();

      const forkCall = mockFork.mock.calls[0];
      const options = forkCall[2] as { execArgv: string[] };
      expect(options.execArgv).toEqual(['--max-old-space-size=4096', '--inspect']);
    });

    it('should pass interpreterArgs for non-node interpreters', () => {
      const configWithInterpreterArgs: AppConfig = {
        name: 'py-app',
        script: 'main.py',
        interpreter: 'python3',
        interpreterArgs: ['-u'],
        cwd: '/tmp/test-project',
      };

      container = new ProcessContainer(2, 'py-app', configWithInterpreterArgs);
      container.start();

      const spawnCall = mockSpawn.mock.calls[0];
      const allArgs = spawnCall[1] as string[];
      expect(allArgs[0]).toBe('-u');
      expect(allArgs[allArgs.length - 1]).toContain('main.py');
    });

    it('should also fork when interpreter is "nodejs"', () => {
      const config: AppConfig = {
        name: 'app',
        script: 'app.js',
        interpreter: 'nodejs',
        cwd: '/tmp',
      };

      container = new ProcessContainer(1, 'app', config);
      container.start();

      expect(mockFork).toHaveBeenCalledOnce();
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should attach stdout and stderr handlers', () => {
      const stdoutHandler = vi.fn();
      const stderrHandler = vi.fn();

      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.setOutputHandlers(stdoutHandler, stderrHandler);
      container.start();

      // Simulate stdout data
      const stdoutData = Buffer.from('hello stdout');
      (mockChild.stdout as EventEmitter).emit('data', stdoutData);
      expect(stdoutHandler).toHaveBeenCalledWith(stdoutData);

      // Simulate stderr data
      const stderrData = Buffer.from('hello stderr');
      (mockChild.stderr as EventEmitter).emit('data', stderrData);
      expect(stderrHandler).toHaveBeenCalledWith(stderrData);
    });

    it('should call the exit handler when child process exits', () => {
      const exitHandler = vi.fn();

      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.setExitHandler(exitHandler);
      container.start();

      // Simulate process exit
      mockChild.emit('exit', 0, null);

      expect(exitHandler).toHaveBeenCalledWith(0, null);
    });

    it('should clear pid on exit', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.setExitHandler(vi.fn());
      container.start();

      expect(container.pid).toBe(12345);

      mockChild.emit('exit', 0, null);

      expect(container.pid).toBeNull();
    });

    it('should set status to errored on error event', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.setExitHandler(vi.fn());
      container.start();

      mockChild.emit('error', new Error('spawn ENOENT'));

      expect(container.status).toBe('errored');
      expect(container.pid).toBeNull();
    });

    it('should call exit handler with code 1 on error event', () => {
      const exitHandler = vi.fn();

      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.setExitHandler(exitHandler);
      container.start();

      mockChild.emit('error', new Error('spawn ENOENT'));

      expect(exitHandler).toHaveBeenCalledWith(1, null);
    });
  });

  describe('stop', () => {
    beforeEach(() => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.start();
    });

    it('should set status to stopping then stopped', async () => {
      mockGracefulShutdown.mockResolvedValue(0);

      const stopPromise = container.stop();

      // During stop, status should be stopping
      expect(container.status).toBe('stopping');

      await stopPromise;

      expect(container.status).toBe('stopped');
    });

    it('should call gracefulShutdown for non-force stops', async () => {
      await container.stop(false);

      expect(mockGracefulShutdown).toHaveBeenCalledOnce();
      expect(mockGracefulShutdown).toHaveBeenCalledWith(mockChild, {
        timeout: expect.any(Number),
        useMessage: false,
      });
    });

    it('should send SIGKILL for force stops', async () => {
      await container.stop(true);

      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
      expect(mockGracefulShutdown).not.toHaveBeenCalled();
    });

    it('should clear pid and child after stopping', async () => {
      await container.stop();

      expect(container.pid).toBeNull();
      expect(container.child).toBeNull();
    });

    it('should use config kill_timeout for graceful shutdown', async () => {
      const configWithTimeout: AppConfig = {
        name: 'test-app',
        script: 'app.js',
        kill_timeout: 10000,
        cwd: '/tmp/test-project',
      };

      const timedContainer = new ProcessContainer(2, 'timed-app', configWithTimeout);
      timedContainer.start();

      await timedContainer.stop();

      expect(mockGracefulShutdown).toHaveBeenCalledWith(expect.anything(), {
        timeout: 10000,
        useMessage: false,
      });
    });

    it('should be a no-op if process is already stopped', async () => {
      container.status = 'stopped';
      container.child = null;

      await container.stop();

      expect(mockGracefulShutdown).not.toHaveBeenCalled();
    });

    it('should be a no-op if child is null', async () => {
      container.child = null;

      await container.stop();

      expect(mockGracefulShutdown).not.toHaveBeenCalled();
    });

    it('should handle SIGKILL error gracefully during force stop', async () => {
      (mockChild.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('No such process');
      });

      // Should not throw
      await expect(container.stop(true)).resolves.toBeUndefined();
    });
  });

  describe('isRunning', () => {
    it('should return true when status is online', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.status = 'online';
      expect(container.isRunning()).toBe(true);
    });

    it('should return true when status is launching', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.status = 'launching';
      expect(container.isRunning()).toBe(true);
    });

    it('should return false when status is stopped', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.status = 'stopped';
      expect(container.isRunning()).toBe(false);
    });

    it('should return false when status is errored', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.status = 'errored';
      expect(container.isRunning()).toBe(false);
    });

    it('should return false when status is stopping', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.status = 'stopping';
      expect(container.isRunning()).toBe(false);
    });

    it('should return false when status is waiting-restart', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.status = 'waiting-restart';
      expect(container.isRunning()).toBe(false);
    });
  });

  describe('getUptime', () => {
    it('should return 0 if startedAt is null', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      expect(container.getUptime()).toBe(0);
    });

    it('should return elapsed seconds since startedAt', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      // Set startedAt to 60 seconds ago
      container.startedAt = new Date(Date.now() - 60000);

      const uptime = container.getUptime();
      // Allow small variance for execution time
      expect(uptime).toBeGreaterThanOrEqual(59);
      expect(uptime).toBeLessThanOrEqual(61);
    });
  });

  describe('toNovaProcess', () => {
    it('should return a NovaProcess object with correct fields', () => {
      const config: AppConfig = {
        name: 'api-server',
        script: 'server.js',
        cwd: '/tmp/api',
        args: ['--port', '8080'],
        interpreter: 'node',
        exec_mode: 'fork',
        instances: 2,
        port: 8080,
        env: { NODE_ENV: 'production' },
        max_restarts: 10,
        restart_delay: 1000,
        exp_backoff_restart_delay: 100,
        max_memory_restart: '1G',
        autorestart: true,
        watch: true,
        ignore_watch: ['node_modules'],
        kill_timeout: 3000,
        listen_timeout: 5000,
        merge_logs: true,
        source_map_support: true,
      };

      container = new ProcessContainer(5, 'api-server', config);
      container.start();
      container.restarts = 3;

      const novaProcess = container.toNovaProcess();

      expect(novaProcess.id).toBe(5);
      expect(novaProcess.name).toBe('api-server');
      expect(novaProcess.script).toBe('server.js');
      expect(novaProcess.cwd).toBe('/tmp/api');
      expect(novaProcess.args).toEqual(['--port', '8080']);
      expect(novaProcess.interpreter).toBe('node');
      expect(novaProcess.execMode).toBe('fork');
      expect(novaProcess.instances).toBe(2);
      expect(novaProcess.status).toBe('online');
      expect(novaProcess.pid).toBe(12345);
      expect(novaProcess.port).toBe(8080);
      expect(novaProcess.env).toEqual({ NODE_ENV: 'production' });
      expect(novaProcess.restarts).toBe(3);
      expect(novaProcess.maxRestarts).toBe(10);
      expect(novaProcess.restartDelay).toBe(1000);
      expect(novaProcess.expBackoffRestartDelay).toBe(100);
      expect(novaProcess.maxMemoryRestart).toBe('1G');
      expect(novaProcess.autorestart).toBe(true);
      expect(novaProcess.watch).toBe(true);
      expect(novaProcess.ignoreWatch).toEqual(['node_modules']);
      expect(novaProcess.killTimeout).toBe(3000);
      expect(novaProcess.listenTimeout).toBe(5000);
      expect(novaProcess.mergeLogs).toBe(true);
      expect(novaProcess.sourceMapSupport).toBe(true);
      expect(novaProcess.createdAt).toBeInstanceOf(Date);
      expect(novaProcess.startedAt).toBeInstanceOf(Date);
    });

    it('should use defaults for unspecified config fields', () => {
      container = new ProcessContainer(1, 'simple-app', baseConfig);
      const novaProcess = container.toNovaProcess();

      expect(novaProcess.interpreter).toBe('node');
      expect(novaProcess.execMode).toBe('fork');
      expect(novaProcess.instances).toBe(1);
      expect(novaProcess.env).toEqual({});
      expect(novaProcess.maxRestarts).toBe(16);
      expect(novaProcess.restartDelay).toBe(0);
      expect(novaProcess.expBackoffRestartDelay).toBe(0);
      expect(novaProcess.maxMemoryRestart).toBeNull();
      expect(novaProcess.autorestart).toBe(true);
      expect(novaProcess.watch).toBe(false);
      expect(novaProcess.ignoreWatch).toEqual([]);
      expect(novaProcess.killTimeout).toBe(5000);
      expect(novaProcess.listenTimeout).toBe(8000);
      expect(novaProcess.mergeLogs).toBe(false);
      expect(novaProcess.sourceMapSupport).toBe(false);
      expect(novaProcess.port).toBeNull();
      expect(novaProcess.pid).toBeNull();
    });

    it('should handle args given as string', () => {
      const config: AppConfig = {
        name: 'arg-app',
        script: 'app.js',
        args: '--verbose --debug',
      };

      container = new ProcessContainer(1, 'arg-app', config);
      const novaProcess = container.toNovaProcess();

      expect(novaProcess.args).toEqual(['--verbose', '--debug']);
    });

    it('should return empty args array when args is undefined', () => {
      container = new ProcessContainer(1, 'my-app', baseConfig);
      const novaProcess = container.toNovaProcess();

      expect(novaProcess.args).toEqual([]);
    });
  });

  describe('setOutputHandlers', () => {
    it('should store output handlers that are called on start', () => {
      const stdoutHandler = vi.fn();
      const stderrHandler = vi.fn();

      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.setOutputHandlers(stdoutHandler, stderrHandler);
      container.start();

      (mockChild.stdout as EventEmitter).emit('data', Buffer.from('out'));
      (mockChild.stderr as EventEmitter).emit('data', Buffer.from('err'));

      expect(stdoutHandler).toHaveBeenCalledOnce();
      expect(stderrHandler).toHaveBeenCalledOnce();
    });
  });

  describe('setExitHandler', () => {
    it('should store exit handler that is called on child exit', () => {
      const exitHandler = vi.fn();

      container = new ProcessContainer(1, 'my-app', baseConfig);
      container.setExitHandler(exitHandler);
      container.start();

      mockChild.emit('exit', 1, 'SIGTERM');

      expect(exitHandler).toHaveBeenCalledWith(1, 'SIGTERM');
    });
  });
});
