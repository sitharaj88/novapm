import type { FastifyInstance } from 'fastify';
import type { MetricsCollector } from '../../metrics/MetricsCollector.js';
import type { SystemMetricsCollector } from '../../metrics/SystemMetricsCollector.js';
import type { MetricsRepository } from '../../db/repositories/MetricsRepository.js';

export function registerMetricRoutes(
  app: FastifyInstance,
  metricsCollector: MetricsCollector,
  systemMetrics: SystemMetricsCollector,
  metricsRepo: MetricsRepository,
): void {
  // Get all latest process metrics
  app.get('/api/v1/metrics', async () => {
    const all = metricsCollector.getAllLatest();
    const result: Record<string, unknown> = {};
    for (const [id, metrics] of all) {
      result[id] = metrics;
    }
    return result;
  });

  // Get metrics for a specific process
  app.get<{
    Params: { processId: string };
    Querystring: { start?: string; end?: string };
  }>('/api/v1/metrics/:processId', async (request) => {
    const processId = parseInt(request.params.processId, 10);

    if (request.query.start && request.query.end) {
      const startTime = Math.floor(new Date(request.query.start).getTime() / 1000);
      const endTime = Math.floor(new Date(request.query.end).getTime() / 1000);
      return metricsRepo.getRange(processId, startTime, endTime);
    }

    return metricsCollector.getLatest(processId) || null;
  });

  // Get system metrics
  app.get('/api/v1/system', async () => {
    return systemMetrics.getLatest();
  });
}
