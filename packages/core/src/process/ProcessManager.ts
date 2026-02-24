import type { AppConfig, NovaProcess } from '@novapm/shared';
import {
  DEFAULT_EXP_BACKOFF_MAX,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_RESTART_DELAY,
  ProcessAlreadyExistsError,
  ProcessNotFoundError,
  ProcessNotRunningError,
  getLogger,
} from '@novapm/shared';
import { ProcessContainer } from './ProcessContainer.js';
import type { EventBus } from '../events/EventBus.js';
import type { ProcessRepository } from '../db/repositories/ProcessRepository.js';
import type { EventRepository } from '../db/repositories/EventRepository.js';
import type { LogAggregator } from '../logs/LogAggregator.js';

const logger = getLogger();

export class ProcessManager {
  private processes: Map<number, ProcessContainer> = new Map();
  private eventBus: EventBus;
  private processRepo: ProcessRepository;
  private eventRepo: EventRepository;
  private logAggregator: LogAggregator | null = null;
  private restartTimers: Map<number, NodeJS.Timeout> = new Map();

  constructor(eventBus: EventBus, processRepo: ProcessRepository, eventRepo: EventRepository) {
    this.eventBus = eventBus;
    this.processRepo = processRepo;
    this.eventRepo = eventRepo;
  }

  setLogAggregator(logAggregator: LogAggregator): void {
    this.logAggregator = logAggregator;
  }

  async start(config: AppConfig): Promise<NovaProcess> {
    const name = config.name;

    // Check for existing process with same name
    const existing = this.findByName(name);
    if (existing && existing.isRunning()) {
      throw new ProcessAlreadyExistsError(name);
    }

    // If process was previously registered but stopped, reuse its ID
    let processRow = this.processRepo.findByName(name);
    if (!processRow) {
      processRow = this.processRepo.create(name, config);
    } else {
      this.processRepo.updateConfig(processRow.id, config);
    }

    const container = new ProcessContainer(processRow.id, name, config);

    // Set up log handlers
    container.setOutputHandlers(
      (data) => {
        this.logAggregator?.write(processRow.id, name, 'stdout', data);
      },
      (data) => {
        this.logAggregator?.write(processRow.id, name, 'stderr', data);
      },
    );

    // Set up exit handler for auto-restart
    container.setExitHandler((code, signal) => {
      this.handleProcessExit(container, code, signal);
    });

    container.start();
    this.processes.set(processRow.id, container);

    // Update DB
    if (container.pid) {
      this.processRepo.updateStarted(processRow.id, container.pid);
    }

    // Emit events
    const novaProcess = container.toNovaProcess();
    this.eventBus.emit('process:start', {
      type: 'start',
      processId: processRow.id,
      processName: name,
      timestamp: new Date(),
      data: { pid: container.pid },
    });
    this.eventRepo.insert(processRow.id, name, 'start', { pid: container.pid });

    logger.info({ processId: processRow.id, name, pid: container.pid }, 'Process started');

    return novaProcess;
  }

  async stop(identifier: string | number, force: boolean = false): Promise<void> {
    const container = this.resolve(identifier);

    if (!container.isRunning()) {
      throw new ProcessNotRunningError(identifier);
    }

    // Clear any pending restart timer
    this.clearRestartTimer(container.id);

    await container.stop(force);

    // Remove from in-memory map so it no longer appears in list
    this.processes.delete(container.id);
    this.processRepo.updateStatus(container.id, 'stopped');

    this.eventBus.emit('process:stop', {
      type: 'stop',
      processId: container.id,
      processName: container.name,
      timestamp: new Date(),
      data: { force },
    });
    this.eventRepo.insert(container.id, container.name, 'stop', { force });

    logger.info({ processId: container.id, name: container.name }, 'Process stopped');
  }

  async restart(identifier: string | number): Promise<void> {
    const container = this.resolve(identifier);
    // Stop if running
    if (container.isRunning()) {
      this.clearRestartTimer(container.id);
      await container.stop();
    }

    // Re-start
    container.start();

    if (container.pid) {
      this.processRepo.updateStarted(container.id, container.pid);
    }
    this.processRepo.resetRestarts(container.id);
    container.restarts = 0;

    this.eventBus.emit('process:restart', {
      type: 'restart',
      processId: container.id,
      processName: container.name,
      timestamp: new Date(),
      data: { pid: container.pid },
    });
    this.eventRepo.insert(container.id, container.name, 'restart', { pid: container.pid });

    logger.info({ processId: container.id, name: container.name }, 'Process restarted');
  }

  async delete(identifier: string | number): Promise<void> {
    const container = this.resolve(identifier);

    // Stop if running
    if (container.isRunning()) {
      this.clearRestartTimer(container.id);
      await container.stop(true);
    }

    this.processes.delete(container.id);
    this.processRepo.delete(container.id);

    logger.info({ processId: container.id, name: container.name }, 'Process deleted');
  }

  async stopAll(force: boolean = false): Promise<void> {
    const promises = [];
    const stoppedIds: number[] = [];
    for (const container of this.processes.values()) {
      if (container.isRunning()) {
        this.clearRestartTimer(container.id);
        stoppedIds.push(container.id);
        promises.push(container.stop(force));
      }
    }
    await Promise.allSettled(promises);

    // Remove stopped processes from in-memory map
    for (const id of stoppedIds) {
      this.processes.delete(id);
    }
  }

  async restartAll(): Promise<void> {
    for (const container of this.processes.values()) {
      await this.restart(container.id);
    }
  }

  async deleteAll(): Promise<void> {
    await this.stopAll(true);
    this.processes.clear();
    this.processRepo.deleteAll();
  }

  list(): NovaProcess[] {
    return Array.from(this.processes.values()).map((c) => c.toNovaProcess());
  }

  info(identifier: string | number): NovaProcess {
    const container = this.resolve(identifier);
    return container.toNovaProcess();
  }

  getContainer(identifier: string | number): ProcessContainer {
    return this.resolve(identifier);
  }

  getRunningPids(): Map<number, number> {
    const pids = new Map<number, number>();
    for (const [id, container] of this.processes) {
      if (container.pid) {
        pids.set(id, container.pid);
      }
    }
    return pids;
  }

  /**
   * Restore processes from database on daemon startup.
   */
  restoreFromDb(): void {
    const rows = this.processRepo.findAll();
    for (const row of rows) {
      const config = this.processRepo.parseConfig(row);
      const container = new ProcessContainer(row.id, row.name, config);
      container.restarts = row.restarts;
      container.createdAt = new Date(row.created_at * 1000);
      this.processes.set(row.id, container);
    }
    logger.info({ count: rows.length }, 'Restored processes from database');
  }

  private resolve(identifier: string | number): ProcessContainer {
    // Try by ID first
    if (typeof identifier === 'number') {
      const container = this.processes.get(identifier);
      if (!container) throw new ProcessNotFoundError(identifier);
      return container;
    }

    // Try parsing as number
    const numId = parseInt(identifier, 10);
    if (!isNaN(numId)) {
      const container = this.processes.get(numId);
      if (container) return container;
    }

    // Try by name
    const byName = this.findByName(identifier);
    if (byName) return byName;

    throw new ProcessNotFoundError(identifier);
  }

  private findByName(name: string): ProcessContainer | undefined {
    for (const container of this.processes.values()) {
      if (container.name === name) return container;
    }
    return undefined;
  }

  private handleProcessExit(
    container: ProcessContainer,
    code: number | null,
    signal: string | null,
  ): void {
    // Capture whether this was an intentional stop before status is overwritten
    const wasIntentionallyStopped = container.status === 'stopping';

    const isCrash = code !== 0 && code !== null;

    if (isCrash) {
      container.status = 'errored';
      this.processRepo.updateStatus(container.id, 'errored');

      this.eventBus.emit('process:crash', {
        type: 'crash',
        processId: container.id,
        processName: container.name,
        timestamp: new Date(),
        data: { exitCode: code, signal },
      });
      this.eventRepo.insert(container.id, container.name, 'crash', { exitCode: code, signal });

      logger.warn(
        { processId: container.id, name: container.name, code, signal },
        'Process crashed',
      );
    } else {
      container.status = 'stopped';
      this.processRepo.updateStatus(container.id, 'stopped');

      this.eventBus.emit('process:exit', {
        type: 'exit',
        processId: container.id,
        processName: container.name,
        timestamp: new Date(),
        data: { exitCode: code, signal },
      });

      logger.info({ processId: container.id, name: container.name, code }, 'Process exited');
    }

    // Skip auto-restart if process was intentionally stopped (via stop/delete/stopAll)
    if (wasIntentionallyStopped) {
      return;
    }

    // Auto-restart logic
    const autorestart = container.config.autorestart ?? true;
    const maxRestarts = container.config.max_restarts ?? DEFAULT_MAX_RESTARTS;

    if (autorestart && container.restarts < maxRestarts) {
      const delay = this.calculateRestartDelay(container);
      container.status = 'waiting-restart';
      container.restarts++;

      this.processRepo.incrementRestarts(container.id);
      this.processRepo.updateStatus(container.id, 'waiting-restart');

      logger.info(
        { processId: container.id, name: container.name, delay, attempt: container.restarts },
        'Scheduling auto-restart',
      );

      const timer = setTimeout(() => {
        this.restartTimers.delete(container.id);

        container.setOutputHandlers(
          (data) => {
            this.logAggregator?.write(container.id, container.name, 'stdout', data);
          },
          (data) => {
            this.logAggregator?.write(container.id, container.name, 'stderr', data);
          },
        );
        container.setExitHandler((c, s) => this.handleProcessExit(container, c, s));

        container.start();
        if (container.pid) {
          this.processRepo.updateStarted(container.id, container.pid);
        }
      }, delay);

      timer.unref();
      this.restartTimers.set(container.id, timer);
    } else if (autorestart && container.restarts >= maxRestarts) {
      container.status = 'errored';
      this.processRepo.updateStatus(container.id, 'errored');
      logger.error(
        { processId: container.id, name: container.name, restarts: container.restarts },
        'Max restarts reached, giving up',
      );
    }
  }

  private calculateRestartDelay(container: ProcessContainer): number {
    const baseDelay = container.config.restart_delay ?? DEFAULT_RESTART_DELAY;
    const expBackoff = container.config.exp_backoff_restart_delay ?? 0;

    if (expBackoff > 0) {
      // Exponential backoff: base * 2^restarts, capped
      const delay = expBackoff * Math.pow(2, container.restarts);
      return Math.min(delay, DEFAULT_EXP_BACKOFF_MAX);
    }

    return baseDelay;
  }

  private clearRestartTimer(processId: number): void {
    const timer = this.restartTimers.get(processId);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(processId);
    }
  }
}
