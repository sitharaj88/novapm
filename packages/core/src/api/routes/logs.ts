import type { FastifyInstance } from 'fastify';
import type { LogAggregator } from '../../logs/LogAggregator.js';

export function registerLogRoutes(app: FastifyInstance, logAggregator: LogAggregator): void {
  // Get recent logs for a process
  app.get<{
    Params: { processId: string };
    Querystring: { lines?: string };
  }>('/api/v1/logs/:processId', async (request) => {
    const processId = parseInt(request.params.processId, 10);
    const lines = request.query.lines ? parseInt(request.query.lines, 10) : 50;
    return logAggregator.getRecentLogs(processId, lines);
  });

  // Get all recent logs
  app.get<{
    Querystring: { lines?: string };
  }>('/api/v1/logs', async (request) => {
    const lines = request.query.lines ? parseInt(request.query.lines, 10) : 50;
    return logAggregator.getAllRecentLogs(lines);
  });
}
