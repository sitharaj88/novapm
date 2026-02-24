export class NovaError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'NovaError';
    this.code = code;
  }
}

export class ProcessNotFoundError extends NovaError {
  constructor(identifier: string | number) {
    super(`Process not found: ${identifier}`, 'PROCESS_NOT_FOUND');
    this.name = 'ProcessNotFoundError';
  }
}

export class ProcessAlreadyExistsError extends NovaError {
  constructor(name: string) {
    super(`Process already exists: ${name}`, 'PROCESS_ALREADY_EXISTS');
    this.name = 'ProcessAlreadyExistsError';
  }
}

export class ProcessNotRunningError extends NovaError {
  constructor(identifier: string | number) {
    super(`Process is not running: ${identifier}`, 'PROCESS_NOT_RUNNING');
    this.name = 'ProcessNotRunningError';
  }
}

export class DaemonNotRunningError extends NovaError {
  constructor() {
    super('NovaPM daemon is not running. Start it with: nova start <app>', 'DAEMON_NOT_RUNNING');
    this.name = 'DaemonNotRunningError';
  }
}

export class DaemonAlreadyRunningError extends NovaError {
  constructor(pid: number) {
    super(`NovaPM daemon is already running (PID: ${pid})`, 'DAEMON_ALREADY_RUNNING');
    this.name = 'DaemonAlreadyRunningError';
  }
}

export class ConfigValidationError extends NovaError {
  public readonly errors: string[];

  constructor(errors: string[]) {
    super(`Configuration validation failed:\n${errors.join('\n')}`, 'CONFIG_VALIDATION_ERROR');
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

export class IPCConnectionError extends NovaError {
  constructor(message: string) {
    super(message, 'IPC_CONNECTION_ERROR');
    this.name = 'IPCConnectionError';
  }
}

export class IPCTimeoutError extends NovaError {
  constructor(method: string) {
    super(`IPC request timed out: ${method}`, 'IPC_TIMEOUT');
    this.name = 'IPCTimeoutError';
  }
}
