import { cpus, freemem, hostname, loadavg, platform, arch, totalmem, uptime } from 'node:os';
import type { SystemMetrics } from '@novapm/shared';
import type { EventBus } from '../events/EventBus.js';

export class SystemMetricsCollector {
  private eventBus: EventBus;
  private timer: NodeJS.Timeout | null = null;
  private lastCpuTimes: { idle: number; total: number }[] = [];
  private latest: SystemMetrics | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.initCpuTimes();
  }

  start(interval: number = 5000): void {
    this.collect();
    this.timer = setInterval(() => this.collect(), interval);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getLatest(): SystemMetrics | null {
    return this.latest;
  }

  private collect(): void {
    const cpuInfo = cpus();
    const cpuUsagePerCore = this.calculateCpuUsage(cpuInfo);
    const totalCpuUsage =
      cpuUsagePerCore.length > 0
        ? cpuUsagePerCore.reduce((a, b) => a + b, 0) / cpuUsagePerCore.length
        : 0;

    const metrics: SystemMetrics = {
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      cpuCount: cpuInfo.length,
      cpuModel: cpuInfo[0]?.model ?? 'unknown',
      cpuUsage: Math.round(totalCpuUsage * 100) / 100,
      cpuUsagePerCore,
      memoryTotal: totalmem(),
      memoryUsed: totalmem() - freemem(),
      memoryFree: freemem(),
      loadAvg: loadavg() as [number, number, number],
      uptime: uptime(),
      networkInterfaces: [],
      diskUsage: [],
      timestamp: new Date(),
    };

    this.latest = metrics;
    this.eventBus.emit('metric:system', metrics);
  }

  private initCpuTimes(): void {
    const cpuInfo = cpus();
    this.lastCpuTimes = cpuInfo.map((cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      return { idle: cpu.times.idle, total };
    });
  }

  private calculateCpuUsage(cpuInfo: ReturnType<typeof cpus>): number[] {
    const usage: number[] = [];

    for (let i = 0; i < cpuInfo.length; i++) {
      const cpu = cpuInfo[i];
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;

      const last = this.lastCpuTimes[i];
      if (last) {
        const totalDiff = total - last.total;
        const idleDiff = idle - last.idle;
        const percent = totalDiff > 0 ? ((totalDiff - idleDiff) / totalDiff) * 100 : 0;
        usage.push(Math.round(percent * 100) / 100);
      } else {
        usage.push(0);
      }

      this.lastCpuTimes[i] = { idle, total };
    }

    return usage;
  }
}
