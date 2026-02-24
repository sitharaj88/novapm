import type { FastifyInstance } from 'fastify';

interface ConnectedAgent {
  id: string;
  hostname: string;
  address: string;
  port: number;
  status: 'online' | 'offline' | 'degraded';
  lastHeartbeat: Date;
  cpuUsage: number;
  memoryUsage: number;
  processCount: number;
  uptime: number;
  version: string;
  processes: Array<{
    id: number;
    name: string;
    status: string;
    cpu: number;
    memory: number;
  }>;
  metadata: Record<string, unknown>;
}

interface ControllerLike {
  getConnectedAgents(): Map<string, ConnectedAgent>;
  sendCommand(agentId: string, command: string, args?: Record<string, unknown>): Promise<unknown>;
}

export function registerServerRoutes(
  app: FastifyInstance,
  getController: () => ControllerLike | null,
): void {
  app.get('/api/v1/servers', async (_request, _reply) => {
    const controller = getController();
    if (!controller) {
      return [];
    }

    const agents = controller.getConnectedAgents();
    const servers: ConnectedAgent[] = [];

    for (const [, agent] of agents) {
      servers.push({
        id: agent.id,
        hostname: agent.hostname,
        address: agent.address,
        port: agent.port,
        status: agent.status,
        lastHeartbeat: agent.lastHeartbeat,
        cpuUsage: agent.cpuUsage,
        memoryUsage: agent.memoryUsage,
        processCount: agent.processCount ?? agent.processes?.length ?? 0,
        uptime: agent.uptime ?? 0,
        version: agent.version ?? '',
        processes: agent.processes || [],
        metadata: agent.metadata || {},
      });
    }

    return servers;
  });

  app.post<{
    Params: { serverId: string };
    Body: { command: string; args?: Record<string, unknown> };
  }>('/api/v1/servers/:serverId/command', async (request, reply) => {
    const controller = getController();
    if (!controller) {
      reply.status(503);
      return { error: 'Controller not available' };
    }

    try {
      const result = await controller.sendCommand(
        request.params.serverId,
        request.body.command,
        request.body.args,
      );
      return { success: true, result };
    } catch (err) {
      reply.status(400);
      return { success: false, error: err instanceof Error ? err.message : 'Command failed' };
    }
  });
}
