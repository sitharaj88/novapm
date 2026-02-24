import { nanoid } from 'nanoid';
import type { IPCRequest, IPCResponse, IPCMethod } from '@novapm/shared';
import { IPC_ERROR_CODES } from '@novapm/shared';

export function createRequest(method: IPCMethod, params?: Record<string, unknown>): IPCRequest {
  return {
    jsonrpc: '2.0',
    id: nanoid(),
    method,
    params,
  };
}

export function createResponse(id: string, result: unknown): IPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

export function createErrorResponse(
  id: string,
  code: number,
  message: string,
  data?: unknown,
): IPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

export function createMethodNotFoundError(id: string, method: string): IPCResponse {
  return createErrorResponse(id, IPC_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`);
}

export function createInvalidParamsError(id: string, message: string): IPCResponse {
  return createErrorResponse(id, IPC_ERROR_CODES.INVALID_PARAMS, message);
}

export function createInternalError(id: string, message: string): IPCResponse {
  return createErrorResponse(id, IPC_ERROR_CODES.INTERNAL_ERROR, message);
}

export function serializeMessage(msg: IPCRequest | IPCResponse): string {
  return JSON.stringify(msg) + '\n';
}

export function deserializeMessage(data: string): IPCRequest | IPCResponse {
  return JSON.parse(data) as IPCRequest | IPCResponse;
}
