import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IPCRequest, IPCResponse } from '@novapm/shared';
import { IPC_ERROR_CODES } from '@novapm/shared';
import { serializeMessage } from '../ipc/protocol.js';

// --- Hoisted mock state ---

const { mockServerHolder } = vi.hoisted(() => {
  const mockServerHolder: { instance: unknown | null } = { instance: null };
  return { mockServerHolder };
});

// Mock the logger
vi.mock('@novapm/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@novapm/shared')>();
  return {
    ...actual,
    getLogger: () => ({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    }),
  };
});

vi.mock('node:net', () => {
  const { EventEmitter: EE } = require('node:events') as typeof import('node:events');

  class InternalMockServer extends EE {
    listening = false;
    sockPath = '';
    _connectionHandler: ((socket: unknown) => void) | null = null;

    listen(path: string, callback: () => void): void {
      this.sockPath = path;
      this.listening = true;
      callback();
    }

    close(callback: () => void): void {
      this.listening = false;
      callback();
    }
  }

  return {
    createServer: (connectionHandler: (socket: unknown) => void) => {
      const server = new InternalMockServer();
      server._connectionHandler = connectionHandler;
      mockServerHolder.instance = server;
      return server;
    },
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    dirname: vi.fn((p: string) => p.replace(/\/[^/]+$/, '')),
  };
});

// --- MockSocket class for use in tests ---

class MockSocket extends EventEmitter {
  destroyed = false;
  written: string[] = [];

  write(data: string): boolean {
    this.written.push(data);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

// --- Mocks for ProcessManager, LogAggregator, MetricsCollector, SystemMetricsCollector ---

function createMockProcessManager() {
  return {
    start: vi.fn().mockResolvedValue({ id: 1, name: 'test-app', status: 'online' }),
    stop: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn().mockResolvedValue(undefined),
    restart: vi.fn().mockResolvedValue(undefined),
    restartAll: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockReturnValue([
      { id: 1, name: 'app-1', status: 'online' },
      { id: 2, name: 'app-2', status: 'stopped' },
    ]),
    info: vi.fn().mockReturnValue({ id: 1, name: 'app-1', status: 'online' }),
  };
}

function createMockLogAggregator() {
  return {
    getRecentLogs: vi.fn().mockReturnValue([]),
    getAllRecentLogs: vi.fn().mockReturnValue([]),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockMetricsCollector() {
  return {
    getLatest: vi.fn().mockReturnValue({ cpu: 10, memory: 50000 }),
    getAllLatest: vi.fn().mockReturnValue(new Map()),
  };
}

function createMockSystemMetrics() {
  return {
    getLatest: vi.fn().mockReturnValue({
      cpuUsage: 25,
      memoryUsed: 4000000000,
      memoryTotal: 8000000000,
    }),
  };
}

// --- Helper to access the mock server ---

function getMockServer(): {
  listening: boolean;
  sockPath: string;
  _connectionHandler: ((socket: MockSocket) => void) | null;
} {
  return mockServerHolder.instance as {
    listening: boolean;
    sockPath: string;
    _connectionHandler: ((socket: MockSocket) => void) | null;
  };
}

// --- Tests ---

describe('IPCServer', () => {
  let server: InstanceType<typeof import('../ipc/IPCServer.js').IPCServer>;
  let processManager: ReturnType<typeof createMockProcessManager>;
  let logAggregator: ReturnType<typeof createMockLogAggregator>;
  let metricsCollector: ReturnType<typeof createMockMetricsCollector>;
  let systemMetrics: ReturnType<typeof createMockSystemMetrics>;

  beforeEach(async () => {
    vi.clearAllMocks();

    processManager = createMockProcessManager();
    logAggregator = createMockLogAggregator();
    metricsCollector = createMockMetricsCollector();
    systemMetrics = createMockSystemMetrics();

    // Dynamically import to get the class after mocks are set up
    const { IPCServer } = await import('../ipc/IPCServer.js');
    server = new IPCServer(
      processManager as never,
      logAggregator as never,
      metricsCollector as never,
      systemMetrics as never,
      '/tmp/test-nova.sock',
    );
  });

  afterEach(async () => {
    await server.stop();
    vi.restoreAllMocks();
  });

  describe('start and stop', () => {
    it('should start listening on the socket path', async () => {
      await server.start();
      const mockServer = getMockServer();

      expect(mockServer.listening).toBe(true);
      expect(mockServer.sockPath).toBe('/tmp/test-nova.sock');
    });

    it('should stop and close all connections', async () => {
      await server.start();
      await server.stop();
      const mockServer = getMockServer();

      expect(mockServer.listening).toBe(false);
    });

    it('should handle stop when server was never started', async () => {
      // Should not throw
      await server.stop();
    });
  });

  describe('handler registration and request handling', () => {
    function simulateClientMessage(socket: MockSocket, request: IPCRequest): void {
      const data = serializeMessage(request);
      socket.emit('data', Buffer.from(data));
    }

    async function getResponse(socket: MockSocket): Promise<IPCResponse> {
      // Wait for async handler processing
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(socket.written.length).toBeGreaterThan(0);
      const lastMsg = socket.written[socket.written.length - 1];
      return JSON.parse(lastMsg.trim()) as IPCResponse;
    }

    async function connectSocket(): Promise<MockSocket> {
      await server.start();
      const socket = new MockSocket();
      const mockServer = getMockServer();
      mockServer._connectionHandler!(socket);
      return socket;
    }

    it('should handle daemon.ping requests', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'daemon.ping',
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-1');
      expect(response.result).toBeDefined();
      const result = response.result as Record<string, unknown>;
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('pid');
    });

    it('should handle daemon.version requests', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-2',
        method: 'daemon.version',
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ version: '0.1.0' });
    });

    it('should handle daemon.stop requests', async () => {
      const stopHandler = vi.fn().mockResolvedValue(undefined);
      server.setStopHandler(stopHandler);

      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-3',
        method: 'daemon.stop',
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'stopping' });
    });

    it('should handle process.start requests', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-4',
        method: 'process.start',
        params: { name: 'my-app', script: 'index.js' },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ id: 1, name: 'test-app', status: 'online' });
      expect(processManager.start).toHaveBeenCalledWith({ name: 'my-app', script: 'index.js' });
    });

    it('should handle process.stop requests with id', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-5',
        method: 'process.stop',
        params: { id: 1 },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'ok' });
      expect(processManager.stop).toHaveBeenCalledWith(1, undefined);
    });

    it('should handle process.stop requests with name', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-5b',
        method: 'process.stop',
        params: { name: 'my-app' },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'ok' });
      expect(processManager.stop).toHaveBeenCalledWith('my-app', undefined);
    });

    it('should handle process.stop with force flag', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-5c',
        method: 'process.stop',
        params: { id: 1, force: true },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'ok' });
      expect(processManager.stop).toHaveBeenCalledWith(1, true);
    });

    it('should handle process.stop all', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-5d',
        method: 'process.stop',
        params: { name: 'all' },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'ok' });
      expect(processManager.stopAll).toHaveBeenCalled();
    });

    it('should return error when process.stop missing id and name', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-5e',
        method: 'process.stop',
        params: {},
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
      expect(response.error!.message).toContain('id or name required');
    });

    it('should handle process.restart requests', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-6',
        method: 'process.restart',
        params: { id: 1 },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'ok' });
      expect(processManager.restart).toHaveBeenCalledWith(1);
    });

    it('should handle process.restart all', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-6b',
        method: 'process.restart',
        params: { name: 'all' },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'ok' });
      expect(processManager.restartAll).toHaveBeenCalled();
    });

    it('should handle process.delete requests', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-7',
        method: 'process.delete',
        params: { id: 1 },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'ok' });
      expect(processManager.delete).toHaveBeenCalledWith(1);
    });

    it('should handle process.delete all', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-7b',
        method: 'process.delete',
        params: { name: 'all' },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'ok' });
      expect(processManager.deleteAll).toHaveBeenCalled();
    });

    it('should handle process.list requests with metrics', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-8',
        method: 'process.list',
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toBeDefined();
      const result = response.result as Array<Record<string, unknown>>;
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('metrics');
      expect(processManager.list).toHaveBeenCalled();
      expect(metricsCollector.getLatest).toHaveBeenCalledWith(1);
      expect(metricsCollector.getLatest).toHaveBeenCalledWith(2);
    });

    it('should handle process.info requests', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-9',
        method: 'process.info',
        params: { id: 1 },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toBeDefined();
      const result = response.result as Record<string, unknown>;
      expect(result).toHaveProperty('metrics');
      expect(processManager.info).toHaveBeenCalledWith(1);
    });

    it('should handle logs.recent with process id', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-10',
        method: 'logs.recent',
        params: { id: 1, lines: 25 },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(logAggregator.getRecentLogs).toHaveBeenCalledWith(1, 25);
      expect(response.error).toBeUndefined();
    });

    it('should handle logs.recent with process name', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-10b',
        method: 'logs.recent',
        params: { name: 'app-1' },
      };
      simulateClientMessage(socket, request);
      await getResponse(socket);

      expect(processManager.info).toHaveBeenCalledWith('app-1');
      expect(logAggregator.getRecentLogs).toHaveBeenCalled();
    });

    it('should handle logs.recent without process identifier', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-10c',
        method: 'logs.recent',
        params: {},
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(logAggregator.getAllRecentLogs).toHaveBeenCalled();
      expect(response.error).toBeUndefined();
    });

    it('should handle logs.flush requests', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-11',
        method: 'logs.flush',
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'ok' });
      expect(logAggregator.flush).toHaveBeenCalled();
    });

    it('should handle metrics.get requests', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-12',
        method: 'metrics.get',
        params: { id: 1 },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(metricsCollector.getLatest).toHaveBeenCalledWith(1);
      expect(response.result).toEqual({ cpu: 10, memory: 50000 });
    });

    it('should handle metrics.system requests', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-13',
        method: 'metrics.system',
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(systemMetrics.getLatest).toHaveBeenCalled();
      expect(response.result).toBeDefined();
    });

    it('should handle config.reload requests', async () => {
      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-14',
        method: 'config.reload',
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.result).toEqual({ status: 'ok' });
    });

    it('should return error for unknown methods (fails zod validation)', async () => {
      const socket = await connectSocket();

      // Craft raw message with invalid method (not in the enum)
      const rawMsg =
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-15',
          method: 'unknown.method',
        }) + '\n';
      socket.emit('data', Buffer.from(rawMsg));
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Invalid method should fail zod validation, resulting in an invalid params response
      expect(socket.written.length).toBeGreaterThan(0);
      const response = JSON.parse(socket.written[0].trim()) as IPCResponse;
      expect(response.error).toBeDefined();
    });

    it('should return internal error when handler throws', async () => {
      processManager.start.mockRejectedValue(new Error('Process crashed'));

      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-16',
        method: 'process.start',
        params: { name: 'crash-app', script: 'crash.js' },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
      expect(response.error!.message).toBe('Process crashed');
    });

    it('should handle non-Error throw from handler', async () => {
      processManager.start.mockRejectedValue('string error');

      const socket = await connectSocket();

      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'test-16b',
        method: 'process.start',
        params: { name: 'crash-app', script: 'crash.js' },
      };
      simulateClientMessage(socket, request);
      const response = await getResponse(socket);

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
      expect(response.error!.message).toBe('string error');
    });
  });

  describe('connection management', () => {
    it('should handle multiple messages in one data chunk', async () => {
      await server.start();
      const socket = new MockSocket();
      const mockServer = getMockServer();
      mockServer._connectionHandler!(socket);

      const msg1: IPCRequest = { jsonrpc: '2.0', id: 'multi-1', method: 'daemon.ping' };
      const msg2: IPCRequest = { jsonrpc: '2.0', id: 'multi-2', method: 'daemon.version' };
      const combined = serializeMessage(msg1) + serializeMessage(msg2);

      socket.emit('data', Buffer.from(combined));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(socket.written.length).toBe(2);
      const resp1 = JSON.parse(socket.written[0].trim()) as IPCResponse;
      const resp2 = JSON.parse(socket.written[1].trim()) as IPCResponse;
      expect(resp1.id).toBe('multi-1');
      expect(resp2.id).toBe('multi-2');
    });

    it('should handle messages split across multiple data chunks', async () => {
      await server.start();
      const socket = new MockSocket();
      const mockServer = getMockServer();
      mockServer._connectionHandler!(socket);

      const msg: IPCRequest = { jsonrpc: '2.0', id: 'split-1', method: 'daemon.ping' };
      const fullMsg = serializeMessage(msg);
      const midpoint = Math.floor(fullMsg.length / 2);

      // Send first half
      socket.emit('data', Buffer.from(fullMsg.substring(0, midpoint)));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(socket.written.length).toBe(0); // No response yet

      // Send second half
      socket.emit('data', Buffer.from(fullMsg.substring(midpoint)));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(socket.written.length).toBe(1);

      const response = JSON.parse(socket.written[0].trim()) as IPCResponse;
      expect(response.id).toBe('split-1');
    });

    it('should skip empty lines in data', async () => {
      await server.start();
      const socket = new MockSocket();
      const mockServer = getMockServer();
      mockServer._connectionHandler!(socket);

      const msg: IPCRequest = { jsonrpc: '2.0', id: 'empty-1', method: 'daemon.ping' };
      const data = '\n\n' + serializeMessage(msg);
      socket.emit('data', Buffer.from(data));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(socket.written.length).toBe(1);
    });

    it('should handle socket close events', async () => {
      await server.start();
      const socket = new MockSocket();
      const mockServer = getMockServer();
      mockServer._connectionHandler!(socket);

      // Socket close should not throw
      socket.emit('close');
    });

    it('should handle socket error events', async () => {
      await server.start();
      const socket = new MockSocket();
      const mockServer = getMockServer();
      mockServer._connectionHandler!(socket);

      // Socket error should not throw
      socket.emit('error', new Error('Connection reset'));
    });

    it('should handle invalid JSON gracefully', async () => {
      await server.start();
      const socket = new MockSocket();
      const mockServer = getMockServer();
      mockServer._connectionHandler!(socket);

      socket.emit('data', Buffer.from('not-json\n'));
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Should not crash and should not write any response for unparseable data
      expect(socket.written.length).toBe(0);
    });

    it('should send invalid params error for malformed request', async () => {
      await server.start();
      const socket = new MockSocket();
      const mockServer = getMockServer();
      mockServer._connectionHandler!(socket);

      // Valid JSON but invalid request structure (method not in enum)
      const data =
        JSON.stringify({ jsonrpc: '2.0', id: 'bad-1', method: 'not-a-valid-method' }) + '\n';
      socket.emit('data', Buffer.from(data));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(socket.written.length).toBe(1);
      const response = JSON.parse(socket.written[0].trim()) as IPCResponse;
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(IPC_ERROR_CODES.INVALID_PARAMS);
      expect(response.error!.message).toBe('Invalid request format');
    });
  });

  describe('setStopHandler', () => {
    it('should set the stop handler', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      server.setStopHandler(handler);
      // The handler is stored internally; we verify it's called through daemon.stop
    });
  });
});
