import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { DEFAULT_DASHBOARD_PORT, getLogger } from '@novapm/shared';
import type { ProcessManager } from '../process/ProcessManager.js';
import type { MetricsCollector } from '../metrics/MetricsCollector.js';
import type { SystemMetricsCollector } from '../metrics/SystemMetricsCollector.js';
import type { LogAggregator } from '../logs/LogAggregator.js';
import type { MetricsRepository } from '../db/repositories/MetricsRepository.js';
import type { EventBus } from '../events/EventBus.js';
import { registerProcessRoutes } from './routes/processes.js';
import { registerMetricRoutes } from './routes/metrics.js';
import { registerLogRoutes } from './routes/logs.js';
import { registerServerRoutes } from './routes/servers.js';

const logger = getLogger();

export class HTTPServer {
  private app: FastifyInstance;
  private port: number;
  private host: string;
  private eventBus: EventBus;
  private controllerRef: { current: unknown | null } = { current: null };

  constructor(
    processManager: ProcessManager,
    metricsCollector: MetricsCollector,
    systemMetrics: SystemMetricsCollector,
    logAggregator: LogAggregator,
    metricsRepo: MetricsRepository,
    eventBus: EventBus,
    port: number = DEFAULT_DASHBOARD_PORT,
    host: string = '127.0.0.1',
  ) {
    this.port = port;
    this.host = host;
    this.eventBus = eventBus;

    this.app = Fastify({ logger: false });

    // Register plugins and routes synchronously in start()
    this.setupRoutes(processManager, metricsCollector, systemMetrics, logAggregator, metricsRepo);
  }

  setController(controller: unknown): void {
    this.controllerRef.current = controller;
  }

  private setupRoutes(
    processManager: ProcessManager,
    metricsCollector: MetricsCollector,
    systemMetrics: SystemMetricsCollector,
    logAggregator: LogAggregator,
    metricsRepo: MetricsRepository,
  ): void {
    registerProcessRoutes(this.app, processManager, metricsCollector);
    registerMetricRoutes(this.app, metricsCollector, systemMetrics, metricsRepo);
    registerLogRoutes(this.app, logAggregator);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerServerRoutes(this.app, () => this.controllerRef.current as any);

    // Health endpoint
    this.app.get('/api/v1/health', async () => ({ status: 'ok', timestamp: new Date() }));
  }

  async start(): Promise<void> {
    await this.app.register(cors, { origin: true });
    await this.app.register(websocket);

    // WebSocket routes
    this.app.get('/ws/logs', { websocket: true }, (socket) => {
      const handler = (entry: unknown) => {
        try {
          socket.send(JSON.stringify(entry));
        } catch {
          // Client disconnected
        }
      };

      this.eventBus.on('log:entry', handler);

      socket.on('close', () => {
        this.eventBus.off('log:entry', handler);
      });
    });

    this.app.get('/ws/metrics', { websocket: true }, (socket) => {
      const handler = (metrics: unknown) => {
        try {
          socket.send(JSON.stringify(metrics));
        } catch {
          // Client disconnected
        }
      };

      this.eventBus.on('metric:process', handler);
      this.eventBus.on('metric:system', handler);

      socket.on('close', () => {
        this.eventBus.off('metric:process', handler);
        this.eventBus.off('metric:system', handler);
      });
    });

    this.app.get('/ws/events', { websocket: true }, (socket) => {
      const handler = (message: unknown) => {
        try {
          socket.send(JSON.stringify(message));
        } catch {
          // Client disconnected
        }
      };

      this.eventBus.onAny(handler);

      socket.on('close', () => {
        this.eventBus.offAny(handler);
      });
    });

    // Serve dashboard static files if available
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const dashboardDir = join(__dirname, '..', 'dashboard');
    if (existsSync(dashboardDir)) {
      await this.app.register(fastifyStatic, {
        root: dashboardDir,
        prefix: '/',
        wildcard: false,
      });

      // SPA fallback: serve index.html for client-side routes
      this.app.setNotFoundHandler((_request, reply) => {
        return reply.sendFile('index.html', dashboardDir);
      });

      logger.info({ path: dashboardDir }, 'Dashboard static files registered');
    }

    await this.app.listen({ port: this.port, host: this.host });
    logger.info({ port: this.port, host: this.host }, 'HTTP server listening');
  }

  async stop(): Promise<void> {
    await this.app.close();
  }

  getAddress(): string {
    return `http://${this.host}:${this.port}`;
  }
}
