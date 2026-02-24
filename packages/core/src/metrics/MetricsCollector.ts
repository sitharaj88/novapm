import pidusage from 'pidusage';
import type { ProcessMetrics } from '@novapm/shared';
import { DEFAULT_METRICS_INTERVAL, getLogger } from '@novapm/shared';
import type { EventBus } from '../events/EventBus.js';
import type { MetricsRepository } from '../db/repositories/MetricsRepository.js';
import type { ProcessManager } from '../process/ProcessManager.js';

const logger = getLogger();

export class MetricsCollector {
  private eventBus: EventBus;
  private metricsRepo: MetricsRepository;
  private processManager: ProcessManager;
  private interval: number;
  private timer: NodeJS.Timeout | null = null;
  private latestMetrics: Map<number, ProcessMetrics> = new Map();

  constructor(
    eventBus: EventBus,
    metricsRepo: MetricsRepository,
    processManager: ProcessManager,
    interval: number = DEFAULT_METRICS_INTERVAL,
  ) {
    this.eventBus = eventBus;
    this.metricsRepo = metricsRepo;
    this.processManager = processManager;
    this.interval = interval;
  }

  start(): void {
    this.collect();
    this.timer = setInterval(() => this.collect(), this.interval);
    this.timer.unref();
    logger.info({ interval: this.interval }, 'Metrics collector started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getLatest(processId: number): ProcessMetrics | undefined {
    return this.latestMetrics.get(processId);
  }

  getAllLatest(): Map<number, ProcessMetrics> {
    return new Map(this.latestMetrics);
  }

  private async collect(): Promise<void> {
    const pids = this.processManager.getRunningPids();
    if (pids.size === 0) return;

    const pidArray = Array.from(pids.values());

    try {
      const stats = await pidusage(pidArray);

      const metricsBatch: ProcessMetrics[] = [];

      for (const [processId, pid] of pids) {
        const stat = stats[pid];
        if (!stat) continue;

        const container = this.processManager.getContainer(processId);

        const metrics: ProcessMetrics = {
          processId,
          cpu: Math.round(stat.cpu * 100) / 100,
          memory: stat.memory,
          heapUsed: 0,
          heapTotal: 0,
          eventLoopLatency: 0,
          activeHandles: 0,
          activeRequests: 0,
          uptime: container.getUptime(),
          timestamp: new Date(),
        };

        this.latestMetrics.set(processId, metrics);
        metricsBatch.push(metrics);

        this.eventBus.emit('metric:process', metrics);
      }

      if (metricsBatch.length > 0) {
        this.metricsRepo.insertBatch(metricsBatch);
      }
    } catch (err) {
      // pidusage can fail if process died between check and measurement
      logger.debug({ err }, 'Metrics collection error (process may have exited)');
    }
  }
}
