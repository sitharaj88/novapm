export type IPCMethod =
  | 'daemon.ping'
  | 'daemon.stop'
  | 'daemon.version'
  | 'process.start'
  | 'process.stop'
  | 'process.restart'
  | 'process.delete'
  | 'process.list'
  | 'process.info'
  | 'process.scale'
  | 'logs.stream'
  | 'logs.flush'
  | 'logs.recent'
  | 'metrics.get'
  | 'metrics.system'
  | 'config.reload';

export interface IPCRequest {
  jsonrpc: '2.0';
  id: string;
  method: IPCMethod;
  params?: Record<string, unknown>;
}

export interface IPCResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: IPCError;
}

export interface IPCError {
  code: number;
  message: string;
  data?: unknown;
}

export const IPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  PROCESS_NOT_FOUND: -32001,
  PROCESS_ALREADY_EXISTS: -32002,
  PROCESS_NOT_RUNNING: -32003,
  DAEMON_ERROR: -32010,
} as const;

export type IPCErrorCode = (typeof IPC_ERROR_CODES)[keyof typeof IPC_ERROR_CODES];
