export type ProcessStatus =
  | 'online'
  | 'stopping'
  | 'stopped'
  | 'errored'
  | 'launching'
  | 'waiting-restart'
  | 'one-launch-status';

export interface NovaProcess {
  id: number;
  name: string;
  script: string;
  cwd: string;
  args: string[];
  interpreter: string;
  interpreterArgs: string[];
  execMode: 'fork' | 'cluster';
  instances: number;
  status: ProcessStatus;
  pid: number | null;
  port: number | null;
  env: Record<string, string>;
  createdAt: Date;
  startedAt: Date | null;
  restarts: number;
  maxRestarts: number;
  restartDelay: number;
  expBackoffRestartDelay: number;
  maxMemoryRestart: string | null;
  autorestart: boolean;
  watch: boolean | string[];
  ignoreWatch: string[];
  killTimeout: number;
  listenTimeout: number;
  shutdownWithMessage: boolean;
  windowsHide: boolean;
  mergeLogs: boolean;
  sourceMapSupport: boolean;
  vizion: boolean;
}

export interface ProcessMetrics {
  processId: number;
  cpu: number;
  memory: number;
  heapUsed: number;
  heapTotal: number;
  eventLoopLatency: number;
  activeHandles: number;
  activeRequests: number;
  uptime: number;
  timestamp: Date;
}

export type ProcessEventType =
  | 'start'
  | 'stop'
  | 'restart'
  | 'error'
  | 'exit'
  | 'crash'
  | 'online'
  | 'log'
  | 'metric'
  | 'health-check-fail'
  | 'health-check-restore'
  | 'scaling';

export interface ProcessEvent {
  type: ProcessEventType;
  processId: number;
  processName: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface LogEntry {
  processId: number;
  processName: string;
  stream: 'stdout' | 'stderr';
  message: string;
  timestamp: Date;
  level?: string;
}
