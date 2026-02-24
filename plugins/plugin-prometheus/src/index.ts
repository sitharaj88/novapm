import type {
  NovaPMPlugin,
  PluginContext,
  RouteDefinition,
} from '@novapm/plugin-sdk';
import type { ProcessMetrics, SystemMetrics } from '@novapm/shared';

/**
 * Metric types supported by Prometheus text format.
 */
type PrometheusMetricType = 'gauge' | 'counter';

/**
 * Internal representation of a Prometheus metric.
 */
interface PrometheusMetric {
  name: string;
  help: string;
  type: PrometheusMetricType;
  values: MetricValue[];
}

interface MetricValue {
  labels: Record<string, string>;
  value: number;
}

/**
 * Prometheus metrics exporter plugin for NovaPM.
 *
 * Exposes a /metrics endpoint in Prometheus text exposition format,
 * providing real-time process and system metrics for scraping.
 *
 * Exported metrics:
 * - novapm_process_cpu_usage (gauge)
 * - novapm_process_memory_bytes (gauge)
 * - novapm_process_restarts_total (counter)
 * - novapm_process_uptime_seconds (gauge)
 * - novapm_system_cpu_usage (gauge)
 * - novapm_system_memory_used_bytes (gauge)
 */
class PrometheusPlugin implements NovaPMPlugin {
  readonly name = 'plugin-prometheus';
  readonly version = '1.0.0';
  readonly description = 'Prometheus metrics exporter for NovaPM';
  readonly author = 'NovaPM Team';

  private context: PluginContext | null = null;
  private latestProcessMetrics: ProcessMetrics[] = [];
  private latestSystemMetrics: SystemMetrics | null = null;

  async onInit(context: PluginContext): Promise<void> {
    this.context = context;
    context.logger.info('Prometheus plugin initialized');
  }

  async onDestroy(): Promise<void> {
    this.context?.logger.info('Prometheus plugin destroyed');
  }

  async onMetricsCollected(metrics: ProcessMetrics[]): Promise<void> {
    this.latestProcessMetrics = metrics;
  }

  async onSystemMetrics(metrics: SystemMetrics): Promise<void> {
    this.latestSystemMetrics = metrics;
  }

  routes(): RouteDefinition[] {
    return [
      {
        method: 'GET',
        path: '/api/v1/plugins/prometheus/metrics',
        handler: async (_request: unknown, _reply: unknown): Promise<unknown> => {
          const metricsText = this.generateMetricsOutput();
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
            body: metricsText,
          };
        },
      },
    ];
  }

  /**
   * Generate the Prometheus text exposition format output.
   */
  private generateMetricsOutput(): string {
    const metrics: PrometheusMetric[] = [];

    // Process-level metrics
    this.buildProcessMetrics(metrics);

    // System-level metrics
    this.buildSystemMetrics(metrics);

    return this.formatMetrics(metrics);
  }

  /**
   * Build process-level Prometheus metrics from the latest collected data.
   */
  private buildProcessMetrics(metrics: PrometheusMetric[]): void {
    const cpuMetric: PrometheusMetric = {
      name: 'novapm_process_cpu_usage',
      help: 'Current CPU usage of the process as a percentage',
      type: 'gauge',
      values: [],
    };

    const memoryMetric: PrometheusMetric = {
      name: 'novapm_process_memory_bytes',
      help: 'Current memory usage of the process in bytes',
      type: 'gauge',
      values: [],
    };

    const restartsMetric: PrometheusMetric = {
      name: 'novapm_process_restarts_total',
      help: 'Total number of process restarts',
      type: 'counter',
      values: [],
    };

    const uptimeMetric: PrometheusMetric = {
      name: 'novapm_process_uptime_seconds',
      help: 'Process uptime in seconds',
      type: 'gauge',
      values: [],
    };

    // Gather per-process info from the API
    const processes = this.context?.api.getProcesses() ?? [];

    for (const processMetric of this.latestProcessMetrics) {
      const process = processes.find((p) => p.id === processMetric.processId);
      const processName = process?.name ?? `process-${processMetric.processId}`;
      const labels: Record<string, string> = {
        process_id: String(processMetric.processId),
        process_name: processName,
      };

      cpuMetric.values.push({ labels, value: processMetric.cpu });
      memoryMetric.values.push({ labels, value: processMetric.memory });
      uptimeMetric.values.push({ labels, value: processMetric.uptime / 1000 });

      if (process) {
        restartsMetric.values.push({ labels, value: process.restarts });
      }
    }

    metrics.push(cpuMetric, memoryMetric, restartsMetric, uptimeMetric);
  }

  /**
   * Build system-level Prometheus metrics from the latest collected data.
   */
  private buildSystemMetrics(metrics: PrometheusMetric[]): void {
    if (!this.latestSystemMetrics) return;

    const systemCpuMetric: PrometheusMetric = {
      name: 'novapm_system_cpu_usage',
      help: 'Current system CPU usage as a percentage',
      type: 'gauge',
      values: [
        {
          labels: { hostname: this.latestSystemMetrics.hostname },
          value: this.latestSystemMetrics.cpuUsage,
        },
      ],
    };

    const systemMemoryMetric: PrometheusMetric = {
      name: 'novapm_system_memory_used_bytes',
      help: 'Current system memory usage in bytes',
      type: 'gauge',
      values: [
        {
          labels: { hostname: this.latestSystemMetrics.hostname },
          value: this.latestSystemMetrics.memoryUsed,
        },
      ],
    };

    const systemMemoryTotalMetric: PrometheusMetric = {
      name: 'novapm_system_memory_total_bytes',
      help: 'Total system memory in bytes',
      type: 'gauge',
      values: [
        {
          labels: { hostname: this.latestSystemMetrics.hostname },
          value: this.latestSystemMetrics.memoryTotal,
        },
      ],
    };

    const systemUptimeMetric: PrometheusMetric = {
      name: 'novapm_system_uptime_seconds',
      help: 'System uptime in seconds',
      type: 'gauge',
      values: [
        {
          labels: { hostname: this.latestSystemMetrics.hostname },
          value: this.latestSystemMetrics.uptime,
        },
      ],
    };

    const loadAvgMetric: PrometheusMetric = {
      name: 'novapm_system_load_average',
      help: 'System load average',
      type: 'gauge',
      values: [
        {
          labels: {
            hostname: this.latestSystemMetrics.hostname,
            period: '1m',
          },
          value: this.latestSystemMetrics.loadAvg[0],
        },
        {
          labels: {
            hostname: this.latestSystemMetrics.hostname,
            period: '5m',
          },
          value: this.latestSystemMetrics.loadAvg[1],
        },
        {
          labels: {
            hostname: this.latestSystemMetrics.hostname,
            period: '15m',
          },
          value: this.latestSystemMetrics.loadAvg[2],
        },
      ],
    };

    metrics.push(
      systemCpuMetric,
      systemMemoryMetric,
      systemMemoryTotalMetric,
      systemUptimeMetric,
      loadAvgMetric,
    );
  }

  /**
   * Format metrics into Prometheus text exposition format.
   */
  private formatMetrics(metrics: PrometheusMetric[]): string {
    const lines: string[] = [];

    for (const metric of metrics) {
      if (metric.values.length === 0) continue;

      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);

      for (const value of metric.values) {
        const labelStr = this.formatLabels(value.labels);
        lines.push(`${metric.name}${labelStr} ${value.value}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format label key-value pairs for Prometheus text exposition.
   */
  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return '';

    const parts = entries.map(
      ([key, value]) => `${key}="${this.escapeLabel(value)}"`,
    );
    return `{${parts.join(',')}}`;
  }

  /**
   * Escape label values according to Prometheus text format rules.
   */
  private escapeLabel(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }
}

export default new PrometheusPlugin();
