import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  ProcessNotFoundError,
  ProcessAlreadyExistsError,
  ProcessNotRunningError,
} from '@novapm/shared';
import { registerProcessRoutes } from '../api/routes/processes.js';
import { registerMetricRoutes } from '../api/routes/metrics.js';
import { registerLogRoutes } from '../api/routes/logs.js';
import { registerServerRoutes } from '../api/routes/servers.js';

// --- Mock factories ---

function createMockProcessManager() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    delete: vi.fn(),
    list: vi.fn().mockReturnValue([]),
    info: vi.fn(),
  };
}

function createMockMetricsCollector() {
  return {
    getLatest: vi.fn().mockReturnValue(null),
    getAllLatest: vi.fn().mockReturnValue(new Map()),
  };
}

function createMockSystemMetrics() {
  return {
    getLatest: vi.fn().mockReturnValue({
      hostname: 'test-host',
      cpuUsage: 25,
      memoryUsed: 4000000000,
      memoryTotal: 8000000000,
    }),
  };
}

function createMockMetricsRepo() {
  return {
    getRange: vi.fn().mockReturnValue([]),
    getLatest: vi.fn(),
    insert: vi.fn(),
  };
}

function createMockLogAggregator() {
  return {
    getRecentLogs: vi.fn().mockReturnValue([]),
    getAllRecentLogs: vi.fn().mockReturnValue([]),
  };
}

// --- Process Routes Tests ---

describe('Process Routes', () => {
  let app: FastifyInstance;
  let processManager: ReturnType<typeof createMockProcessManager>;
  let metricsCollector: ReturnType<typeof createMockMetricsCollector>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    processManager = createMockProcessManager();
    metricsCollector = createMockMetricsCollector();
    registerProcessRoutes(app, processManager as never, metricsCollector as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/processes', () => {
    it('should return an empty array when no processes exist', async () => {
      processManager.list.mockReturnValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/processes',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it('should return processes with their metrics', async () => {
      processManager.list.mockReturnValue([
        { id: 1, name: 'app-1', status: 'online' },
        { id: 2, name: 'app-2', status: 'stopped' },
      ]);
      metricsCollector.getLatest.mockImplementation((id: number) => {
        if (id === 1) return { cpu: 15, memory: 50000 };
        return null;
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/processes',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveLength(2);
      expect(body[0].metrics).toEqual({ cpu: 15, memory: 50000 });
      expect(body[1].metrics).toBeNull();
    });
  });

  describe('GET /api/v1/processes/:id', () => {
    it('should return a process by numeric id', async () => {
      processManager.info.mockReturnValue({
        id: 1,
        name: 'app-1',
        status: 'online',
      });
      metricsCollector.getLatest.mockReturnValue({ cpu: 10, memory: 30000 });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/processes/1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(1);
      expect(body.name).toBe('app-1');
      expect(body.metrics).toEqual({ cpu: 10, memory: 30000 });
      expect(processManager.info).toHaveBeenCalledWith(1);
    });

    it('should look up by name when id is not a number', async () => {
      processManager.info.mockReturnValue({
        id: 1,
        name: 'my-app',
        status: 'online',
      });
      metricsCollector.getLatest.mockReturnValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/processes/my-app',
      });

      expect(response.statusCode).toBe(200);
      expect(processManager.info).toHaveBeenCalledWith('my-app');
    });

    it('should return 404 when process is not found', async () => {
      processManager.info.mockImplementation(() => {
        throw new ProcessNotFoundError(999);
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/processes/999',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBeDefined();
    });

    it('should return 404 with default message for non-Error throws', async () => {
      processManager.info.mockImplementation(() => {
        throw 'some string';
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/processes/1',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('Process not found');
    });
  });

  describe('POST /api/v1/processes', () => {
    it('should start a new process and return 201', async () => {
      const newProcess = { id: 1, name: 'my-app', status: 'online' };
      processManager.start.mockResolvedValue(newProcess);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/processes',
        payload: { name: 'my-app', script: 'index.js' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual(newProcess);
      expect(processManager.start).toHaveBeenCalledWith({
        name: 'my-app',
        script: 'index.js',
      });
    });

    it('should return 409 when process already exists', async () => {
      processManager.start.mockRejectedValue(new ProcessAlreadyExistsError('my-app'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/processes',
        payload: { name: 'my-app', script: 'index.js' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toContain('already exists');
    });

    it('should return 400 for other start errors', async () => {
      processManager.start.mockRejectedValue(new Error('Script not found'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/processes',
        payload: { name: 'my-app', script: 'nonexistent.js' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Script not found');
    });

    it('should return 400 with default message for non-Error throws', async () => {
      processManager.start.mockRejectedValue('string error');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/processes',
        payload: { name: 'my-app', script: 'index.js' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Failed to start process');
    });
  });

  describe('PUT /api/v1/processes/:id/restart', () => {
    it('should restart a process and return ok', async () => {
      processManager.restart.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/processes/1/restart',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
      expect(processManager.restart).toHaveBeenCalledWith(1);
    });

    it('should restart by name when id is not numeric', async () => {
      processManager.restart.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/processes/my-app/restart',
      });

      expect(response.statusCode).toBe(200);
      expect(processManager.restart).toHaveBeenCalledWith('my-app');
    });

    it('should return 404 when process is not found', async () => {
      processManager.restart.mockRejectedValue(new ProcessNotFoundError(999));

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/processes/999/restart',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Process not found');
    });

    it('should return 400 for other errors', async () => {
      processManager.restart.mockRejectedValue(new Error('Restart failed'));

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/processes/1/restart',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Restart failed');
    });
  });

  describe('PUT /api/v1/processes/:id/stop', () => {
    it('should stop a process and return ok', async () => {
      processManager.stop.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/processes/1/stop',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
      expect(processManager.stop).toHaveBeenCalledWith(1);
    });

    it('should stop by name when id is not numeric', async () => {
      processManager.stop.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/processes/my-app/stop',
      });

      expect(response.statusCode).toBe(200);
      expect(processManager.stop).toHaveBeenCalledWith('my-app');
    });

    it('should return 404 when process is not found', async () => {
      processManager.stop.mockRejectedValue(new ProcessNotFoundError(999));

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/processes/999/stop',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Process not found');
    });

    it('should return 409 when process is not running', async () => {
      processManager.stop.mockRejectedValue(new ProcessNotRunningError(1));

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/processes/1/stop',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toContain('not running');
    });

    it('should return 400 for other errors', async () => {
      processManager.stop.mockRejectedValue(new Error('Kill failed'));

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/processes/1/stop',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Kill failed');
    });

    it('should return 400 with default message for non-Error throws', async () => {
      processManager.stop.mockRejectedValue('string error');

      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/processes/1/stop',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Failed to stop process');
    });
  });

  describe('DELETE /api/v1/processes/:id', () => {
    it('should delete a process and return ok', async () => {
      processManager.delete.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/processes/1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
      expect(processManager.delete).toHaveBeenCalledWith(1);
    });

    it('should delete by name when id is not numeric', async () => {
      processManager.delete.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/processes/my-app',
      });

      expect(response.statusCode).toBe(200);
      expect(processManager.delete).toHaveBeenCalledWith('my-app');
    });

    it('should return 404 when process is not found', async () => {
      processManager.delete.mockRejectedValue(new ProcessNotFoundError(999));

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/processes/999',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('Process not found');
    });

    it('should return 400 for other errors', async () => {
      processManager.delete.mockRejectedValue(new Error('Delete failed'));

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/processes/1',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Delete failed');
    });
  });
});

// --- Metric Routes Tests ---

describe('Metric Routes', () => {
  let app: FastifyInstance;
  let metricsCollector: ReturnType<typeof createMockMetricsCollector>;
  let systemMetrics: ReturnType<typeof createMockSystemMetrics>;
  let metricsRepo: ReturnType<typeof createMockMetricsRepo>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    metricsCollector = createMockMetricsCollector();
    systemMetrics = createMockSystemMetrics();
    metricsRepo = createMockMetricsRepo();
    registerMetricRoutes(
      app,
      metricsCollector as never,
      systemMetrics as never,
      metricsRepo as never,
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/metrics', () => {
    it('should return empty object when no metrics exist', async () => {
      metricsCollector.getAllLatest.mockReturnValue(new Map());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/metrics',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({});
    });

    it('should return all latest process metrics', async () => {
      const metricsMap = new Map<number, Record<string, unknown>>();
      metricsMap.set(1, { cpu: 10, memory: 5000 });
      metricsMap.set(2, { cpu: 25, memory: 8000 });
      metricsCollector.getAllLatest.mockReturnValue(metricsMap);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/metrics',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body['1']).toEqual({ cpu: 10, memory: 5000 });
      expect(body['2']).toEqual({ cpu: 25, memory: 8000 });
    });
  });

  describe('GET /api/v1/metrics/:processId', () => {
    it('should return latest metrics for a process', async () => {
      metricsCollector.getLatest.mockReturnValue({ cpu: 15, memory: 50000 });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/metrics/1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ cpu: 15, memory: 50000 });
      expect(metricsCollector.getLatest).toHaveBeenCalledWith(1);
    });

    it('should return null when no metrics exist for process', async () => {
      metricsCollector.getLatest.mockReturnValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/metrics/999',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('null');
    });

    it('should query range when start and end query params are provided', async () => {
      const mockRange = [
        { cpu: 10, timestamp: 1705312800 },
        { cpu: 20, timestamp: 1705312860 },
      ];
      metricsRepo.getRange.mockReturnValue(mockRange);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/metrics/1?start=2025-01-15T10:00:00Z&end=2025-01-15T11:00:00Z',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockRange);
      expect(metricsRepo.getRange).toHaveBeenCalledWith(
        1,
        Math.floor(new Date('2025-01-15T10:00:00Z').getTime() / 1000),
        Math.floor(new Date('2025-01-15T11:00:00Z').getTime() / 1000),
      );
    });

    it('should fall through to latest when only start is provided', async () => {
      metricsCollector.getLatest.mockReturnValue({ cpu: 10 });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/metrics/1?start=2025-01-15T10:00:00Z',
      });

      expect(response.statusCode).toBe(200);
      expect(metricsCollector.getLatest).toHaveBeenCalledWith(1);
      expect(metricsRepo.getRange).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/system', () => {
    it('should return system metrics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/system',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.hostname).toBe('test-host');
      expect(body.cpuUsage).toBe(25);
      expect(systemMetrics.getLatest).toHaveBeenCalled();
    });
  });
});

// --- Log Routes Tests ---

describe('Log Routes', () => {
  let app: FastifyInstance;
  let logAggregator: ReturnType<typeof createMockLogAggregator>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    logAggregator = createMockLogAggregator();
    registerLogRoutes(app, logAggregator as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/logs/:processId', () => {
    it('should return recent logs for a process with default line count', async () => {
      const mockLogs = [
        { processId: 1, message: 'Hello', stream: 'stdout' },
        { processId: 1, message: 'World', stream: 'stdout' },
      ];
      logAggregator.getRecentLogs.mockReturnValue(mockLogs);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/logs/1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockLogs);
      expect(logAggregator.getRecentLogs).toHaveBeenCalledWith(1, 50);
    });

    it('should respect the lines query parameter', async () => {
      logAggregator.getRecentLogs.mockReturnValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/logs/1?lines=100',
      });

      expect(response.statusCode).toBe(200);
      expect(logAggregator.getRecentLogs).toHaveBeenCalledWith(1, 100);
    });

    it('should parse processId as integer', async () => {
      logAggregator.getRecentLogs.mockReturnValue([]);

      await app.inject({
        method: 'GET',
        url: '/api/v1/logs/42',
      });

      expect(logAggregator.getRecentLogs).toHaveBeenCalledWith(42, 50);
    });
  });

  describe('GET /api/v1/logs', () => {
    it('should return all recent logs with default line count', async () => {
      const mockLogs = [
        { processId: 1, message: 'App 1 log' },
        { processId: 2, message: 'App 2 log' },
      ];
      logAggregator.getAllRecentLogs.mockReturnValue(mockLogs);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/logs',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockLogs);
      expect(logAggregator.getAllRecentLogs).toHaveBeenCalledWith(50);
    });

    it('should respect the lines query parameter', async () => {
      logAggregator.getAllRecentLogs.mockReturnValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/logs?lines=200',
      });

      expect(response.statusCode).toBe(200);
      expect(logAggregator.getAllRecentLogs).toHaveBeenCalledWith(200);
    });
  });
});

// --- Server Routes Tests ---

describe('Server Routes', () => {
  let app: FastifyInstance;
  let mockController: {
    getConnectedAgents: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
  };
  let controllerRef: { current: typeof mockController | null };

  beforeEach(async () => {
    app = Fastify({ logger: false });
    mockController = {
      getConnectedAgents: vi.fn().mockReturnValue(new Map()),
      sendCommand: vi.fn(),
    };
    controllerRef = { current: mockController };
    registerServerRoutes(app, () => controllerRef.current);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/v1/servers', () => {
    it('should return empty array when controller is not available', async () => {
      controllerRef.current = null;

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/servers',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it('should return empty array when no agents are connected', async () => {
      mockController.getConnectedAgents.mockReturnValue(new Map());

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/servers',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });

    it('should return connected agents with all fields', async () => {
      const agents = new Map();
      agents.set('agent-1', {
        id: 'agent-1',
        hostname: 'server-1',
        address: '192.168.1.1',
        port: 9616,
        status: 'online',
        lastHeartbeat: new Date('2025-01-15T12:00:00Z'),
        cpuUsage: 30,
        memoryUsage: 65,
        processCount: 3,
        uptime: 86400,
        version: '0.1.0',
        processes: [{ id: 1, name: 'app', status: 'online', cpu: 10, memory: 50000 }],
        metadata: { region: 'us-east' },
      });
      mockController.getConnectedAgents.mockReturnValue(agents);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/servers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe('agent-1');
      expect(body[0].hostname).toBe('server-1');
      expect(body[0].status).toBe('online');
      expect(body[0].processCount).toBe(3);
      expect(body[0].processes).toHaveLength(1);
      expect(body[0].metadata).toEqual({ region: 'us-east' });
    });

    it('should default missing optional fields', async () => {
      const agents = new Map();
      agents.set('agent-1', {
        id: 'agent-1',
        hostname: 'server-1',
        address: '10.0.0.1',
        port: 9616,
        status: 'online',
        lastHeartbeat: new Date(),
        cpuUsage: 10,
        memoryUsage: 50,
        // Missing: processCount, uptime, version, processes, metadata
      });
      mockController.getConnectedAgents.mockReturnValue(agents);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/servers',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body[0].processCount).toBe(0);
      expect(body[0].uptime).toBe(0);
      expect(body[0].version).toBe('');
      expect(body[0].processes).toEqual([]);
      expect(body[0].metadata).toEqual({});
    });
  });

  describe('POST /api/v1/servers/:serverId/command', () => {
    it('should return 503 when controller is not available', async () => {
      controllerRef.current = null;

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/servers/agent-1/command',
        payload: { command: 'process.list' },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe('Controller not available');
    });

    it('should send command to agent and return result', async () => {
      mockController.sendCommand.mockResolvedValue({ processes: [{ id: 1 }] });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/servers/agent-1/command',
        payload: { command: 'process.list', args: { filter: 'online' } },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.result).toEqual({ processes: [{ id: 1 }] });
      expect(mockController.sendCommand).toHaveBeenCalledWith('agent-1', 'process.list', {
        filter: 'online',
      });
    });

    it('should return 400 when command fails', async () => {
      mockController.sendCommand.mockRejectedValue(new Error('Agent not connected'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/servers/agent-1/command',
        payload: { command: 'process.restart', args: { id: 1 } },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Agent not connected');
    });

    it('should return 400 with default message for non-Error throws', async () => {
      mockController.sendCommand.mockRejectedValue('string error');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/servers/agent-1/command',
        payload: { command: 'process.stop' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Command failed');
    });
  });
});
