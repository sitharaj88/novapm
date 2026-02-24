import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state -- vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------
const { getLatestMockWs, setLatestMockWs, MockWebSocketClass } = vi.hoisted(() => {
  // We build the mock WS class inside vi.hoisted so it is available
  // when the vi.mock factory for 'ws' runs (which is also hoisted).
  const { EventEmitter: EE } = require('node:events') as typeof import('node:events');

  let _latestMockWs: InstanceType<typeof _MockWebSocket> | null = null;

  class _MockWebSocket extends EE {
    static OPEN = 1;
    static CLOSED = 3;
    readyState: number = 1; // OPEN

    send = vi.fn();
    close = vi.fn((_code?: number, _reason?: string) => {
      this.readyState = 3; // CLOSED
    });

    simulateOpen(): void {
      this.readyState = 1;
      this.emit('open');
    }

    simulateMessage(data: unknown): void {
      this.emit('message', JSON.stringify(data));
    }

    simulateClose(code = 1000, reason = ''): void {
      this.readyState = 3;
      this.emit('close', code, Buffer.from(reason));
    }

    simulateError(err: Error): void {
      this.emit('error', err);
    }
  }

  return {
    MockWebSocketClass: _MockWebSocket,
    getLatestMockWs: () => _latestMockWs!,
    setLatestMockWs: (ws: InstanceType<typeof _MockWebSocket>) => {
      _latestMockWs = ws;
    },
  };
});

// ---------------------------------------------------------------------------
// vi.mock declarations (factories use only hoisted values)
// ---------------------------------------------------------------------------
vi.mock('ws', () => {
  return {
    WebSocket: class extends MockWebSocketClass {
      constructor(_url: string) {
        super();
        setLatestMockWs(this);
      }

      static OPEN = 1;
      static CLOSED = 3;
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
  NOVA_VERSION: '1.0.0-test',
  DEFAULT_AGENT_PORT: 9616,
}));

// Import the module under test *after* mocks are installed
import { Agent } from '../Agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createAgent(overrides: Record<string, unknown> = {}): Agent {
  return new Agent({
    controllerHost: '127.0.0.1',
    controllerPort: 9000,
    heartbeatInterval: 60_000, // long interval so it doesn't fire during tests
    reconnectInterval: 100,
    maxReconnectAttempts: 3,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---- Construction -------------------------------------------------------

  describe('construction', () => {
    it('should create an agent with required config', () => {
      const agent = createAgent();
      expect(agent).toBeInstanceOf(Agent);
      expect(agent.getId()).toMatch(/^agent-/);
    });

    it('should use provided controllerId when given', () => {
      const agent = createAgent({ controllerId: 'my-custom-id' });
      expect(agent.getId()).toBe('my-custom-id');
    });

    it('should default to not connected', () => {
      const agent = createAgent();
      expect(agent.isConnected()).toBe(false);
    });
  });

  // ---- Start / Stop lifecycle ---------------------------------------------

  describe('start / stop lifecycle', () => {
    it('should connect to the controller via WebSocket on start', async () => {
      const agent = createAgent();
      const startPromise = agent.start();

      getLatestMockWs().simulateOpen();

      await startPromise;
      expect(agent.isConnected()).toBe(true);
    });

    it('should emit "connected" event on successful start', async () => {
      const agent = createAgent();
      const connectedSpy = vi.fn();
      agent.on('connected', connectedSpy);

      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      expect(connectedSpy).toHaveBeenCalledOnce();
    });

    it('should send a register message upon connection', async () => {
      const agent = createAgent();
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const ws = getLatestMockWs();
      expect(ws.send).toHaveBeenCalled();
      const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('register');
      expect(sent.data).toHaveProperty('serverInfo');
    });

    it('should include auth token in register message when configured', async () => {
      const agent = createAgent({ auth: { token: 'secret-token-123' } });
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const ws = getLatestMockWs();
      const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('register');
      expect(sent.data.token).toBe('secret-token-123');
    });

    it('should stop gracefully and emit "stopped"', async () => {
      const agent = createAgent();
      const stoppedSpy = vi.fn();
      agent.on('stopped', stoppedSpy);

      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const stopPromise = agent.stop();
      vi.advanceTimersByTime(600);
      await stopPromise;

      expect(agent.isConnected()).toBe(false);
      expect(stoppedSpy).toHaveBeenCalledOnce();
    });

    it('should send a disconnect message before closing', async () => {
      const agent = createAgent();
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const ws = getLatestMockWs();
      ws.send.mockClear();

      const stopPromise = agent.stop();
      vi.advanceTimersByTime(600);
      await stopPromise;

      expect(ws.send).toHaveBeenCalled();
      const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('disconnect');
    });

    it('should handle stop when not connected', async () => {
      const agent = createAgent();
      await expect(agent.stop()).resolves.toBeUndefined();
    });
  });

  // ---- Heartbeat ----------------------------------------------------------

  describe('heartbeat', () => {
    it('should send periodic heartbeats after connecting', async () => {
      const agent = createAgent({ heartbeatInterval: 1_000 });
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const ws = getLatestMockWs();
      ws.send.mockClear();

      vi.advanceTimersByTime(1_000);

      expect(ws.send).toHaveBeenCalled();
      const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('heartbeat');
      expect(sent.data).toHaveProperty('serverInfo');
      expect(sent.data).toHaveProperty('processes');
    });

    it('should not send heartbeat when disconnected', async () => {
      const agent = createAgent({ heartbeatInterval: 1_000 });
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const ws = getLatestMockWs();
      const stopPromise = agent.stop();
      vi.advanceTimersByTime(600);
      await stopPromise;

      ws.send.mockClear();

      vi.advanceTimersByTime(2_000);
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  // ---- Status reporting ---------------------------------------------------

  describe('status reporting', () => {
    it('should report server info with system metrics in heartbeat', async () => {
      const agent = createAgent({ heartbeatInterval: 1_000 });
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const ws = getLatestMockWs();
      ws.send.mockClear();
      vi.advanceTimersByTime(1_000);

      const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
      const serverInfo = sent.data.serverInfo;
      expect(serverInfo).toHaveProperty('id');
      expect(serverInfo).toHaveProperty('hostname');
      expect(serverInfo).toHaveProperty('address');
      expect(serverInfo).toHaveProperty('port');
      expect(serverInfo).toHaveProperty('status', 'online');
      expect(serverInfo).toHaveProperty('metadata');
      expect(serverInfo.metadata).toHaveProperty('platform');
      expect(serverInfo.metadata).toHaveProperty('arch');
      expect(serverInfo.metadata).toHaveProperty('cpuCount');
      expect(serverInfo.metadata).toHaveProperty('memoryTotal');
      expect(serverInfo).toHaveProperty('cpuUsage');
      expect(serverInfo).toHaveProperty('memoryUsage');
    });
  });

  // ---- Command handling ---------------------------------------------------

  describe('command handling', () => {
    it('should execute a registered command handler and return result', async () => {
      const agent = createAgent();
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      agent.registerCommandHandler('test.echo', async (params) => {
        return { echo: params };
      });

      const ws = getLatestMockWs();
      ws.send.mockClear();

      ws.simulateMessage({
        type: 'command',
        agentId: 'controller',
        timestamp: new Date().toISOString(),
        data: {
          command: 'test.echo',
          params: { msg: 'hello' },
          requestId: 'req-1',
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(ws.send).toHaveBeenCalled();
      const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('command-result');
      expect(sent.data.requestId).toBe('req-1');
      expect(sent.data.success).toBe(true);
      expect(sent.data.result).toEqual({ echo: { msg: 'hello' } });
    });

    it('should return an error for an unknown command', async () => {
      const agent = createAgent();
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const ws = getLatestMockWs();
      ws.send.mockClear();

      ws.simulateMessage({
        type: 'command',
        agentId: 'controller',
        timestamp: new Date().toISOString(),
        data: {
          command: 'unknown.cmd',
          params: {},
          requestId: 'req-2',
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(ws.send).toHaveBeenCalled();
      const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('command-result');
      expect(sent.data.success).toBe(false);
      expect(sent.data.error).toContain('Unknown command');
    });

    it('should handle command handler that throws', async () => {
      const agent = createAgent();
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      agent.registerCommandHandler('test.fail', async () => {
        throw new Error('handler exploded');
      });

      const ws = getLatestMockWs();
      ws.send.mockClear();

      ws.simulateMessage({
        type: 'command',
        agentId: 'controller',
        timestamp: new Date().toISOString(),
        data: {
          command: 'test.fail',
          params: {},
          requestId: 'req-3',
        },
      });

      await vi.advanceTimersByTimeAsync(0);

      const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(sent.data.success).toBe(false);
      expect(sent.data.error).toBe('handler exploded');
    });
  });

  // ---- Metrics buffer -----------------------------------------------------

  describe('metrics buffer', () => {
    it('should buffer pushed metrics', () => {
      const agent = createAgent();
      agent.pushMetric({ cpu: 50 });
      agent.pushMetric({ cpu: 60 });
      // No assertion on internal buffer directly; tested via flushMetrics
    });

    it('should flush metrics when connected', async () => {
      const agent = createAgent();
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      agent.pushMetric({ cpu: 50 });
      agent.pushMetric({ cpu: 60 });

      const ws = getLatestMockWs();
      ws.send.mockClear();
      agent.flushMetrics();

      expect(ws.send).toHaveBeenCalledOnce();
      const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('metrics');
      expect(sent.data.metrics).toHaveLength(2);
    });

    it('should not flush metrics when disconnected', () => {
      const agent = createAgent();
      agent.pushMetric({ cpu: 50 });
      agent.flushMetrics();
      // No error thrown means it gracefully handled the case
    });

    it('should auto-flush when buffer reaches 100 items', async () => {
      const agent = createAgent();
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const ws = getLatestMockWs();
      ws.send.mockClear();

      for (let i = 0; i < 100; i++) {
        agent.pushMetric({ cpu: i });
      }

      expect(ws.send).toHaveBeenCalled();
      const sent = JSON.parse(ws.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('metrics');
      expect(sent.data.metrics).toHaveLength(100);
    });
  });

  // ---- Reconnection -------------------------------------------------------

  describe('reconnection', () => {
    it('should attempt to reconnect on unexpected disconnect', async () => {
      const agent = createAgent({ reconnectInterval: 100, maxReconnectAttempts: 3 });
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const disconnectedSpy = vi.fn();
      agent.on('disconnected', disconnectedSpy);

      getLatestMockWs().simulateClose(1006, 'abnormal closure');

      expect(disconnectedSpy).toHaveBeenCalledOnce();
      expect(agent.isConnected()).toBe(false);
    });

    it('should emit "reconnect-failed" after max attempts', async () => {
      const agent = createAgent({
        reconnectInterval: 100,
        maxReconnectAttempts: 1,
      });
      const reconnectFailedSpy = vi.fn();
      agent.on('reconnect-failed', reconnectFailedSpy);

      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      // First disconnect triggers reconnect attempt #1
      getLatestMockWs().simulateClose(1006, 'lost');

      // Advance past the reconnect delay
      vi.advanceTimersByTime(200);

      // The new WebSocket was created; simulate it also closing
      getLatestMockWs().simulateClose(1006, 'lost again');

      expect(reconnectFailedSpy).toHaveBeenCalledOnce();
    });

    it('should not reconnect after explicit stop', async () => {
      const agent = createAgent({ reconnectInterval: 100, maxReconnectAttempts: 5 });
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const stopPromise = agent.stop();
      vi.advanceTimersByTime(600);
      await stopPromise;

      const reconnectFailedSpy = vi.fn();
      agent.on('reconnect-failed', reconnectFailedSpy);
      vi.advanceTimersByTime(60_000);
      expect(reconnectFailedSpy).not.toHaveBeenCalled();
    });
  });

  // ---- Error handling -----------------------------------------------------

  describe('error handling', () => {
    it('should emit error on WebSocket error', async () => {
      const agent = createAgent();
      const errorSpy = vi.fn();
      agent.on('error', errorSpy);

      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      getLatestMockWs().simulateError(new Error('socket fail'));
      expect(errorSpy).toHaveBeenCalledOnce();
      expect(errorSpy.mock.calls[0][0].message).toBe('socket fail');
    });

    it('should handle malformed incoming messages gracefully', async () => {
      const agent = createAgent();
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      // Send non-JSON string -- should not throw
      getLatestMockWs().emit('message', 'not valid json');
    });

    it('should not send messages when WebSocket is not open', async () => {
      const agent = createAgent();
      const startPromise = agent.start();
      getLatestMockWs().simulateOpen();
      await startPromise;

      const ws = getLatestMockWs();
      ws.readyState = 3; // CLOSED
      ws.send.mockClear();

      agent.pushMetric({ cpu: 1 });
      agent.flushMetrics();

      expect(ws.send).not.toHaveBeenCalled();
    });
  });
});
