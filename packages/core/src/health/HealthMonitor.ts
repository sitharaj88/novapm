import { createConnection, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { parseDuration, getLogger } from '@novapm/shared';
import type { HealthCheckConfig } from '@novapm/shared';
import type { EventBus } from '../events/EventBus.js';
import type { ProcessManager } from '../process/ProcessManager.js';

const logger = getLogger();

interface HealthCheckState {
  processId: number;
  processName: string;
  config: HealthCheckConfig;
  consecutiveFailures: number;
  lastCheck: Date | null;
  healthy: boolean;
  timer: NodeJS.Timeout | null;
  inStartPeriod: boolean;
}

export class HealthMonitor {
  private eventBus: EventBus;
  private processManager: ProcessManager;
  private checks: Map<number, HealthCheckState> = new Map();

  constructor(eventBus: EventBus, processManager: ProcessManager) {
    this.eventBus = eventBus;
    this.processManager = processManager;
  }

  register(processId: number, processName: string, config: HealthCheckConfig): void {
    // Remove existing check for this process
    this.unregister(processId);

    const interval = parseDuration(config.interval);
    const startPeriod = config.start_period ? parseDuration(config.start_period) : 0;

    const state: HealthCheckState = {
      processId,
      processName,
      config,
      consecutiveFailures: 0,
      lastCheck: null,
      healthy: true,
      timer: null,
      inStartPeriod: startPeriod > 0,
    };

    // Start period grace
    if (startPeriod > 0) {
      setTimeout(() => {
        state.inStartPeriod = false;
      }, startPeriod).unref();
    }

    // Schedule periodic checks
    state.timer = setInterval(() => {
      this.runCheck(state);
    }, interval);
    state.timer.unref();

    this.checks.set(processId, state);
    logger.info({ processId, processName, type: config.type }, 'Health check registered');
  }

  unregister(processId: number): void {
    const state = this.checks.get(processId);
    if (state?.timer) {
      clearInterval(state.timer);
    }
    this.checks.delete(processId);
  }

  unregisterAll(): void {
    for (const [id] of this.checks) {
      this.unregister(id);
    }
  }

  isHealthy(processId: number): boolean {
    const state = this.checks.get(processId);
    return state?.healthy ?? true;
  }

  private async runCheck(state: HealthCheckState): Promise<void> {
    if (state.inStartPeriod) return;

    const container = this.processManager.getContainer(state.processId);
    if (!container.isRunning()) return;

    const timeout = parseDuration(state.config.timeout);

    try {
      let healthy: boolean;

      switch (state.config.type) {
        case 'http':
          healthy = await this.httpCheck(state.config, timeout);
          break;
        case 'tcp':
          healthy = await this.tcpCheck(state.config, timeout);
          break;
        case 'script':
          healthy = await this.scriptCheck(state.config, timeout);
          break;
        default:
          healthy = true;
      }

      state.lastCheck = new Date();

      if (healthy) {
        if (!state.healthy) {
          // Recovered
          state.healthy = true;
          state.consecutiveFailures = 0;
          this.eventBus.emit('health:restore', {
            type: 'health-check-restore',
            processId: state.processId,
            processName: state.processName,
            timestamp: new Date(),
            data: {},
          });
          logger.info(
            { processId: state.processId, name: state.processName },
            'Health check restored',
          );
        }
        state.consecutiveFailures = 0;
      } else {
        state.consecutiveFailures++;
        logger.warn(
          {
            processId: state.processId,
            name: state.processName,
            failures: state.consecutiveFailures,
          },
          'Health check failed',
        );

        if (state.consecutiveFailures >= state.config.retries) {
          state.healthy = false;

          this.eventBus.emit('health:fail', {
            type: 'health-check-fail',
            processId: state.processId,
            processName: state.processName,
            timestamp: new Date(),
            data: { consecutiveFailures: state.consecutiveFailures },
          });

          // Auto-restart on health check failure
          try {
            await this.processManager.restart(state.processId);
            state.consecutiveFailures = 0;
          } catch (err) {
            logger.error(
              { err, processId: state.processId },
              'Failed to restart unhealthy process',
            );
          }
        }
      }
    } catch (err) {
      logger.debug({ err, processId: state.processId }, 'Health check error');
    }
  }

  private httpCheck(config: HealthCheckConfig, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const host = config.host || '127.0.0.1';
      const port = config.port || 80;
      const path = config.path || '/';
      const url = `http://${host}:${port}${path}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch(url, { signal: controller.signal as any })
        .then((res) => {
          clearTimeout(timer);
          resolve(res.ok);
        })
        .catch(() => {
          clearTimeout(timer);
          resolve(false);
        });
    });
  }

  private tcpCheck(config: HealthCheckConfig, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const host = config.host || '127.0.0.1';
      const port = config.port || 80;

      let socket: Socket | null = null;
      const timer = setTimeout(() => {
        socket?.destroy();
        resolve(false);
      }, timeout);

      socket = createConnection({ host, port }, () => {
        clearTimeout(timer);
        socket?.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  private scriptCheck(config: HealthCheckConfig, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!config.script) {
        resolve(false);
        return;
      }

      const child = spawn('sh', ['-c', config.script], {
        timeout,
        stdio: 'ignore',
      });

      child.on('exit', (code: number | null) => {
        resolve(code === 0);
      });

      child.on('error', (_err: Error) => {
        resolve(false);
      });
    });
  }
}
