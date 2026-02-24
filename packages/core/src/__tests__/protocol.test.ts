import { describe, it, expect, vi } from 'vitest';
import type { IPCRequest, IPCResponse } from '@novapm/shared';
import { IPC_ERROR_CODES } from '@novapm/shared';
import {
  createRequest,
  createResponse,
  createErrorResponse,
  createMethodNotFoundError,
  createInvalidParamsError,
  createInternalError,
  serializeMessage,
  deserializeMessage,
} from '../ipc/protocol.js';

// Mock nanoid to produce deterministic IDs in tests
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'test-id-123'),
}));

describe('IPC Protocol', () => {
  describe('createRequest', () => {
    it('should create a valid JSON-RPC 2.0 request', () => {
      const request = createRequest('daemon.ping');

      expect(request).toEqual({
        jsonrpc: '2.0',
        id: 'test-id-123',
        method: 'daemon.ping',
        params: undefined,
      });
    });

    it('should include params when provided', () => {
      const params = { name: 'my-app', script: 'index.js' };
      const request = createRequest('process.start', params);

      expect(request.jsonrpc).toBe('2.0');
      expect(request.id).toBe('test-id-123');
      expect(request.method).toBe('process.start');
      expect(request.params).toEqual(params);
    });

    it('should accept all valid IPC methods', () => {
      const methods = [
        'daemon.ping',
        'daemon.stop',
        'daemon.version',
        'process.start',
        'process.stop',
        'process.restart',
        'process.delete',
        'process.list',
        'process.info',
        'process.scale',
        'logs.stream',
        'logs.flush',
        'logs.recent',
        'metrics.get',
        'metrics.system',
        'config.reload',
      ] as const;

      for (const method of methods) {
        const request = createRequest(method);
        expect(request.method).toBe(method);
        expect(request.jsonrpc).toBe('2.0');
      }
    });
  });

  describe('createResponse', () => {
    it('should create a valid JSON-RPC 2.0 success response', () => {
      const response = createResponse('req-1', { status: 'ok' });

      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 'req-1',
        result: { status: 'ok' },
      });
    });

    it('should handle null result', () => {
      const response = createResponse('req-2', null);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('req-2');
      expect(response.result).toBeNull();
      expect(response.error).toBeUndefined();
    });

    it('should handle complex result objects', () => {
      const complexResult = {
        processes: [
          { id: 1, name: 'app', status: 'online' },
          { id: 2, name: 'worker', status: 'stopped' },
        ],
        total: 2,
      };
      const response = createResponse('req-3', complexResult);

      expect(response.result).toEqual(complexResult);
    });

    it('should handle array result', () => {
      const response = createResponse('req-4', [1, 2, 3]);

      expect(response.result).toEqual([1, 2, 3]);
    });

    it('should handle primitive result values', () => {
      expect(createResponse('r1', 42).result).toBe(42);
      expect(createResponse('r2', 'hello').result).toBe('hello');
      expect(createResponse('r3', true).result).toBe(true);
    });
  });

  describe('createErrorResponse', () => {
    it('should create a valid JSON-RPC 2.0 error response', () => {
      const response = createErrorResponse('req-1', -32600, 'Invalid request');

      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 'req-1',
        error: {
          code: -32600,
          message: 'Invalid request',
        },
      });
    });

    it('should include optional data in error', () => {
      const response = createErrorResponse('req-2', -32603, 'Internal error', {
        details: 'Stack trace here',
      });

      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32603);
      expect(response.error!.message).toBe('Internal error');
      expect(response.error!.data).toEqual({ details: 'Stack trace here' });
    });

    it('should not include data field when not provided', () => {
      const response = createErrorResponse('req-3', -32601, 'Method not found');

      expect(response.error).toBeDefined();
      expect(response.error!.data).toBeUndefined();
    });
  });

  describe('createMethodNotFoundError', () => {
    it('should create a method not found error with correct code', () => {
      const response = createMethodNotFoundError('req-1', 'unknown.method');

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('req-1');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(IPC_ERROR_CODES.METHOD_NOT_FOUND);
      expect(response.error!.message).toBe('Method not found: unknown.method');
    });

    it('should use the standard JSON-RPC method not found code (-32601)', () => {
      const response = createMethodNotFoundError('req-2', 'foo.bar');

      expect(response.error!.code).toBe(-32601);
    });
  });

  describe('createInvalidParamsError', () => {
    it('should create an invalid params error with correct code', () => {
      const response = createInvalidParamsError('req-1', 'Missing required parameter: name');

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('req-1');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(IPC_ERROR_CODES.INVALID_PARAMS);
      expect(response.error!.message).toBe('Missing required parameter: name');
    });

    it('should use the standard JSON-RPC invalid params code (-32602)', () => {
      const response = createInvalidParamsError('req-2', 'bad params');

      expect(response.error!.code).toBe(-32602);
    });
  });

  describe('createInternalError', () => {
    it('should create an internal error with correct code', () => {
      const response = createInternalError('req-1', 'Something went wrong');

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('req-1');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(IPC_ERROR_CODES.INTERNAL_ERROR);
      expect(response.error!.message).toBe('Something went wrong');
    });

    it('should use the standard JSON-RPC internal error code (-32603)', () => {
      const response = createInternalError('req-2', 'crash');

      expect(response.error!.code).toBe(-32603);
    });
  });

  describe('serializeMessage', () => {
    it('should serialize a request to a newline-terminated JSON string', () => {
      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'daemon.ping',
      };
      const serialized = serializeMessage(request);

      expect(serialized).toBe('{"jsonrpc":"2.0","id":"req-1","method":"daemon.ping"}\n');
      expect(serialized.endsWith('\n')).toBe(true);
    });

    it('should serialize a response to a newline-terminated JSON string', () => {
      const response: IPCResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        result: { status: 'ok' },
      };
      const serialized = serializeMessage(response);

      expect(serialized).toBe('{"jsonrpc":"2.0","id":"req-1","result":{"status":"ok"}}\n');
      expect(serialized.endsWith('\n')).toBe(true);
    });

    it('should serialize error responses correctly', () => {
      const response: IPCResponse = {
        jsonrpc: '2.0',
        id: 'req-1',
        error: { code: -32601, message: 'Method not found' },
      };
      const serialized = serializeMessage(response);
      const parsed = JSON.parse(serialized.trim());

      expect(parsed.error.code).toBe(-32601);
      expect(parsed.error.message).toBe('Method not found');
    });

    it('should produce valid JSON that can be parsed back', () => {
      const request: IPCRequest = {
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'process.list',
        params: { filter: 'online' },
      };
      const serialized = serializeMessage(request);
      const parsed = JSON.parse(serialized.trim());

      expect(parsed).toEqual(request);
    });
  });

  describe('deserializeMessage', () => {
    it('should deserialize a valid request JSON string', () => {
      const json = '{"jsonrpc":"2.0","id":"req-1","method":"daemon.ping"}';
      const message = deserializeMessage(json) as IPCRequest;

      expect(message.jsonrpc).toBe('2.0');
      expect(message.id).toBe('req-1');
      expect(message.method).toBe('daemon.ping');
    });

    it('should deserialize a valid response JSON string', () => {
      const json = '{"jsonrpc":"2.0","id":"req-1","result":{"status":"ok"}}';
      const message = deserializeMessage(json) as IPCResponse;

      expect(message.jsonrpc).toBe('2.0');
      expect(message.id).toBe('req-1');
      expect(message.result).toEqual({ status: 'ok' });
    });

    it('should deserialize an error response JSON string', () => {
      const json = '{"jsonrpc":"2.0","id":"req-1","error":{"code":-32603,"message":"crash"}}';
      const message = deserializeMessage(json) as IPCResponse;

      expect(message.error).toBeDefined();
      expect(message.error!.code).toBe(-32603);
      expect(message.error!.message).toBe('crash');
    });

    it('should throw on invalid JSON', () => {
      expect(() => deserializeMessage('not valid json')).toThrow();
    });

    it('should throw on empty string', () => {
      expect(() => deserializeMessage('')).toThrow();
    });

    it('should throw on truncated JSON', () => {
      expect(() => deserializeMessage('{"jsonrpc":"2.0","id":')).toThrow();
    });
  });

  describe('roundtrip serialization', () => {
    it('should roundtrip a request through serialize and deserialize', () => {
      const original = createRequest('process.start', { name: 'app', script: 'index.js' });
      const serialized = serializeMessage(original);
      const deserialized = deserializeMessage(serialized.trim()) as IPCRequest;

      expect(deserialized).toEqual(original);
    });

    it('should roundtrip a success response through serialize and deserialize', () => {
      const original = createResponse('req-1', { processes: [{ id: 1, name: 'app' }] });
      const serialized = serializeMessage(original);
      const deserialized = deserializeMessage(serialized.trim()) as IPCResponse;

      expect(deserialized).toEqual(original);
    });

    it('should roundtrip an error response through serialize and deserialize', () => {
      const original = createErrorResponse('req-1', -32601, 'Not found', { method: 'foo' });
      const serialized = serializeMessage(original);
      const deserialized = deserializeMessage(serialized.trim()) as IPCResponse;

      expect(deserialized).toEqual(original);
    });
  });
});
