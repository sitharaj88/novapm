import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { NOVA_LOG_DIR } from '@novapm/shared';
import type { LogEntry } from '@novapm/shared';
import type { EventBus } from '../events/EventBus.js';

export class LogAggregator {
  private logDir: string;
  private streams: Map<string, { out: WriteStream; err: WriteStream }> = new Map();
  private eventBus: EventBus;
  private recentLogs: Map<number, LogEntry[]> = new Map();
  private maxRecentLogs: number = 1000;

  constructor(eventBus: EventBus, logDir: string = NOVA_LOG_DIR) {
    this.eventBus = eventBus;
    this.logDir = logDir;
    mkdirSync(this.logDir, { recursive: true });
  }

  write(processId: number, processName: string, stream: 'stdout' | 'stderr', data: Buffer): void {
    const message = data.toString().trimEnd();
    if (!message) return;

    // Write to file
    const fileStream = this.getStream(processName);
    const timestamp = new Date().toISOString();
    const line = `${timestamp} | ${message}\n`;

    if (stream === 'stdout') {
      fileStream.out.write(line);
    } else {
      fileStream.err.write(line);
    }

    // Create log entry
    const entry: LogEntry = {
      processId,
      processName,
      stream,
      message,
      timestamp: new Date(),
    };

    // Store in recent logs buffer
    let recent = this.recentLogs.get(processId);
    if (!recent) {
      recent = [];
      this.recentLogs.set(processId, recent);
    }
    recent.push(entry);
    if (recent.length > this.maxRecentLogs) {
      recent.shift();
    }

    // Emit for real-time streaming
    this.eventBus.emit('log:entry', entry);
  }

  getRecentLogs(processId: number, lines: number = 50): LogEntry[] {
    const recent = this.recentLogs.get(processId) || [];
    return recent.slice(-lines);
  }

  getAllRecentLogs(lines: number = 50): LogEntry[] {
    const all: LogEntry[] = [];
    for (const logs of this.recentLogs.values()) {
      all.push(...logs);
    }
    all.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return all.slice(-lines);
  }

  getLogFiles(processName: string): { out: string; err: string } {
    return {
      out: join(this.logDir, `${processName}-out.log`),
      err: join(this.logDir, `${processName}-error.log`),
    };
  }

  async flush(): Promise<void> {
    const drainPromises: Promise<void>[] = [];
    for (const streams of this.streams.values()) {
      drainPromises.push(
        new Promise<void>((resolve) => streams.out.end(resolve)),
        new Promise<void>((resolve) => streams.err.end(resolve)),
      );
    }
    await Promise.allSettled(drainPromises);
    this.streams.clear();
  }

  removeProcess(processId: number): void {
    this.recentLogs.delete(processId);
  }

  private getStream(processName: string): { out: WriteStream; err: WriteStream } {
    let streams = this.streams.get(processName);
    if (!streams) {
      const files = this.getLogFiles(processName);
      streams = {
        out: createWriteStream(files.out, { flags: 'a' }),
        err: createWriteStream(files.err, { flags: 'a' }),
      };
      this.streams.set(processName, streams);
    }
    return streams;
  }
}
