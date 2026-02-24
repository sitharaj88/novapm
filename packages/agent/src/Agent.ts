import { EventEmitter } from 'node:events';
import os from 'node:os';
import { WebSocket } from 'ws';
import { createLogger, NOVA_VERSION, DEFAULT_AGENT_PORT } from '@novapm/shared';

import type {
  AgentConfig,
  AgentMessage,
  AgentMessageType,
  CommandMessage,
  CommandResultMessage,
  HeartbeatMessage,
  RegisterMessage,
  ServerInfo,
  ProcessSummary,
} from './types.js';

const logger = createLogger({ name: 'agent' });

/**
 * Default agent configuration values.
 */
const DEFAULT_AGENT_CONFIG: Omit<AgentConfig, 'controllerHost' | 'controllerPort'> = {
  agentPort: DEFAULT_AGENT_PORT,
  heartbeatInterval: 30_000,
  reconnectInterval: 5_000,
  maxReconnectAttempts: 50,
};

/**
 * Lightweight agent that runs on each managed server.
 * Connects to a central Controller via WebSocket and reports
 * system metrics, process status, and executes remote commands.
 */
export class Agent extends EventEmitter {
  private config: AgentConfig;
  private ws: WebSocket | null = null;
  private agentId: string;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private metricsBuffer: unknown[] = [];
  private stopping: boolean = false;
  private commandHandlers: Map<string, (params: unknown) => Promise<unknown>> = new Map();

  constructor(
    config: Partial<AgentConfig> & Pick<AgentConfig, 'controllerHost' | 'controllerPort'>,
  ) {
    super();
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    this.agentId = config.controllerId ?? `agent-${os.hostname()}-${process.pid}`;
  }

  /**
   * Start the agent: connect to the controller, begin heartbeats and metrics streaming.
   */
  async start(): Promise<void> {
    logger.info({ agentId: this.agentId }, 'Starting agent');
    this.stopping = false;
    this.reconnectAttempts = 0;
    await this.connect();
  }

  /**
   * Gracefully stop the agent: notify controller, close connection, clear timers.
   */
  async stop(): Promise<void> {
    logger.info({ agentId: this.agentId }, 'Stopping agent');
    this.stopping = true;

    this.clearTimers();

    if (this.ws && this.connected) {
      this.sendMessage('disconnect', { reason: 'shutdown' });
      // Give a brief window for the disconnect message to flush
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          if (this.ws) {
            this.ws.close(1000, 'Agent shutting down');
            this.ws = null;
          }
          resolve();
        }, 500);
      });
    } else if (this.ws) {
      this.ws.close(1000, 'Agent shutting down');
      this.ws = null;
    }

    this.connected = false;
    this.emit('stopped');
    logger.info({ agentId: this.agentId }, 'Agent stopped');
  }

  /**
   * Register a command handler that the controller can invoke remotely.
   */
  registerCommandHandler(command: string, handler: (params: unknown) => Promise<unknown>): void {
    this.commandHandlers.set(command, handler);
  }

  /**
   * Check whether the agent is currently connected to the controller.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the agent's unique identifier.
   */
  getId(): string {
    return this.agentId;
  }

  /**
   * Flush buffered metrics by sending them to the controller.
   */
  flushMetrics(): void {
    if (this.metricsBuffer.length === 0 || !this.connected) {
      return;
    }

    this.sendMessage('metrics', { metrics: this.metricsBuffer });
    this.metricsBuffer = [];
  }

  /**
   * Add a metrics data point to the buffer.
   */
  pushMetric(metric: unknown): void {
    this.metricsBuffer.push(metric);

    // Auto-flush when buffer reaches threshold
    if (this.metricsBuffer.length >= 100) {
      this.flushMetrics();
    }
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Establish a WebSocket connection to the controller with reconnect logic.
   */
  private connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `ws://${this.config.controllerHost}:${this.config.controllerPort}`;
      logger.info({ url }, 'Connecting to controller');

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        logger.error({ err }, 'Failed to create WebSocket');
        reject(err);
        return;
      }

      const connectionTimeout = setTimeout(() => {
        if (this.ws && !this.connected) {
          this.ws.close();
          const error = new Error('Connection timeout');
          reject(error);
        }
      }, 10_000);

      this.ws.on('open', () => {
        clearTimeout(connectionTimeout);
        logger.info('Connected to controller');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.register();
        this.startHeartbeat();
        this.emit('connected');
        resolve();
      });

      this.ws.on('message', (data: Buffer | string) => {
        this.handleIncomingMessage(data);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(connectionTimeout);
        const wasConnected = this.connected;
        this.connected = false;
        this.clearTimers();

        logger.warn(
          { code, reason: reason.toString(), wasConnected },
          'Disconnected from controller',
        );

        this.emit('disconnected', { code, reason: reason.toString() });

        if (!this.stopping) {
          this.reconnect();
        }
      });

      this.ws.on('error', (err: Error) => {
        logger.error({ err }, 'WebSocket error');
        this.emit('error', err);
        // The 'close' event will fire after error, which will trigger reconnect
      });
    });
  }

  /**
   * Send registration message with server info and optional auth token.
   */
  private register(): void {
    const registerData: RegisterMessage = {
      serverInfo: this.getServerInfo(),
      token: this.config.auth?.token,
    };
    this.sendMessage('register', registerData);
    logger.info({ agentId: this.agentId }, 'Registered with controller');
  }

  /**
   * Start the periodic heartbeat that sends server info to the controller.
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);
  }

  /**
   * Send a heartbeat with server info and process summaries.
   */
  private sendHeartbeat(): void {
    if (!this.connected) {
      return;
    }

    const heartbeatData: HeartbeatMessage = {
      serverInfo: this.getServerInfo(),
      processes: this.getProcessSummaries(),
    };

    this.sendMessage('heartbeat', heartbeatData);

    // Also flush buffered metrics on heartbeat
    this.flushMetrics();
  }

  /**
   * Handle an incoming message from the controller.
   */
  private handleIncomingMessage(data: Buffer | string): void {
    let message: AgentMessage;
    try {
      const raw = typeof data === 'string' ? data : data.toString('utf-8');
      message = JSON.parse(raw) as AgentMessage;
    } catch {
      logger.error('Failed to parse incoming message');
      return;
    }

    switch (message.type) {
      case 'command':
        void this.handleCommand(message);
        break;
      default:
        logger.debug({ type: message.type }, 'Received message');
        this.emit('message', message);
    }
  }

  /**
   * Route a command from the controller, execute it locally, and send the result back.
   */
  private async handleCommand(message: AgentMessage): Promise<void> {
    const commandData = message.data as CommandMessage;
    const { command, params, requestId } = commandData;

    logger.info({ command, requestId }, 'Received command');

    const handler = this.commandHandlers.get(command);

    const resultMessage: CommandResultMessage = {
      requestId,
      success: false,
      result: null,
    };

    if (!handler) {
      resultMessage.error = `Unknown command: ${command}`;
      logger.warn({ command }, 'No handler registered for command');
    } else {
      try {
        resultMessage.result = await handler(params);
        resultMessage.success = true;
      } catch (err) {
        resultMessage.error = err instanceof Error ? err.message : String(err);
        logger.error({ err, command }, 'Command execution failed');
      }
    }

    this.sendMessage('command-result', resultMessage);
  }

  /**
   * Gather local system information using the os module.
   */
  private getServerInfo(): ServerInfo {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Calculate average CPU usage across all cores
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      totalIdle += cpu.times.idle;
      totalTick += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }
    const cpuUsage = totalTick > 0 ? ((totalTick - totalIdle) / totalTick) * 100 : 0;

    // Get primary non-internal IPv4 address
    const interfaces = os.networkInterfaces();
    let address = '127.0.0.1';
    for (const ifaceList of Object.values(interfaces)) {
      if (!ifaceList) continue;
      for (const iface of ifaceList) {
        if (!iface.internal && iface.family === 'IPv4') {
          address = iface.address;
          break;
        }
      }
    }

    return {
      id: this.agentId,
      hostname: os.hostname(),
      address,
      port: this.config.agentPort,
      status: 'online',
      lastHeartbeat: new Date(),
      metadata: {
        platform: os.platform(),
        arch: os.arch(),
        cpuCount: cpus.length,
        memoryTotal: totalMem,
        novaVersion: NOVA_VERSION,
      },
      processes: 0, // Updated by command handlers
      cpuUsage: Math.round(cpuUsage * 100) / 100,
      memoryUsage: Math.round((usedMem / totalMem) * 10000) / 100,
    };
  }

  /**
   * Retrieve process summaries. Returns an empty array by default;
   * callers should register a command handler for 'process.list' to provide real data.
   */
  private getProcessSummaries(): ProcessSummary[] {
    // This would be populated by the process manager integration
    return [];
  }

  /**
   * Send a typed message to the controller over WebSocket.
   */
  private sendMessage(type: AgentMessageType, data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ type }, 'Cannot send message, not connected');
      return;
    }

    const message: AgentMessage = {
      type,
      agentId: this.agentId,
      timestamp: new Date().toISOString(),
      data,
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (err) {
      logger.error({ err, type }, 'Failed to send message');
    }
  }

  /**
   * Attempt to reconnect with exponential backoff.
   * Caps at maxReconnectAttempts.
   */
  private reconnect(): void {
    if (this.stopping) {
      return;
    }

    this.reconnectAttempts += 1;

    if (this.reconnectAttempts > this.config.maxReconnectAttempts) {
      logger.error(
        { attempts: this.reconnectAttempts, max: this.config.maxReconnectAttempts },
        'Max reconnect attempts reached, giving up',
      );
      this.emit('reconnect-failed');
      return;
    }

    // Exponential backoff with jitter, capped at 60 seconds
    const baseDelay = this.config.reconnectInterval;
    const exponentialDelay = baseDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 10));
    const jitter = Math.random() * baseDelay;
    const delay = Math.min(exponentialDelay + jitter, 60_000);

    logger.info(
      { attempt: this.reconnectAttempts, delay: Math.round(delay) },
      'Scheduling reconnect',
    );

    setTimeout(() => {
      if (!this.stopping) {
        this.connect().catch((err) => {
          logger.error({ err }, 'Reconnect failed');
        });
      }
    }, delay);
  }

  /**
   * Clear all active timers.
   */
  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
