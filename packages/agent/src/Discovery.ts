import { promises as dns } from 'node:dns';
import { DEFAULT_AGENT_PORT } from '@novapm/shared';

import type { AgentConfig } from './types.js';

/**
 * Service discovery for agents to locate the controller.
 * Supports configuration-based, environment variable, and DNS SRV discovery.
 */
export class Discovery {
  /**
   * Create an AgentConfig from explicit host/port configuration.
   */
  static fromConfig(config: {
    host: string;
    port: number;
    agentPort?: number;
    heartbeatInterval?: number;
    reconnectInterval?: number;
    maxReconnectAttempts?: number;
    token?: string;
  }): AgentConfig {
    return {
      controllerHost: config.host,
      controllerPort: config.port,
      agentPort: config.agentPort ?? DEFAULT_AGENT_PORT,
      heartbeatInterval: config.heartbeatInterval ?? 30_000,
      reconnectInterval: config.reconnectInterval ?? 5_000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 50,
      auth: config.token ? { token: config.token } : undefined,
    };
  }

  /**
   * Create an AgentConfig from environment variables.
   * Checks:
   *   - NOVA_CONTROLLER_HOST (required)
   *   - NOVA_CONTROLLER_PORT (required)
   *   - NOVA_AGENT_PORT (optional)
   *   - NOVA_AGENT_TOKEN (optional)
   *   - NOVA_HEARTBEAT_INTERVAL (optional, ms)
   *   - NOVA_RECONNECT_INTERVAL (optional, ms)
   *   - NOVA_MAX_RECONNECT_ATTEMPTS (optional)
   *
   * Returns null if the required environment variables are not set.
   */
  static fromEnvironment(): AgentConfig | null {
    const host = process.env['NOVA_CONTROLLER_HOST'];
    const portStr = process.env['NOVA_CONTROLLER_PORT'];

    if (!host || !portStr) {
      return null;
    }

    const port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return null;
    }

    const agentPortStr = process.env['NOVA_AGENT_PORT'];
    const agentPort = agentPortStr ? parseInt(agentPortStr, 10) : DEFAULT_AGENT_PORT;

    const heartbeatStr = process.env['NOVA_HEARTBEAT_INTERVAL'];
    const heartbeatInterval = heartbeatStr ? parseInt(heartbeatStr, 10) : 30_000;

    const reconnectStr = process.env['NOVA_RECONNECT_INTERVAL'];
    const reconnectInterval = reconnectStr ? parseInt(reconnectStr, 10) : 5_000;

    const maxReconnectStr = process.env['NOVA_MAX_RECONNECT_ATTEMPTS'];
    const maxReconnectAttempts = maxReconnectStr ? parseInt(maxReconnectStr, 10) : 50;

    const token = process.env['NOVA_AGENT_TOKEN'];

    return {
      controllerHost: host,
      controllerPort: port,
      agentPort: isNaN(agentPort) ? DEFAULT_AGENT_PORT : agentPort,
      heartbeatInterval: isNaN(heartbeatInterval) ? 30_000 : heartbeatInterval,
      reconnectInterval: isNaN(reconnectInterval) ? 5_000 : reconnectInterval,
      maxReconnectAttempts: isNaN(maxReconnectAttempts) ? 50 : maxReconnectAttempts,
      auth: token ? { token } : undefined,
    };
  }

  /**
   * Discover the controller via DNS SRV record lookup.
   * Looks up _novapm._tcp.<serviceName> SRV records.
   *
   * Returns null if no records are found or DNS lookup fails.
   */
  static async fromDNS(serviceName: string): Promise<AgentConfig | null> {
    const srvName = `_novapm._tcp.${serviceName}`;

    try {
      const records = await dns.resolveSrv(srvName);

      if (records.length === 0) {
        return null;
      }

      // Sort by priority (lower is better), then by weight (higher is better)
      records.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return b.weight - a.weight;
      });

      const bestRecord = records[0];
      if (!bestRecord) {
        return null;
      }

      return {
        controllerHost: bestRecord.name,
        controllerPort: bestRecord.port,
        agentPort: DEFAULT_AGENT_PORT,
        heartbeatInterval: 30_000,
        reconnectInterval: 5_000,
        maxReconnectAttempts: 50,
      };
    } catch {
      // DNS lookup failed (ENOTFOUND, ENODATA, etc.)
      return null;
    }
  }
}
