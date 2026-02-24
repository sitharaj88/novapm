import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------
const { MockWsClass } = vi.hoisted(() => {
  const { EventEmitter: EE } = require('node:events') as typeof import('node:events');

  class _MockWs extends EE {
    static OPEN = 1;
    static CLOSED = 3;
    readyState: number = 1;
    send = vi.fn();
    close = vi.fn((_code?: number, _reason?: string) => {
      this.readyState = 3;
    });
  }

  return { MockWsClass: _MockWs };
});

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------
vi.mock('ws', () => {
  const { EventEmitter: EE } = require('node:events') as typeof import('node:events');

  class _MockWebSocketServer extends EE {
    constructor(_opts: unknown) {
      super();
      setTimeout(() => {
        this.emit('listening');
      }, 0);
    }

    close(cb?: () => void): void {
      if (cb) cb();
    }
  }

  return {
    WebSocketServer: _MockWebSocketServer,
    WebSocket: {
      OPEN: 1,
      CLOSED: 3,
    },
  };
});

vi.mock('@novapm/shared', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../SecureChannel.js', () => ({
  SecureChannel: {
    verifyToken: vi.fn((token: string, validTokens: string[]) => {
      return validTokens.includes(token);
    }),
  },
}));

// Import after mocks
import { Controller } from '../Controller.js';
import type { AgentMessage, ServerInfo } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockWs = InstanceType<typeof MockWsClass>;

function createMockWs(): MockWs {
  return new MockWsClass();
}

function createController(overrides: Record<string, unknown> = {}): Controller {
  return new Controller({
    port: 9100,
    host: '127.0.0.1',
    ...overrides,
  });
}

function makeServerInfo(overrides: Partial<ServerInfo> = {}): ServerInfo {
  return {
    id: 'agent-test-1',
    hostname: 'test-host',
    address: '192.168.1.10',
    port: 9616,
    status: 'online',
    lastHeartbeat: new Date(),
    metadata: {
      platform: 'linux',
      arch: 'x64',
      cpuCount: 4,
      memoryTotal: 16_000_000_000,
      novaVersion: '1.0.0',
    },
    processes: 5,
    cpuUsage: 25.5,
    memoryUsage: 60.3,
    ...overrides,
  };
}

function makeRegisterMessage(agentId: string, token?: string): string {
  const msg: AgentMessage = {
    type: 'register',
    agentId,
    timestamp: new Date().toISOString(),
    data: {
      serverInfo: makeServerInfo({ id: agentId }),
      token,
    },
  };
  return JSON.stringify(msg);
}

function makeHeartbeatMessage(agentId: string): string {
  const msg: AgentMessage = {
    type: 'heartbeat',
    agentId,
    timestamp: new Date().toISOString(),
    data: {
      serverInfo: makeServerInfo({ id: agentId }),
      processes: [
        {
          id: 1,
          name: 'app',
          status: 'online',
          cpu: 10,
          memory: 50_000_000,
          uptime: 3600,
          restarts: 0,
        },
      ],
    },
  };
  return JSON.stringify(msg);
}

function makeCommandResultMessage(
  agentId: string,
  requestId: string,
  success: boolean,
  result: unknown = null,
  error?: string,
): string {
  const msg: AgentMessage = {
    type: 'command-result',
    agentId,
    timestamp: new Date().toISOString(),
    data: { requestId, success, result, error },
  };
  return JSON.stringify(msg);
}

/** Start the controller and wait for the 'listening' event to fire. */
async function startController(controller: Controller): Promise<void> {
  const startPromise = controller.start();
  await vi.advanceTimersByTimeAsync(10);
  await startPromise;
}

/** Access the internal WSS to simulate connections. */
function getWss(controller: Controller): EventEmitter {
  return (controller as unknown as { wss: EventEmitter }).wss;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---- Start / Stop -------------------------------------------------------

  describe('start / stop', () => {
    it('should start the WebSocket server and emit "started"', async () => {
      const controller = createController();
      const startedSpy = vi.fn();
      controller.on('started', startedSpy);

      await startController(controller);

      expect(startedSpy).toHaveBeenCalledOnce();
    });

    it('should stop and emit "stopped"', async () => {
      const controller = createController();
      const stoppedSpy = vi.fn();
      controller.on('stopped', stoppedSpy);

      await startController(controller);
      await controller.stop();

      expect(stoppedSpy).toHaveBeenCalledOnce();
    });

    it('should resolve stop even when no server is running', async () => {
      const controller = createController();
      await expect(controller.stop()).resolves.toBeUndefined();
    });
  });

  // ---- Agent registration -------------------------------------------------

  describe('agent registration', () => {
    it('should register an agent and emit "agent:join"', async () => {
      const controller = createController();
      const joinSpy = vi.fn();
      controller.on('agent:join', joinSpy);

      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));

      expect(joinSpy).toHaveBeenCalledOnce();
      expect(joinSpy.mock.calls[0][0].id).toBe('agent-1');
      expect(controller.getAgentCount()).toBe(1);
    });

    it('should reject agent with invalid token when auth is configured', async () => {
      const controller = createController({
        auth: { tokens: ['valid-token-abc'] },
      });

      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-bad', 'wrong-token'));

      expect(mockWs.close).toHaveBeenCalledWith(4001, 'Authentication failed');
      expect(controller.getAgentCount()).toBe(0);
    });

    it('should accept agent with valid token when auth is configured', async () => {
      const controller = createController({
        auth: { tokens: ['valid-token-abc'] },
      });

      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-ok', 'valid-token-abc'));

      expect(controller.getAgentCount()).toBe(1);
    });

    it('should allow registration when no auth is configured', async () => {
      const controller = createController();

      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-noauth'));

      expect(controller.getAgentCount()).toBe(1);
    });
  });

  // ---- Agent removal / disconnect -----------------------------------------

  describe('agent removal', () => {
    it('should remove agent on disconnect message and emit "agent:leave"', async () => {
      const controller = createController();
      const leaveSpy = vi.fn();
      controller.on('agent:leave', leaveSpy);

      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));
      expect(controller.getAgentCount()).toBe(1);

      const disconnectMsg: AgentMessage = {
        type: 'disconnect',
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
        data: { reason: 'shutdown' },
      };
      mockWs.emit('message', JSON.stringify(disconnectMsg));

      expect(leaveSpy).toHaveBeenCalledOnce();
      expect(leaveSpy.mock.calls[0][0].status).toBe('offline');
      expect(controller.getAgentCount()).toBe(0);
    });

    it('should remove agent when WebSocket connection closes', async () => {
      const controller = createController();
      const leaveSpy = vi.fn();
      controller.on('agent:leave', leaveSpy);

      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));

      mockWs.emit('close');

      expect(leaveSpy).toHaveBeenCalled();
      expect(controller.getAgentCount()).toBe(0);
    });
  });

  // ---- Command distribution -----------------------------------------------

  describe('command distribution', () => {
    it('should send a command to a specific agent and resolve with result', async () => {
      const controller = createController();
      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));

      const cmdPromise = controller.sendCommand('agent-1', 'process.restart', { name: 'app' });

      const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      const requestId = sentMsg.data.requestId;

      mockWs.emit(
        'message',
        makeCommandResultMessage('agent-1', requestId, true, { restarted: true }),
      );

      const result = await cmdPromise;
      expect(result).toEqual({ restarted: true });
    });

    it('should reject when agent is not found', async () => {
      const controller = createController();
      await startController(controller);

      await expect(controller.sendCommand('nonexistent', 'test', {})).rejects.toThrow(
        'Agent not found: nonexistent',
      );
    });

    it('should reject on command timeout', async () => {
      const controller = createController();
      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));

      const cmdPromise = controller.sendCommand('agent-1', 'slow.cmd', {}, 1_000);

      vi.advanceTimersByTime(1_100);

      await expect(cmdPromise).rejects.toThrow('Command timeout');
    });

    it('should reject command when agent result indicates failure', async () => {
      const controller = createController();
      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));

      const cmdPromise = controller.sendCommand('agent-1', 'fail.cmd', {});
      const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      const requestId = sentMsg.data.requestId;

      mockWs.emit('message', makeCommandResultMessage('agent-1', requestId, false, null, 'oops'));

      await expect(cmdPromise).rejects.toThrow('oops');
    });

    it('should broadcast commands to all connected agents', async () => {
      const controller = createController();
      await startController(controller);

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      getWss(controller).emit('connection', ws1);
      ws1.emit('message', makeRegisterMessage('agent-1'));
      getWss(controller).emit('connection', ws2);
      ws2.emit('message', makeRegisterMessage('agent-2'));

      expect(controller.getAgentCount()).toBe(2);

      const broadcastPromise = controller.broadcastCommand('status', {}, 2_000);

      const sent1 = JSON.parse(ws1.send.mock.calls[0][0] as string);
      ws1.emit(
        'message',
        makeCommandResultMessage('agent-1', sent1.data.requestId, true, { ok: 1 }),
      );

      const sent2 = JSON.parse(ws2.send.mock.calls[0][0] as string);
      ws2.emit(
        'message',
        makeCommandResultMessage('agent-2', sent2.data.requestId, true, { ok: 2 }),
      );

      const results = await broadcastPromise;
      expect(results.size).toBe(2);
      expect(results.get('agent-1')).toEqual({ ok: 1 });
      expect(results.get('agent-2')).toEqual({ ok: 2 });
    });
  });

  // ---- Agent health monitoring --------------------------------------------

  describe('agent health monitoring', () => {
    it('should update lastSeen on heartbeat', async () => {
      const controller = createController();
      const heartbeatSpy = vi.fn();
      controller.on('agent:heartbeat', heartbeatSpy);

      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));

      mockWs.emit('message', makeHeartbeatMessage('agent-1'));

      expect(heartbeatSpy).toHaveBeenCalledOnce();
      expect(heartbeatSpy.mock.calls[0][0].agentId).toBe('agent-1');
    });

    it('should handle heartbeat from unknown agent gracefully', async () => {
      const controller = createController();
      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);

      mockWs.emit('message', makeHeartbeatMessage('ghost-agent'));

      expect(controller.getAgentCount()).toBe(0);
    });

    it('should handle metrics from agents', async () => {
      const controller = createController();
      const metricsSpy = vi.fn();
      controller.on('agent:metrics', metricsSpy);

      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));

      const metricsMsg: AgentMessage = {
        type: 'metrics',
        agentId: 'agent-1',
        timestamp: new Date().toISOString(),
        data: { metrics: [{ cpu: 42 }] },
      };
      mockWs.emit('message', JSON.stringify(metricsMsg));

      expect(metricsSpy).toHaveBeenCalledOnce();
      expect(metricsSpy.mock.calls[0][0].agentId).toBe('agent-1');
    });
  });

  // ---- Agent querying -----------------------------------------------------

  describe('agent querying', () => {
    it('should return agent list via getAgents()', async () => {
      const controller = createController();
      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));

      const agents = controller.getAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('agent-1');
    });

    it('should return specific agent via getAgent()', async () => {
      const controller = createController();
      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));

      expect(controller.getAgent('agent-1')).not.toBeNull();
      expect(controller.getAgent('nonexistent')).toBeNull();
    });

    it('should return correct agent count', async () => {
      const controller = createController();
      await startController(controller);

      expect(controller.getAgentCount()).toBe(0);

      const ws1 = createMockWs();
      getWss(controller).emit('connection', ws1);
      ws1.emit('message', makeRegisterMessage('a1'));

      const ws2 = createMockWs();
      getWss(controller).emit('connection', ws2);
      ws2.emit('message', makeRegisterMessage('a2'));

      expect(controller.getAgentCount()).toBe(2);
    });
  });

  // ---- Deployment tracking ------------------------------------------------

  describe('deployment tracking', () => {
    it('should store and retrieve deployment plans', async () => {
      const controller = createController();
      await startController(controller);

      const plan = {
        id: 'dep-1',
        strategy: 'rolling' as const,
        servers: ['s1', 's2'],
        config: {},
        status: 'pending' as const,
        currentStep: 0,
        totalSteps: 2,
        errors: [],
      };

      controller.addDeployment(plan);
      expect(controller.getDeployment('dep-1')).toEqual(plan);
      expect(controller.getDeployment('nonexistent')).toBeNull();
      expect(controller.getDeployments()).toHaveLength(1);
    });
  });

  // ---- Shutdown cleanup ---------------------------------------------------

  describe('shutdown cleanup', () => {
    it('should close all agent connections on stop', async () => {
      const controller = createController();
      await startController(controller);

      const ws1 = createMockWs();
      getWss(controller).emit('connection', ws1);
      ws1.emit('message', makeRegisterMessage('a1'));

      await controller.stop();

      expect(ws1.close).toHaveBeenCalled();
      expect(controller.getAgentCount()).toBe(0);
    });

    it('should reject pending commands on stop', async () => {
      const controller = createController();
      await startController(controller);

      const mockWs = createMockWs();
      getWss(controller).emit('connection', mockWs);
      mockWs.emit('message', makeRegisterMessage('agent-1'));

      const cmdPromise = controller.sendCommand('agent-1', 'test', {});

      await controller.stop();

      await expect(cmdPromise).rejects.toThrow('Controller shutting down');
    });
  });
});
