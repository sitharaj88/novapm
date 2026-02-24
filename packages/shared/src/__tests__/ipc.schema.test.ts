import { describe, it, expect } from 'vitest';
import {
  ipcRequestSchema,
  ipcResponseSchema,
  ipcMethodSchema,
  ipcErrorSchema,
} from '../schemas/ipc.schema.js';
import { IPC_ERROR_CODES } from '../types/ipc.js';

describe('ipcMethodSchema', () => {
  const validMethods = [
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

  it('should accept all valid IPC methods', () => {
    for (const method of validMethods) {
      const result = ipcMethodSchema.safeParse(method);
      expect(result.success).toBe(true);
    }
  });

  it('should have exactly 16 valid methods', () => {
    expect(validMethods).toHaveLength(16);
  });

  it('should reject an unknown method', () => {
    const result = ipcMethodSchema.safeParse('daemon.restart');
    expect(result.success).toBe(false);
  });

  it('should reject an empty string', () => {
    const result = ipcMethodSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('should reject a non-string value', () => {
    expect(ipcMethodSchema.safeParse(42).success).toBe(false);
    expect(ipcMethodSchema.safeParse(null).success).toBe(false);
    expect(ipcMethodSchema.safeParse(undefined).success).toBe(false);
  });

  it('should be case-sensitive', () => {
    expect(ipcMethodSchema.safeParse('Daemon.Ping').success).toBe(false);
    expect(ipcMethodSchema.safeParse('DAEMON.PING').success).toBe(false);
    expect(ipcMethodSchema.safeParse('PROCESS.START').success).toBe(false);
  });

  it('should reject methods with leading or trailing spaces', () => {
    expect(ipcMethodSchema.safeParse(' daemon.ping').success).toBe(false);
    expect(ipcMethodSchema.safeParse('daemon.ping ').success).toBe(false);
  });

  it('should cover all daemon methods', () => {
    const daemonMethods = validMethods.filter((m) => m.startsWith('daemon.'));
    expect(daemonMethods).toEqual(['daemon.ping', 'daemon.stop', 'daemon.version']);
  });

  it('should cover all process methods', () => {
    const processMethods = validMethods.filter((m) => m.startsWith('process.'));
    expect(processMethods).toEqual([
      'process.start',
      'process.stop',
      'process.restart',
      'process.delete',
      'process.list',
      'process.info',
      'process.scale',
    ]);
  });

  it('should cover all logs methods', () => {
    const logsMethods = validMethods.filter((m) => m.startsWith('logs.'));
    expect(logsMethods).toEqual(['logs.stream', 'logs.flush', 'logs.recent']);
  });

  it('should cover all metrics methods', () => {
    const metricsMethods = validMethods.filter((m) => m.startsWith('metrics.'));
    expect(metricsMethods).toEqual(['metrics.get', 'metrics.system']);
  });

  it('should cover config methods', () => {
    const configMethods = validMethods.filter((m) => m.startsWith('config.'));
    expect(configMethods).toEqual(['config.reload']);
  });
});

describe('ipcRequestSchema', () => {
  it('should accept a valid request with params', () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'process.start',
      params: { name: 'my-app', script: 'index.js' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept a valid request without params', () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-2',
      method: 'daemon.ping',
    });
    expect(result.success).toBe(true);
  });

  it('should require jsonrpc to be exactly "2.0"', () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: '1.0',
      id: 'req-1',
      method: 'daemon.ping',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing jsonrpc field', () => {
    const result = ipcRequestSchema.safeParse({
      id: 'req-1',
      method: 'daemon.ping',
    });
    expect(result.success).toBe(false);
  });

  it('should require id to be a string', () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 123,
      method: 'daemon.ping',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing id', () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: '2.0',
      method: 'daemon.ping',
    });
    expect(result.success).toBe(false);
  });

  it('should require a valid method', () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'invalid.method',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing method', () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-1',
    });
    expect(result.success).toBe(false);
  });

  it('should accept params with mixed value types', () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'process.scale',
      params: {
        name: 'my-app',
        instances: 4,
        force: true,
        config: { nested: 'value' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty params object', () => {
    const result = ipcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'process.list',
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it('should reject an entirely empty object', () => {
    const result = ipcRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject null', () => {
    const result = ipcRequestSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it('should reject a string', () => {
    const result = ipcRequestSchema.safeParse('not a request');
    expect(result.success).toBe(false);
  });
});

describe('ipcErrorSchema', () => {
  it('should accept a valid error with code and message', () => {
    const result = ipcErrorSchema.safeParse({
      code: -32600,
      message: 'Invalid Request',
    });
    expect(result.success).toBe(true);
  });

  it('should accept a valid error with data', () => {
    const result = ipcErrorSchema.safeParse({
      code: -32602,
      message: 'Invalid params',
      data: { field: 'name', reason: 'required' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept error with null data', () => {
    const result = ipcErrorSchema.safeParse({
      code: -32700,
      message: 'Parse error',
      data: null,
    });
    expect(result.success).toBe(true);
  });

  it('should require code to be a number', () => {
    const result = ipcErrorSchema.safeParse({
      code: 'error',
      message: 'Invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should require message to be a string', () => {
    const result = ipcErrorSchema.safeParse({
      code: -32600,
      message: 42,
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing code', () => {
    const result = ipcErrorSchema.safeParse({
      message: 'Some error',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing message', () => {
    const result = ipcErrorSchema.safeParse({
      code: -32600,
    });
    expect(result.success).toBe(false);
  });
});

describe('ipcResponseSchema', () => {
  it('should accept a successful response with result', () => {
    const result = ipcResponseSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-1',
      result: { status: 'ok', processes: [] },
    });
    expect(result.success).toBe(true);
  });

  it('should accept an error response', () => {
    const result = ipcResponseSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-1',
      error: {
        code: IPC_ERROR_CODES.PROCESS_NOT_FOUND,
        message: 'Process not found: my-app',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept a response with both result and error (JSON-RPC spec allows it at schema level)', () => {
    const result = ipcResponseSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-1',
      result: null,
      error: {
        code: -32600,
        message: 'Invalid Request',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept a response with neither result nor error', () => {
    const result = ipcResponseSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-1',
    });
    expect(result.success).toBe(true);
  });

  it('should require jsonrpc to be "2.0"', () => {
    const result = ipcResponseSchema.safeParse({
      jsonrpc: '1.0',
      id: 'req-1',
      result: 'ok',
    });
    expect(result.success).toBe(false);
  });

  it('should require id to be a string', () => {
    const result = ipcResponseSchema.safeParse({
      jsonrpc: '2.0',
      id: 42,
      result: 'ok',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing id', () => {
    const result = ipcResponseSchema.safeParse({
      jsonrpc: '2.0',
      result: 'ok',
    });
    expect(result.success).toBe(false);
  });

  it('should accept result of any type', () => {
    const types = [null, 'string', 42, true, [1, 2], { key: 'val' }];
    for (const value of types) {
      const result = ipcResponseSchema.safeParse({
        jsonrpc: '2.0',
        id: 'req-1',
        result: value,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should validate error object structure when present', () => {
    const result = ipcResponseSchema.safeParse({
      jsonrpc: '2.0',
      id: 'req-1',
      error: {
        code: 'not-a-number',
        message: 'Invalid',
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('IPC_ERROR_CODES', () => {
  it('should define standard JSON-RPC error codes', () => {
    expect(IPC_ERROR_CODES.PARSE_ERROR).toBe(-32700);
    expect(IPC_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
    expect(IPC_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
    expect(IPC_ERROR_CODES.INVALID_PARAMS).toBe(-32602);
    expect(IPC_ERROR_CODES.INTERNAL_ERROR).toBe(-32603);
  });

  it('should define application-specific error codes', () => {
    expect(IPC_ERROR_CODES.PROCESS_NOT_FOUND).toBe(-32001);
    expect(IPC_ERROR_CODES.PROCESS_ALREADY_EXISTS).toBe(-32002);
    expect(IPC_ERROR_CODES.PROCESS_NOT_RUNNING).toBe(-32003);
    expect(IPC_ERROR_CODES.DAEMON_ERROR).toBe(-32010);
  });

  it('should have all error codes as negative numbers', () => {
    for (const [, value] of Object.entries(IPC_ERROR_CODES)) {
      expect(value).toBeLessThan(0);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('should have unique error codes', () => {
    const values = Object.values(IPC_ERROR_CODES);
    const uniqueValues = new Set(values);
    expect(uniqueValues.size).toBe(values.length);
  });

  it('should have standard JSON-RPC codes in the -32700 to -32600 range', () => {
    expect(IPC_ERROR_CODES.PARSE_ERROR).toBeGreaterThanOrEqual(-32700);
    expect(IPC_ERROR_CODES.PARSE_ERROR).toBeLessThanOrEqual(-32600);
    expect(IPC_ERROR_CODES.INVALID_REQUEST).toBeGreaterThanOrEqual(-32700);
    expect(IPC_ERROR_CODES.INVALID_REQUEST).toBeLessThanOrEqual(-32600);
  });

  it('should have application error codes in a different range from standard codes', () => {
    const applicationCodes = [
      IPC_ERROR_CODES.PROCESS_NOT_FOUND,
      IPC_ERROR_CODES.PROCESS_ALREADY_EXISTS,
      IPC_ERROR_CODES.PROCESS_NOT_RUNNING,
      IPC_ERROR_CODES.DAEMON_ERROR,
    ];
    for (const code of applicationCodes) {
      expect(code).toBeGreaterThan(-32600);
    }
  });
});
