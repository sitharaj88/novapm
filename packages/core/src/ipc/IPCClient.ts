import { createConnection, type Socket } from 'node:net';
import { existsSync } from 'node:fs';
import { NOVA_SOCK_FILE, IPCConnectionError, IPCTimeoutError } from '@novapm/shared';
import type { IPCMethod, IPCResponse } from '@novapm/shared';
import { createRequest, serializeMessage } from './protocol.js';

const DEFAULT_TIMEOUT = 10000;

export class IPCClient {
  private sockPath: string;
  private socket: Socket | null = null;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: IPCResponse) => void;
      reject: (reason: Error) => void;
      timer: NodeJS.Timeout;
    }
  > = new Map();
  private buffer: string = '';

  constructor(sockPath: string = NOVA_SOCK_FILE) {
    this.sockPath = sockPath;
  }

  async connect(): Promise<void> {
    if (!existsSync(this.sockPath)) {
      throw new IPCConnectionError(
        `Daemon socket not found at ${this.sockPath}. Is the daemon running?`,
      );
    }

    return new Promise((resolve, reject) => {
      this.socket = createConnection(this.sockPath, () => {
        resolve();
      });

      this.socket.on('data', (data) => {
        this.handleData(data.toString());
      });

      this.socket.on('error', (err) => {
        reject(new IPCConnectionError(`Failed to connect to daemon: ${err.message}`));
      });

      this.socket.on('close', () => {
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new IPCConnectionError('Connection closed'));
          this.pendingRequests.delete(id);
        }
        this.socket = null;
      });
    });
  }

  async request(method: IPCMethod, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.socket) {
      await this.connect();
    }

    const req = createRequest(method, params);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(req.id);
        reject(new IPCTimeoutError(method));
      }, DEFAULT_TIMEOUT);

      this.pendingRequests.set(req.id, {
        resolve: (response: IPCResponse) => {
          clearTimeout(timer);
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result);
          }
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });

      this.socket!.write(serializeMessage(req));
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  private handleData(data: string): void {
    this.buffer += data;

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line) as IPCResponse;
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          pending.resolve(response);
        }
      } catch {
        // Invalid JSON, skip
      }
    }
  }
}
