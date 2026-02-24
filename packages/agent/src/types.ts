export interface ServerInfo {
  id: string;
  hostname: string;
  address: string;
  port: number;
  status: 'online' | 'offline' | 'degraded';
  lastHeartbeat: Date;
  metadata: {
    platform: string;
    arch: string;
    cpuCount: number;
    memoryTotal: number;
    novaVersion: string;
  };
  processes: number;
  cpuUsage: number;
  memoryUsage: number;
}

export interface AgentConfig {
  controllerId?: string;
  controllerHost: string;
  controllerPort: number;
  agentPort: number;
  heartbeatInterval: number;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  auth?: {
    token?: string;
  };
}

export interface ControllerConfig {
  port: number;
  host: string;
  auth?: {
    tokens: string[];
  };
}

export interface AgentMessage {
  type: AgentMessageType;
  agentId: string;
  timestamp: string;
  data: unknown;
}

export type AgentMessageType =
  | 'register'
  | 'heartbeat'
  | 'metrics'
  | 'process-list'
  | 'command'
  | 'command-result'
  | 'log-stream'
  | 'disconnect';

export interface DeploymentPlan {
  id: string;
  strategy: 'rolling' | 'canary' | 'blue-green';
  servers: string[];
  config: Record<string, unknown>;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'rolled-back';
  startedAt?: Date;
  completedAt?: Date;
  currentStep: number;
  totalSteps: number;
  errors: string[];
}

export interface CommandMessage {
  command: string;
  params: unknown;
  requestId: string;
}

export interface CommandResultMessage {
  requestId: string;
  success: boolean;
  result: unknown;
  error?: string;
}

export interface RegisterMessage {
  serverInfo: ServerInfo;
  token?: string;
}

export interface HeartbeatMessage {
  serverInfo: ServerInfo;
  processes: ProcessSummary[];
}

export interface ProcessSummary {
  id: number;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
}

export interface ConnectedAgent {
  info: ServerInfo;
  ws: import('ws').WebSocket;
  lastSeen: Date;
}
