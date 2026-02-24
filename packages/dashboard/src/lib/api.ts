const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9615';

export interface ProcessInfo {
  id: string;
  name: string;
  status: 'online' | 'stopped' | 'errored' | 'launching' | 'stopping';
  pid: number | null;
  cpu: number;
  memory: number;
  restarts: number;
  uptime: number;
  script: string;
  cwd: string;
  createdAt: string;
}

export interface ProcessStartConfig {
  name: string;
  script: string;
  cwd?: string;
  args?: string[];
  env?: Record<string, string>;
  instances?: number;
  maxRestarts?: number;
}

export interface SystemMetrics {
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  uptime: number;
  loadAvg: number[];
  platform: string;
  hostname: string;
}

export interface MetricPoint {
  timestamp: string;
  cpu: number;
  memory: number;
}

export interface MetricRow {
  id: number;
  process_id: number;
  cpu: number;
  memory: number;
  heap_used: number;
  heap_total: number;
  event_loop_latency: number;
  active_handles: number;
  active_requests: number;
  timestamp: number;
}

export interface ProcessMetrics {
  processId: string;
  history: MetricPoint[];
}

export interface ServerInfo {
  id: string;
  hostname: string;
  address: string;
  port: number;
  status: 'online' | 'offline' | 'degraded';
  lastHeartbeat: string;
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

export interface LogEntry {
  id: string;
  processId: string;
  processName: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

export interface HealthStatus {
  status: string;
  version: string;
  uptime: number;
  processCount: number;
}

export function getWebSocketUrl(path: string): string {
  const wsBase = BASE_URL.replace(/^http/, 'ws');
  return `${wsBase}${path}`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Processes
  getProcesses(): Promise<ProcessInfo[]> {
    return request<ProcessInfo[]>('/api/v1/processes');
  },

  getProcess(id: string): Promise<ProcessInfo> {
    return request<ProcessInfo>(`/api/v1/processes/${id}`);
  },

  startProcess(config: ProcessStartConfig): Promise<ProcessInfo> {
    return request<ProcessInfo>('/api/v1/processes', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  restartProcess(id: string): Promise<ProcessInfo> {
    return request<ProcessInfo>(`/api/v1/processes/${id}/restart`, {
      method: 'PUT',
    });
  },

  stopProcess(id: string): Promise<ProcessInfo> {
    return request<ProcessInfo>(`/api/v1/processes/${id}/stop`, {
      method: 'PUT',
    });
  },

  deleteProcess(id: string): Promise<void> {
    return request<void>(`/api/v1/processes/${id}`, {
      method: 'DELETE',
    });
  },

  // Metrics
  getMetrics(): Promise<Record<string, unknown>> {
    return request<Record<string, unknown>>('/api/v1/metrics');
  },

  getProcessMetrics(processId: string, start?: string, end?: string): Promise<MetricRow[]> {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    const qs = params.toString();
    return request<MetricRow[]>(`/api/v1/metrics/${processId}${qs ? `?${qs}` : ''}`);
  },

  getSystemMetrics(): Promise<SystemMetrics> {
    return request<SystemMetrics>('/api/v1/system');
  },

  // Logs
  getLogs(processId?: string, lines?: number): Promise<LogEntry[]> {
    const params = new URLSearchParams();
    if (lines) params.set('lines', String(lines));

    if (processId) {
      return request<LogEntry[]>(`/api/v1/logs/${processId}?${params.toString()}`);
    }
    return request<LogEntry[]>(`/api/v1/logs?${params.toString()}`);
  },

  // Health
  getHealth(): Promise<HealthStatus> {
    return request<HealthStatus>('/api/v1/health');
  },

  // Servers
  getServers(): Promise<ServerInfo[]> {
    return request<ServerInfo[]>('/api/v1/servers');
  },

  sendServerCommand(
    serverId: string,
    command: string,
    args?: Record<string, unknown>,
  ): Promise<{ success: boolean; result?: unknown }> {
    return request('/api/v1/servers/' + serverId + '/command', {
      method: 'POST',
      body: JSON.stringify({ command, args }),
    });
  },
};
