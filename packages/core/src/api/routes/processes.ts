import type { FastifyInstance } from 'fastify';
import type { ProcessManager } from '../../process/ProcessManager.js';
import type { MetricsCollector } from '../../metrics/MetricsCollector.js';
import type { AppConfig } from '@novapm/shared';
import {
  ProcessNotFoundError,
  ProcessAlreadyExistsError,
  ProcessNotRunningError,
} from '@novapm/shared';

export function registerProcessRoutes(
  app: FastifyInstance,
  processManager: ProcessManager,
  metricsCollector: MetricsCollector,
): void {
  // List all processes
  app.get('/api/v1/processes', async () => {
    const processes = processManager.list();
    return processes.map((proc) => ({
      ...proc,
      metrics: metricsCollector.getLatest(proc.id) || null,
    }));
  });

  // Get single process info
  app.get<{ Params: { id: string } }>('/api/v1/processes/:id', async (request, reply) => {
    try {
      const id = parseInt(request.params.id, 10);
      const proc = processManager.info(isNaN(id) ? request.params.id : id);
      const metrics = metricsCollector.getLatest(proc.id);
      return { ...proc, metrics: metrics || null };
    } catch (err) {
      reply.status(404);
      return { error: err instanceof Error ? err.message : 'Process not found' };
    }
  });

  // Start a new process
  app.post<{ Body: AppConfig }>('/api/v1/processes', async (request, reply) => {
    try {
      const proc = await processManager.start(request.body);
      reply.status(201);
      return proc;
    } catch (err) {
      if (err instanceof ProcessAlreadyExistsError) {
        reply.status(409);
      } else {
        reply.status(400);
      }
      return { error: err instanceof Error ? err.message : 'Failed to start process' };
    }
  });

  // Restart a process
  app.put<{ Params: { id: string } }>('/api/v1/processes/:id/restart', async (request, reply) => {
    try {
      const id = parseInt(request.params.id, 10);
      await processManager.restart(isNaN(id) ? request.params.id : id);
      return { status: 'ok' };
    } catch (err) {
      reply.status(err instanceof ProcessNotFoundError ? 404 : 400);
      return { error: err instanceof Error ? err.message : 'Failed to restart process' };
    }
  });

  // Stop a process
  app.put<{ Params: { id: string } }>('/api/v1/processes/:id/stop', async (request, reply) => {
    try {
      const id = parseInt(request.params.id, 10);
      await processManager.stop(isNaN(id) ? request.params.id : id);
      return { status: 'ok' };
    } catch (err) {
      if (err instanceof ProcessNotFoundError) {
        reply.status(404);
      } else if (err instanceof ProcessNotRunningError) {
        reply.status(409);
      } else {
        reply.status(400);
      }
      return { error: err instanceof Error ? err.message : 'Failed to stop process' };
    }
  });

  // Delete a process
  app.delete<{ Params: { id: string } }>('/api/v1/processes/:id', async (request, reply) => {
    try {
      const id = parseInt(request.params.id, 10);
      await processManager.delete(isNaN(id) ? request.params.id : id);
      return { status: 'ok' };
    } catch (err) {
      reply.status(err instanceof ProcessNotFoundError ? 404 : 400);
      return { error: err instanceof Error ? err.message : 'Failed to delete process' };
    }
  });
}
