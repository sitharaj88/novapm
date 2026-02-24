import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '@novapm/shared';

import type {
  AgentMessage,
  CommandMessage,
  CommandResultMessage,
  ConnectedAgent,
  ControllerConfig,
  DeploymentPlan,
  HeartbeatMessage,
  RegisterMessage,
  ServerInfo,
} from './types.js';
import { SecureChannel } from './SecureChannel.js';

const logger = createLogger({ name: 'controller' });

/** How often to check for dead agents (ms). */
const DEAD_AGENT_CHECK_INTERVAL = 60_000;

/** Agent is considered dead after this duration without heartbeat (ms). */
const AGENT_TIMEOUT = 90_000;

/** Default timeout waiting for a command result (ms). */
const COMMAND_TIMEOUT = 30_000;

/**
 * Central controller that manages all connected agents.
 * Runs a WebSocket server and accepts agent connections,
 * routes commands, and tracks cluster-wide state.
 */
export class Controller extends EventEmitter {
  private config: ControllerConfig;
  private wss: WebSocketServer | null = null;
  private agents: Map<string, ConnectedAgent> = new Map();
  private deployments: Map<string, DeploymentPlan> = new Map();
  private deadAgentTimer: ReturnType<typeof setInterval> | null = null;
  private pendingCommands: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  constructor(config: ControllerConfig) {
    super();
    this.config = config;
  }

  /**
   * Start the WebSocket server and begin accepting agent connections.
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.config.port,
          host: this.config.host,
        });
      } catch (err) {
        reject(err);
        return;
      }

      this.wss.on('listening', () => {
        logger.info(
          { host: this.config.host, port: this.config.port },
          'Controller WebSocket server listening',
        );
        this.startDeadAgentDetection();
        this.emit('started');
        resolve();
      });

      this.wss.on('error', (err: Error) => {
        logger.error({ err }, 'WebSocket server error');
        this.emit('error', err);
        reject(err);
      });

      this.wss.on('connection', (ws: WebSocket) => {
        this.handleConnection(ws);
      });
    });
  }

  /**
   * Gracefully stop the controller: disconnect all agents and close the server.
   */
  async stop(): Promise<void> {
    logger.info('Stopping controller');

    if (this.deadAgentTimer) {
      clearInterval(this.deadAgentTimer);
      this.deadAgentTimer = null;
    }

    // Reject all pending commands
    for (const [requestId, pending] of this.pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Controller shutting down'));
      this.pendingCommands.delete(requestId);
    }

    // Close all agent connections
    for (const [agentId, agent] of this.agents) {
      try {
        agent.ws.close(1001, 'Controller shutting down');
      } catch {
        // Ignore errors during shutdown
      }
      this.agents.delete(agentId);
    }

    // Close the server
    return new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          this.wss = null;
          logger.info('Controller stopped');
          this.emit('stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Send a command to a specific agent and wait for the result.
   * Times out after 30 seconds by default.
   */
  async sendCommand(
    agentId: string,
    command: string,
    params: unknown,
    timeout: number = COMMAND_TIMEOUT,
  ): Promise<unknown> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Agent not connected: ${agentId}`);
    }

    const requestId = randomUUID();

    const commandData: CommandMessage = {
      command,
      params,
      requestId,
    };

    const message: AgentMessage = {
      type: 'command',
      agentId: 'controller',
      timestamp: new Date().toISOString(),
      data: commandData,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`Command timeout after ${timeout}ms: ${command} -> ${agentId}`));
      }, timeout);

      this.pendingCommands.set(requestId, { resolve, reject, timer });

      try {
        agent.ws.send(JSON.stringify(message));
      } catch (err) {
        clearTimeout(timer);
        this.pendingCommands.delete(requestId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Send a command to all connected agents and collect results.
   * Returns a map of agentId -> result (or error).
   */
  async broadcastCommand(
    command: string,
    params: unknown,
    timeout: number = COMMAND_TIMEOUT,
  ): Promise<Map<string, unknown>> {
    const results = new Map<string, unknown>();
    const agentIds = Array.from(this.agents.keys());

    const promises = agentIds.map(async (agentId) => {
      try {
        const result = await this.sendCommand(agentId, command, params, timeout);
        results.set(agentId, result);
      } catch (err) {
        results.set(agentId, { error: err instanceof Error ? err.message : String(err) });
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * Return a list of all connected agents with their server info.
   */
  getAgents(): ServerInfo[] {
    const agents: ServerInfo[] = [];
    for (const agent of this.agents.values()) {
      agents.push({ ...agent.info });
    }
    return agents;
  }

  /**
   * Get a specific agent's server info by ID.
   */
  getAgent(agentId: string): ServerInfo | null {
    const agent = this.agents.get(agentId);
    return agent ? { ...agent.info } : null;
  }

  /**
   * Get the number of currently connected agents.
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * Store a deployment plan for tracking.
   */
  addDeployment(plan: DeploymentPlan): void {
    this.deployments.set(plan.id, plan);
  }

  /**
   * Get a deployment plan by ID.
   */
  getDeployment(id: string): DeploymentPlan | null {
    return this.deployments.get(id) ?? null;
  }

  /**
   * Get all tracked deployment plans.
   */
  getDeployments(): DeploymentPlan[] {
    return Array.from(this.deployments.values());
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Handle a new WebSocket connection from an agent.
   */
  private handleConnection(ws: WebSocket): void {
    logger.info('New agent connection');

    let registeredAgentId: string | null = null;

    ws.on('message', (data: Buffer | string) => {
      let message: AgentMessage;
      try {
        const raw = typeof data === 'string' ? data : data.toString('utf-8');
        message = JSON.parse(raw) as AgentMessage;
      } catch {
        logger.error('Failed to parse agent message');
        return;
      }

      switch (message.type) {
        case 'register':
          registeredAgentId = message.agentId;
          this.handleRegistration(ws, message);
          break;
        case 'heartbeat':
          this.handleHeartbeat(message.agentId, message);
          break;
        case 'metrics':
          this.handleMetrics(message.agentId, message);
          break;
        case 'command-result':
          this.handleCommandResult(message);
          break;
        case 'disconnect':
          this.handleDisconnect(message.agentId);
          break;
        default:
          logger.debug({ type: message.type, agentId: message.agentId }, 'Received message');
          this.emit('message', message);
      }
    });

    ws.on('close', () => {
      if (registeredAgentId) {
        this.handleDisconnect(registeredAgentId);
      }
    });

    ws.on('error', (err: Error) => {
      logger.error({ err, agentId: registeredAgentId }, 'Agent WebSocket error');
    });
  }

  /**
   * Handle agent registration: authenticate, store agent info, emit event.
   */
  private handleRegistration(ws: WebSocket, message: AgentMessage): void {
    const registerData = message.data as RegisterMessage;
    const agentId = message.agentId;

    // Authenticate if auth is configured
    if (this.config.auth?.tokens && this.config.auth.tokens.length > 0) {
      if (
        !registerData.token ||
        !SecureChannel.verifyToken(registerData.token, this.config.auth.tokens)
      ) {
        logger.warn({ agentId }, 'Agent authentication failed');
        ws.close(4001, 'Authentication failed');
        return;
      }
    }

    const agent: ConnectedAgent = {
      info: registerData.serverInfo,
      ws,
      lastSeen: new Date(),
    };

    this.agents.set(agentId, agent);

    logger.info({ agentId, hostname: registerData.serverInfo.hostname }, 'Agent registered');

    this.emit('agent:join', registerData.serverInfo);
  }

  /**
   * Handle agent heartbeat: update last seen timestamp and server info.
   */
  private handleHeartbeat(agentId: string, message: AgentMessage): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      logger.warn({ agentId }, 'Heartbeat from unknown agent');
      return;
    }

    const heartbeatData = message.data as HeartbeatMessage;

    agent.lastSeen = new Date();
    agent.info = heartbeatData.serverInfo;
    agent.info.lastHeartbeat = new Date();
    agent.info.processes = heartbeatData.processes.length;

    this.emit('agent:heartbeat', {
      agentId,
      serverInfo: heartbeatData.serverInfo,
      processes: heartbeatData.processes,
    });
  }

  /**
   * Handle metrics data from an agent.
   */
  private handleMetrics(agentId: string, message: AgentMessage): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      logger.warn({ agentId }, 'Metrics from unknown agent');
      return;
    }

    agent.lastSeen = new Date();
    this.emit('agent:metrics', { agentId, data: message.data });
  }

  /**
   * Handle a command result from an agent.
   */
  private handleCommandResult(message: AgentMessage): void {
    const resultData = message.data as CommandResultMessage;
    const pending = this.pendingCommands.get(resultData.requestId);

    if (!pending) {
      logger.warn(
        { requestId: resultData.requestId },
        'Received result for unknown command request',
      );
      return;
    }

    clearTimeout(pending.timer);
    this.pendingCommands.delete(resultData.requestId);

    if (resultData.success) {
      pending.resolve(resultData.result);
    } else {
      pending.reject(new Error(resultData.error ?? 'Command failed'));
    }
  }

  /**
   * Handle agent disconnection: clean up and emit event.
   */
  private handleDisconnect(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    agent.info.status = 'offline';
    const serverInfo = { ...agent.info };
    this.agents.delete(agentId);

    logger.info({ agentId }, 'Agent disconnected');
    this.emit('agent:leave', serverInfo);
  }

  /**
   * Periodically check for agents that have stopped sending heartbeats.
   */
  private startDeadAgentDetection(): void {
    this.deadAgentTimer = setInterval(() => {
      this.checkDeadAgents();
    }, DEAD_AGENT_CHECK_INTERVAL);
  }

  /**
   * Mark agents as offline if no heartbeat has been received within the timeout.
   */
  private checkDeadAgents(): void {
    const now = Date.now();

    for (const [agentId, agent] of this.agents) {
      const elapsed = now - agent.lastSeen.getTime();

      if (elapsed > AGENT_TIMEOUT) {
        logger.warn({ agentId, lastSeen: agent.lastSeen, elapsed }, 'Agent appears dead, removing');

        agent.info.status = 'offline';
        const serverInfo = { ...agent.info };

        try {
          agent.ws.close(4000, 'Heartbeat timeout');
        } catch {
          // Ignore close errors
        }

        this.agents.delete(agentId);
        this.emit('agent:leave', serverInfo);
      } else if (elapsed > AGENT_TIMEOUT * 0.67) {
        // Mark as degraded if heartbeat is late but not timed out
        if (agent.info.status !== 'degraded') {
          agent.info.status = 'degraded';
          this.emit('agent:degraded', { ...agent.info });
        }
      }
    }
  }
}
