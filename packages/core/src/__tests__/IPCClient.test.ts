import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IPCResponse } from '@novapm/shared';
import { IPCConnectionError, IPCTimeoutError } from '@novapm/shared';

// --- Mock setup ---

class MockSocket extends EventEmitter {
  destroyed = false;
  written: string[] = [];
  connectCallback: (() => void) | null = null;

  write(data: string): boolean {
    this.written.push(data);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

let mockSocket: MockSocket;
let existsSyncReturn = true;

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => existsSyncReturn),
}));

vi.mock('node:net', () => ({
  createConnection: vi.fn((path: string, callback: () => void) => {
    mockSocket = new MockSocket();
    mockSocket.connectCallback = callback;
    // Simulate connection in next tick
    process.nextTick(() => callback());
    return mockSocket;
  }),
}));

vi.mock('nanoid', () => ({
  nanoid: (() => {
    let counter = 0;
    return vi.fn(() => `client-req-${++counter}`);
  })(),
}));

// --- Tests ---

describe('IPCClient', () => {
  let client: InstanceType<typeof import('../ipc/IPCClient.js').IPCClient>;

  beforeEach(async () => {
    vi.clearAllMocks();
    existsSyncReturn = true;
    const { IPCClient } = await import('../ipc/IPCClient.js');
    client = new IPCClient('/tmp/test-nova-pm.sock');
  });

  afterEach(() => {
    client.disconnect();
    vi.restoreAllMocks();
  });

  describe('connect', () => {
    it('should connect to the socket path when it exists', async () => {
      await client.connect();

      expect(client.isConnected()).toBe(true);
    });

    it('should throw IPCConnectionError when socket file does not exist', async () => {
      existsSyncReturn = false;

      await expect(client.connect()).rejects.toThrow(IPCConnectionError);
      await expect(client.connect()).rejects.toThrow('Daemon socket not found');
    });

    it('should throw IPCConnectionError when connection fails', async () => {
      const { createConnection } = await import('node:net');
      vi.mocked(createConnection).mockImplementation((_path: unknown, _callback: unknown) => {
        mockSocket = new MockSocket();
        // Simulate connection error in next tick
        process.nextTick(() => {
          mockSocket.emit('error', new Error('ECONNREFUSED'));
        });
        return mockSocket as never;
      });

      await expect(client.connect()).rejects.toThrow(IPCConnectionError);
      await expect(client.connect()).rejects.toThrow('Failed to connect to daemon');
    });
  });

  describe('request', () => {
    it('should send a request and resolve with the result', async () => {
      await client.connect();

      const requestPromise = client.request('daemon.ping');

      // Simulate server response
      await new Promise((resolve) => setTimeout(resolve, 10));
      const sentData = mockSocket.written[0];
      const sentRequest = JSON.parse(sentData.trim());

      const response: IPCResponse = {
        jsonrpc: '2.0',
        id: sentRequest.id,
        result: { version: '1.0.0', uptime: 100, pid: 1234 },
      };
      mockSocket.emit('data', JSON.stringify(response) + '\n');

      const result = await requestPromise;
      expect(result).toEqual({ version: '1.0.0', uptime: 100, pid: 1234 });
    });

    it('should send request with params', async () => {
      await client.connect();

      const requestPromise = client.request('process.start', {
        name: 'my-app',
        script: 'index.js',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      const sentData = mockSocket.written[0];
      const sentRequest = JSON.parse(sentData.trim());

      expect(sentRequest.method).toBe('process.start');
      expect(sentRequest.params).toEqual({ name: 'my-app', script: 'index.js' });

      // Respond
      const response: IPCResponse = {
        jsonrpc: '2.0',
        id: sentRequest.id,
        result: { id: 1, name: 'my-app', status: 'online' },
      };
      mockSocket.emit('data', JSON.stringify(response) + '\n');

      const result = await requestPromise;
      expect(result).toEqual({ id: 1, name: 'my-app', status: 'online' });
    });

    it('should reject when server returns an error response', async () => {
      await client.connect();

      const requestPromise = client.request('process.info', { id: 999 });

      await new Promise((resolve) => setTimeout(resolve, 10));
      const sentData = mockSocket.written[0];
      const sentRequest = JSON.parse(sentData.trim());

      const response: IPCResponse = {
        jsonrpc: '2.0',
        id: sentRequest.id,
        error: { code: -32001, message: 'Process not found: 999' },
      };
      mockSocket.emit('data', JSON.stringify(response) + '\n');

      await expect(requestPromise).rejects.toThrow('Process not found: 999');
    });

    it('should auto-connect if not already connected', async () => {
      // Don't call connect explicitly
      const requestPromise = client.request('daemon.ping');

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockSocket).toBeDefined();

      const sentData = mockSocket.written[0];
      const sentRequest = JSON.parse(sentData.trim());
      const response: IPCResponse = {
        jsonrpc: '2.0',
        id: sentRequest.id,
        result: { version: '1.0.0' },
      };
      mockSocket.emit('data', JSON.stringify(response) + '\n');

      const result = await requestPromise;
      expect(result).toEqual({ version: '1.0.0' });
    });

    it('should handle multiple concurrent requests', async () => {
      await client.connect();

      const promise1 = client.request('daemon.ping');
      const promise2 = client.request('daemon.version');

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockSocket.written.length).toBe(2);

      const req1 = JSON.parse(mockSocket.written[0].trim());
      const req2 = JSON.parse(mockSocket.written[1].trim());

      // Send responses in reverse order
      const resp2: IPCResponse = {
        jsonrpc: '2.0',
        id: req2.id,
        result: { version: '1.0.0' },
      };
      const resp1: IPCResponse = {
        jsonrpc: '2.0',
        id: req1.id,
        result: { version: '1.0.0', uptime: 50, pid: 1234 },
      };

      mockSocket.emit('data', JSON.stringify(resp2) + '\n');
      mockSocket.emit('data', JSON.stringify(resp1) + '\n');

      const result1 = await promise1;
      const result2 = await promise2;

      expect(result1).toEqual({ version: '1.0.0', uptime: 50, pid: 1234 });
      expect(result2).toEqual({ version: '1.0.0' });
    });

    it('should handle response split across multiple data chunks', async () => {
      await client.connect();

      const requestPromise = client.request('daemon.ping');

      await new Promise((resolve) => setTimeout(resolve, 10));
      const sentRequest = JSON.parse(mockSocket.written[0].trim());
      const response: IPCResponse = {
        jsonrpc: '2.0',
        id: sentRequest.id,
        result: { status: 'ok' },
      };
      const fullResponse = JSON.stringify(response) + '\n';
      const midpoint = Math.floor(fullResponse.length / 2);

      // Send in two chunks
      mockSocket.emit('data', fullResponse.substring(0, midpoint));
      mockSocket.emit('data', fullResponse.substring(midpoint));

      const result = await requestPromise;
      expect(result).toEqual({ status: 'ok' });
    });

    it('should ignore responses for unknown request IDs', async () => {
      await client.connect();

      const requestPromise = client.request('daemon.ping');

      await new Promise((resolve) => setTimeout(resolve, 10));
      const sentRequest = JSON.parse(mockSocket.written[0].trim());

      // Send a response with a different ID first
      const unknownResponse: IPCResponse = {
        jsonrpc: '2.0',
        id: 'unknown-id',
        result: { wrong: true },
      };
      mockSocket.emit('data', JSON.stringify(unknownResponse) + '\n');

      // Then send the correct response
      const correctResponse: IPCResponse = {
        jsonrpc: '2.0',
        id: sentRequest.id,
        result: { correct: true },
      };
      mockSocket.emit('data', JSON.stringify(correctResponse) + '\n');

      const result = await requestPromise;
      expect(result).toEqual({ correct: true });
    });

    it('should skip invalid JSON lines in data', async () => {
      await client.connect();

      const requestPromise = client.request('daemon.ping');

      await new Promise((resolve) => setTimeout(resolve, 10));
      const sentRequest = JSON.parse(mockSocket.written[0].trim());

      // Send garbage first, then the correct response
      const response: IPCResponse = {
        jsonrpc: '2.0',
        id: sentRequest.id,
        result: { ok: true },
      };
      mockSocket.emit('data', 'garbage-data\n' + JSON.stringify(response) + '\n');

      const result = await requestPromise;
      expect(result).toEqual({ ok: true });
    });
  });

  describe('disconnect', () => {
    it('should disconnect and destroy the socket', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);

      client.disconnect();
      expect(mockSocket.destroyed).toBe(true);
      expect(client.isConnected()).toBe(false);
    });

    it('should handle disconnect when not connected', () => {
      // Should not throw
      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('should return false before connecting', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should return true after connecting', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('should return false after disconnecting', async () => {
      await client.connect();
      client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('connection close handling', () => {
    it('should reject all pending requests when connection closes', async () => {
      await client.connect();

      const promise1 = client.request('daemon.ping');
      const promise2 = client.request('daemon.version');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate connection close
      mockSocket.emit('close');

      await expect(promise1).rejects.toThrow(IPCConnectionError);
      await expect(promise1).rejects.toThrow('Connection closed');
      await expect(promise2).rejects.toThrow(IPCConnectionError);
    });
  });

  describe('timeout handling', () => {
    it('should timeout if no response is received', async () => {
      // We need to test with a shorter timeout, but IPCClient uses a hardcoded 10s timeout.
      // We will use vi.useFakeTimers to simulate the timeout.
      vi.useFakeTimers();

      await client.connect();

      const requestPromise = client.request('daemon.ping');

      // Advance time past the 10s timeout
      vi.advanceTimersByTime(11000);

      await expect(requestPromise).rejects.toThrow(IPCTimeoutError);

      vi.useRealTimers();
    });
  });
});
