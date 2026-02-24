import { createServer, type Server, type Socket } from 'node:net';
import { unlinkSync, existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { NOVA_SOCK_FILE, getLogger } from '@novapm/shared';
import type { IPCRequest, IPCResponse, AppConfig } from '@novapm/shared';
import { ipcRequestSchema } from '@novapm/shared';
import {
  createResponse,
  createMethodNotFoundError,
  createInternalError,
  createInvalidParamsError,
  serializeMessage,
} from './protocol.js';
import type { ProcessManager } from '../process/ProcessManager.js';
import type { LogAggregator } from '../logs/LogAggregator.js';
import type { MetricsCollector } from '../metrics/MetricsCollector.js';
import type { SystemMetricsCollector } from '../metrics/SystemMetricsCollector.js';

const logger = getLogger();

export type IPCHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

export class IPCServer {
  private server: Server | null = null;
  private sockPath: string;
  private handlers: Map<string, IPCHandler> = new Map();
  private connections: Set<Socket> = new Set();
  private processManager: ProcessManager;
  private logAggregator: LogAggregator;
  private metricsCollector: MetricsCollector;
  private systemMetrics: SystemMetricsCollector;
  private startTime: Date;
  private onStopDaemon: (() => Promise<void>) | null = null;

  constructor(
    processManager: ProcessManager,
    logAggregator: LogAggregator,
    metricsCollector: MetricsCollector,
    systemMetrics: SystemMetricsCollector,
    sockPath: string = NOVA_SOCK_FILE,
  ) {
    this.processManager = processManager;
    this.logAggregator = logAggregator;
    this.metricsCollector = metricsCollector;
    this.systemMetrics = systemMetrics;
    this.sockPath = sockPath;
    this.startTime = new Date();
    this.registerBuiltinHandlers();
  }

  setStopHandler(handler: () => Promise<void>): void {
    this.onStopDaemon = handler;
  }

  async start(): Promise<void> {
    // Clean up stale socket
    if (existsSync(this.sockPath)) {
      try {
        unlinkSync(this.sockPath);
      } catch {
        // Ignore
      }
    }

    mkdirSync(dirname(this.sockPath), { recursive: true });

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err: Error) => {
        logger.error({ err }, 'IPC server error');
        reject(err);
      });

      this.server.listen(this.sockPath, () => {
        logger.info({ sockPath: this.sockPath }, 'IPC server listening');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    // Close all connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          // Clean up socket file
          try {
            unlinkSync(this.sockPath);
          } catch {
            // Ignore
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);
    let buffer = '';

    socket.on('data', async (data) => {
      buffer += data.toString();

      // Process complete messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line);
          const validated = ipcRequestSchema.safeParse(parsed);

          if (!validated.success) {
            const response = createInvalidParamsError(
              parsed.id || 'unknown',
              'Invalid request format',
            );
            socket.write(serializeMessage(response));
            continue;
          }

          const request = validated.data as IPCRequest;
          const response = await this.handleRequest(request);
          socket.write(serializeMessage(response));
        } catch (err) {
          logger.debug({ err }, 'Failed to parse IPC message');
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', (err) => {
      logger.debug({ err }, 'IPC client connection error');
      this.connections.delete(socket);
    });
  }

  private async handleRequest(request: IPCRequest): Promise<IPCResponse> {
    const handler = this.handlers.get(request.method);
    if (!handler) {
      return createMethodNotFoundError(request.id, request.method);
    }

    try {
      const result = await handler(request.params || {});
      return createResponse(request.id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return createInternalError(request.id, message);
    }
  }

  private registerBuiltinHandlers(): void {
    // Daemon methods
    this.handlers.set('daemon.ping', () => ({
      version: '1.0.0',
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      pid: process.pid,
    }));

    this.handlers.set('daemon.version', () => ({
      version: '1.0.0',
    }));

    this.handlers.set('daemon.stop', async () => {
      // Defer stop to allow response to be sent
      setTimeout(async () => {
        if (this.onStopDaemon) {
          await this.onStopDaemon();
        }
      }, 100);
      return { status: 'stopping' };
    });

    // Process methods
    this.handlers.set('process.start', async (params) => {
      const config = params as unknown as AppConfig;
      const proc = await this.processManager.start(config);
      return proc;
    });

    this.handlers.set('process.stop', async (params) => {
      const { id, name, force } = params as { id?: number; name?: string; force?: boolean };
      const identifier = id ?? name;
      if (identifier === undefined) throw new Error('id or name required');

      if (identifier === 'all') {
        await this.processManager.stopAll(force);
        return { status: 'ok' };
      }

      await this.processManager.stop(identifier, force);
      return { status: 'ok' };
    });

    this.handlers.set('process.restart', async (params) => {
      const { id, name } = params as { id?: number; name?: string };
      const identifier = id ?? name;
      if (identifier === undefined) throw new Error('id or name required');

      if (identifier === 'all') {
        await this.processManager.restartAll();
        return { status: 'ok' };
      }

      await this.processManager.restart(identifier);
      return { status: 'ok' };
    });

    this.handlers.set('process.delete', async (params) => {
      const { id, name } = params as { id?: number; name?: string };
      const identifier = id ?? name;
      if (identifier === undefined) throw new Error('id or name required');

      if (identifier === 'all') {
        await this.processManager.deleteAll();
        return { status: 'ok' };
      }

      await this.processManager.delete(identifier);
      return { status: 'ok' };
    });

    this.handlers.set('process.list', () => {
      const processes = this.processManager.list();
      // Attach latest metrics to each process
      return processes.map((proc) => {
        const metrics = this.metricsCollector.getLatest(proc.id);
        return { ...proc, metrics: metrics || null };
      });
    });

    this.handlers.set('process.info', (params) => {
      const { id, name } = params as { id?: number; name?: string };
      const identifier = id ?? name;
      if (identifier === undefined) throw new Error('id or name required');

      const proc = this.processManager.info(identifier);
      const metrics = this.metricsCollector.getLatest(proc.id);
      return { ...proc, metrics: metrics || null };
    });

    this.handlers.set('process.scale', async (_params) => {
      // Placeholder for future scale implementation
      throw new Error('Scale not yet implemented');
    });

    // Log methods
    this.handlers.set('logs.recent', (params) => {
      const { id, name, lines } = params as { id?: number; name?: string; lines?: number };
      if (id !== undefined) {
        return this.logAggregator.getRecentLogs(id, lines);
      }
      if (name !== undefined) {
        // Resolve process name to id
        const proc = this.processManager.info(name);
        return this.logAggregator.getRecentLogs(proc.id, lines);
      }
      return this.logAggregator.getAllRecentLogs(lines);
    });

    this.handlers.set('logs.flush', async () => {
      await this.logAggregator.flush();
      return { status: 'ok' };
    });

    // Metrics methods
    this.handlers.set('metrics.get', (params) => {
      const { id } = params as { id: number };
      return this.metricsCollector.getLatest(id) || null;
    });

    this.handlers.set('metrics.system', () => {
      return this.systemMetrics.getLatest();
    });

    // Config methods
    this.handlers.set('config.reload', () => {
      // Placeholder
      return { status: 'ok' };
    });
  }
}
