import { describe, it, expect } from 'vitest';
import {
  NovaError,
  ProcessNotFoundError,
  ProcessAlreadyExistsError,
  ProcessNotRunningError,
  DaemonNotRunningError,
  DaemonAlreadyRunningError,
  ConfigValidationError,
  IPCConnectionError,
  IPCTimeoutError,
} from '../utils/errors.js';

describe('NovaError', () => {
  it('should create an error with message and code', () => {
    const error = new NovaError('something went wrong', 'GENERIC_ERROR');
    expect(error.message).toBe('something went wrong');
    expect(error.code).toBe('GENERIC_ERROR');
  });

  it('should have name set to "NovaError"', () => {
    const error = new NovaError('test', 'TEST');
    expect(error.name).toBe('NovaError');
  });

  it('should be an instance of Error', () => {
    const error = new NovaError('test', 'TEST');
    expect(error).toBeInstanceOf(Error);
  });

  it('should be an instance of NovaError', () => {
    const error = new NovaError('test', 'TEST');
    expect(error).toBeInstanceOf(NovaError);
  });

  it('should have a stack trace', () => {
    const error = new NovaError('test', 'TEST');
    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe('string');
  });

  it('should have a code property that is typed as readonly', () => {
    const error = new NovaError('test', 'TEST');
    expect(error.code).toBe('TEST');
    // The `readonly` keyword is a TypeScript compile-time check;
    // at runtime the property is a regular own property
    expect(Object.prototype.hasOwnProperty.call(error, 'code')).toBe(true);
  });

  it('should be catchable as an Error', () => {
    expect(() => {
      throw new NovaError('test', 'TEST');
    }).toThrow(Error);
  });

  it('should be catchable as a NovaError', () => {
    expect(() => {
      throw new NovaError('test', 'TEST');
    }).toThrow(NovaError);
  });

  it('should preserve the error message in toString', () => {
    const error = new NovaError('test message', 'CODE');
    expect(error.toString()).toContain('test message');
  });
});

describe('ProcessNotFoundError', () => {
  it('should create an error with string identifier', () => {
    const error = new ProcessNotFoundError('my-app');
    expect(error.message).toBe('Process not found: my-app');
    expect(error.code).toBe('PROCESS_NOT_FOUND');
    expect(error.name).toBe('ProcessNotFoundError');
  });

  it('should create an error with numeric identifier', () => {
    const error = new ProcessNotFoundError(42);
    expect(error.message).toBe('Process not found: 42');
    expect(error.code).toBe('PROCESS_NOT_FOUND');
  });

  it('should be an instance of NovaError', () => {
    const error = new ProcessNotFoundError('app');
    expect(error).toBeInstanceOf(NovaError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should be distinguishable from other error types', () => {
    const error = new ProcessNotFoundError('app');
    expect(error).toBeInstanceOf(ProcessNotFoundError);
    expect(error).not.toBeInstanceOf(ProcessAlreadyExistsError);
    expect(error).not.toBeInstanceOf(DaemonNotRunningError);
  });

  it('should include the identifier in the message', () => {
    const error = new ProcessNotFoundError('special-app-123');
    expect(error.message).toContain('special-app-123');
  });

  it('should handle zero as identifier', () => {
    const error = new ProcessNotFoundError(0);
    expect(error.message).toBe('Process not found: 0');
  });
});

describe('ProcessAlreadyExistsError', () => {
  it('should create an error with process name', () => {
    const error = new ProcessAlreadyExistsError('my-app');
    expect(error.message).toBe('Process already exists: my-app');
    expect(error.code).toBe('PROCESS_ALREADY_EXISTS');
    expect(error.name).toBe('ProcessAlreadyExistsError');
  });

  it('should be an instance of NovaError and Error', () => {
    const error = new ProcessAlreadyExistsError('app');
    expect(error).toBeInstanceOf(NovaError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should include the name in the message', () => {
    const error = new ProcessAlreadyExistsError('web-server');
    expect(error.message).toContain('web-server');
  });

  it('should handle empty string name', () => {
    const error = new ProcessAlreadyExistsError('');
    expect(error.message).toBe('Process already exists: ');
    expect(error.code).toBe('PROCESS_ALREADY_EXISTS');
  });

  it('should handle names with special characters', () => {
    const error = new ProcessAlreadyExistsError('my-app/v2.0');
    expect(error.message).toBe('Process already exists: my-app/v2.0');
  });
});

describe('ProcessNotRunningError', () => {
  it('should create an error with string identifier', () => {
    const error = new ProcessNotRunningError('worker');
    expect(error.message).toBe('Process is not running: worker');
    expect(error.code).toBe('PROCESS_NOT_RUNNING');
    expect(error.name).toBe('ProcessNotRunningError');
  });

  it('should create an error with numeric identifier', () => {
    const error = new ProcessNotRunningError(7);
    expect(error.message).toBe('Process is not running: 7');
  });

  it('should be an instance of NovaError and Error', () => {
    const error = new ProcessNotRunningError('app');
    expect(error).toBeInstanceOf(NovaError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('DaemonNotRunningError', () => {
  it('should create an error with a helpful message', () => {
    const error = new DaemonNotRunningError();
    expect(error.message).toBe('NovaPM daemon is not running. Start it with: nova start <app>');
    expect(error.code).toBe('DAEMON_NOT_RUNNING');
    expect(error.name).toBe('DaemonNotRunningError');
  });

  it('should be an instance of NovaError and Error', () => {
    const error = new DaemonNotRunningError();
    expect(error).toBeInstanceOf(NovaError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should include actionable instructions in the message', () => {
    const error = new DaemonNotRunningError();
    expect(error.message).toContain('nova start');
  });

  it('should require no constructor arguments', () => {
    // Constructing with no args should not throw
    expect(() => new DaemonNotRunningError()).not.toThrow();
  });
});

describe('DaemonAlreadyRunningError', () => {
  it('should create an error with the PID in the message', () => {
    const error = new DaemonAlreadyRunningError(12345);
    expect(error.message).toBe('NovaPM daemon is already running (PID: 12345)');
    expect(error.code).toBe('DAEMON_ALREADY_RUNNING');
    expect(error.name).toBe('DaemonAlreadyRunningError');
  });

  it('should be an instance of NovaError and Error', () => {
    const error = new DaemonAlreadyRunningError(1);
    expect(error).toBeInstanceOf(NovaError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should include the PID number in the message', () => {
    const error = new DaemonAlreadyRunningError(99999);
    expect(error.message).toContain('99999');
  });

  it('should handle PID of 1', () => {
    const error = new DaemonAlreadyRunningError(1);
    expect(error.message).toBe('NovaPM daemon is already running (PID: 1)');
  });
});

describe('ConfigValidationError', () => {
  it('should create an error with a list of validation errors', () => {
    const errors = ['name is required', 'script must be a string'];
    const error = new ConfigValidationError(errors);
    expect(error.message).toContain('Configuration validation failed:');
    expect(error.message).toContain('name is required');
    expect(error.message).toContain('script must be a string');
    expect(error.code).toBe('CONFIG_VALIDATION_ERROR');
    expect(error.name).toBe('ConfigValidationError');
  });

  it('should store the errors array', () => {
    const errors = ['error1', 'error2', 'error3'];
    const error = new ConfigValidationError(errors);
    expect(error.errors).toEqual(errors);
    expect(error.errors).toHaveLength(3);
  });

  it('should be an instance of NovaError and Error', () => {
    const error = new ConfigValidationError(['test']);
    expect(error).toBeInstanceOf(NovaError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should handle a single validation error', () => {
    const error = new ConfigValidationError(['apps array must not be empty']);
    expect(error.errors).toHaveLength(1);
    expect(error.message).toContain('apps array must not be empty');
  });

  it('should handle an empty errors array', () => {
    const error = new ConfigValidationError([]);
    expect(error.errors).toHaveLength(0);
    expect(error.message).toContain('Configuration validation failed:');
  });

  it('should join errors with newlines', () => {
    const errors = ['error1', 'error2'];
    const error = new ConfigValidationError(errors);
    expect(error.message).toBe('Configuration validation failed:\nerror1\nerror2');
  });

  it('should have an errors property that is typed as readonly', () => {
    const error = new ConfigValidationError(['test']);
    // The `readonly` keyword is a TypeScript compile-time check;
    // at runtime the property is a regular own property
    expect(Object.prototype.hasOwnProperty.call(error, 'errors')).toBe(true);
    expect(error.errors).toEqual(['test']);
  });
});

describe('IPCConnectionError', () => {
  it('should create an error with a custom message', () => {
    const error = new IPCConnectionError('Connection refused');
    expect(error.message).toBe('Connection refused');
    expect(error.code).toBe('IPC_CONNECTION_ERROR');
    expect(error.name).toBe('IPCConnectionError');
  });

  it('should be an instance of NovaError and Error', () => {
    const error = new IPCConnectionError('test');
    expect(error).toBeInstanceOf(NovaError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should accept descriptive connection error messages', () => {
    const error = new IPCConnectionError('ECONNREFUSED: Could not connect to /tmp/nova.sock');
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.message).toContain('nova.sock');
  });
});

describe('IPCTimeoutError', () => {
  it('should create an error with the method that timed out', () => {
    const error = new IPCTimeoutError('process.start');
    expect(error.message).toBe('IPC request timed out: process.start');
    expect(error.code).toBe('IPC_TIMEOUT');
    expect(error.name).toBe('IPCTimeoutError');
  });

  it('should be an instance of NovaError and Error', () => {
    const error = new IPCTimeoutError('daemon.ping');
    expect(error).toBeInstanceOf(NovaError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should include the method name in the message', () => {
    const error = new IPCTimeoutError('metrics.get');
    expect(error.message).toContain('metrics.get');
  });

  it('should handle any method string', () => {
    const error = new IPCTimeoutError('custom.method');
    expect(error.message).toBe('IPC request timed out: custom.method');
  });
});

describe('error hierarchy and discrimination', () => {
  it('all custom errors should extend NovaError', () => {
    const errors = [
      new ProcessNotFoundError('app'),
      new ProcessAlreadyExistsError('app'),
      new ProcessNotRunningError('app'),
      new DaemonNotRunningError(),
      new DaemonAlreadyRunningError(1),
      new ConfigValidationError(['test']),
      new IPCConnectionError('test'),
      new IPCTimeoutError('test'),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(NovaError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('should be possible to discriminate errors by code', () => {
    const errors: NovaError[] = [
      new ProcessNotFoundError('app'),
      new ProcessAlreadyExistsError('app'),
      new DaemonNotRunningError(),
    ];

    const codes = errors.map((e) => e.code);
    expect(codes).toEqual(['PROCESS_NOT_FOUND', 'PROCESS_ALREADY_EXISTS', 'DAEMON_NOT_RUNNING']);
  });

  it('should be possible to discriminate errors by name', () => {
    const errors: Error[] = [
      new ProcessNotFoundError('app'),
      new IPCTimeoutError('method'),
      new ConfigValidationError(['err']),
    ];

    const names = errors.map((e) => e.name);
    expect(names).toEqual(['ProcessNotFoundError', 'IPCTimeoutError', 'ConfigValidationError']);
  });

  it('each error subclass should have a unique code', () => {
    const errors: NovaError[] = [
      new ProcessNotFoundError('app'),
      new ProcessAlreadyExistsError('app'),
      new ProcessNotRunningError('app'),
      new DaemonNotRunningError(),
      new DaemonAlreadyRunningError(1),
      new ConfigValidationError(['test']),
      new IPCConnectionError('test'),
      new IPCTimeoutError('test'),
    ];

    const codes = errors.map((e) => e.code);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);
  });

  it('should work correctly in try/catch with instanceof', () => {
    const throwError = () => {
      throw new ProcessNotFoundError('my-app');
    };

    try {
      throwError();
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ProcessNotFoundError);
      expect(e).toBeInstanceOf(NovaError);
      expect(e).toBeInstanceOf(Error);
      if (e instanceof NovaError) {
        expect(e.code).toBe('PROCESS_NOT_FOUND');
      }
    }
  });
});
