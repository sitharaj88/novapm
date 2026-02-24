import { mkdirSync } from 'node:fs';
import { NOVA_HOME, NOVA_LOG_DIR, getLogger } from '@novapm/shared';
import { getDatabase, closeDatabase } from '../db/Database.js';
import { ProcessRepository } from '../db/repositories/ProcessRepository.js';
import { MetricsRepository } from '../db/repositories/MetricsRepository.js';
import { EventRepository } from '../db/repositories/EventRepository.js';
import { EventBus } from '../events/EventBus.js';
import { ProcessManager } from '../process/ProcessManager.js';
import { LogAggregator } from '../logs/LogAggregator.js';
import { MetricsCollector } from '../metrics/MetricsCollector.js';
import { SystemMetricsCollector } from '../metrics/SystemMetricsCollector.js';
import { HealthMonitor } from '../health/HealthMonitor.js';
import { IPCServer } from '../ipc/IPCServer.js';
import { HTTPServer } from '../api/HTTPServer.js';

const logger = getLogger();

export class NovaDaemon {
  private eventBus: EventBus;
  private processManager!: ProcessManager;
  private logAggregator!: LogAggregator;
  private metricsCollector!: MetricsCollector;
  private systemMetrics!: SystemMetricsCollector;
  private healthMonitor!: HealthMonitor;
  private ipcServer!: IPCServer;
  private httpServer!: HTTPServer;
  private processRepo!: ProcessRepository;
  private metricsRepo!: MetricsRepository;
  private eventRepo!: EventRepository;
  private running: boolean = false;

  constructor() {
    this.eventBus = new EventBus();
  }

  async start(): Promise<void> {
    if (this.running) return;

    logger.info('NovaPM daemon starting...');

    // Ensure directories exist
    mkdirSync(NOVA_HOME, { recursive: true });
    mkdirSync(NOVA_LOG_DIR, { recursive: true });

    // 1. Initialize database
    const db = getDatabase();
    this.processRepo = new ProcessRepository(db);
    this.metricsRepo = new MetricsRepository(db);
    this.eventRepo = new EventRepository(db);

    // 2. Initialize subsystems
    this.logAggregator = new LogAggregator(this.eventBus);
    this.processManager = new ProcessManager(this.eventBus, this.processRepo, this.eventRepo);
    this.processManager.setLogAggregator(this.logAggregator);

    this.metricsCollector = new MetricsCollector(
      this.eventBus,
      this.metricsRepo,
      this.processManager,
    );
    this.systemMetrics = new SystemMetricsCollector(this.eventBus);
    this.healthMonitor = new HealthMonitor(this.eventBus, this.processManager);

    // 3. Restore saved processes from database
    this.processManager.restoreFromDb();

    // 4. Start IPC server
    this.ipcServer = new IPCServer(
      this.processManager,
      this.logAggregator,
      this.metricsCollector,
      this.systemMetrics,
    );
    this.ipcServer.setStopHandler(() => this.stop());
    await this.ipcServer.start();

    // 5. Start HTTP server
    this.httpServer = new HTTPServer(
      this.processManager,
      this.metricsCollector,
      this.systemMetrics,
      this.logAggregator,
      this.metricsRepo,
      this.eventBus,
    );
    await this.httpServer.start();

    // 6. Start metrics and system monitoring
    this.metricsCollector.start();
    this.systemMetrics.start();

    // 7. Set up signal handlers
    this.setupSignalHandlers();

    // 8. Periodic maintenance
    this.startMaintenance();

    this.running = true;
    logger.info({ pid: process.pid }, 'NovaPM daemon started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('NovaPM daemon stopping...');

    this.running = false;

    // Stop in reverse order
    this.metricsCollector.stop();
    this.systemMetrics.stop();
    this.healthMonitor.unregisterAll();

    // Stop all managed processes
    await this.processManager.stopAll();

    // Close servers
    await this.httpServer.stop();
    await this.ipcServer.stop();

    // Flush logs
    await this.logAggregator.flush();

    // Close database
    closeDatabase();

    // Clean up event bus
    this.eventBus.removeAllListeners();

    logger.info('NovaPM daemon stopped');

    process.exit(0);
  }

  private setupSignalHandlers(): void {
    const shutdown = async () => {
      await this.stop();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGHUP', () => {
      logger.info('Received SIGHUP, reloading configuration...');
      // Future: reload config
    });
  }

  private startMaintenance(): void {
    // Run maintenance every hour
    const timer = setInterval(
      () => {
        try {
          this.metricsRepo.downsample();
          this.eventRepo.cleanup();
        } catch (err) {
          logger.error({ err }, 'Maintenance task failed');
        }
      },
      60 * 60 * 1000,
    );
    timer.unref();
  }
}
