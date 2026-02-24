function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

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
  const base = getBaseUrl();
  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}${path}`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    headers,
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// Transform raw API process response to dashboard ProcessInfo format.
// API returns: id (number), metrics (object|null with cpu/memory), startedAt (Date), createdAt (Date)
// Dashboard expects: id (string), cpu/memory/uptime at top level, createdAt (ISO string)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformProcess(raw: any): ProcessInfo {
  const metrics = raw.metrics || {};
  const startedAt = raw.startedAt ? new Date(raw.startedAt).getTime() : 0;
  const uptime =
    startedAt && raw.status === 'online' ? Math.floor((Date.now() - startedAt) / 1000) : 0;

  return {
    id: String(raw.id),
    name: raw.name || '',
    status: raw.status || 'stopped',
    pid: raw.pid ?? null,
    cpu: metrics.cpu ?? 0,
    memory: metrics.memory ?? 0,
    restarts: raw.restarts ?? 0,
    uptime,
    script: raw.script || '',
    cwd: raw.cwd || '',
    createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : '',
  };
}

// Transform raw API log entry to dashboard LogEntry format.
// API returns: processId (number), stream ('stdout'|'stderr'), no id/level
// Dashboard expects: processId (string), level ('info'|'error'|...), id (string)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformLog(raw: any, index: number): LogEntry {
  let level: LogEntry['level'] = 'info';
  if (raw.level) {
    level = raw.level;
  } else if (raw.stream === 'stderr') {
    level = 'error';
  }

  return {
    id: raw.id ? String(raw.id) : `log-${Date.now()}-${index}`,
    processId: String(raw.processId),
    processName: raw.processName || '',
    timestamp: raw.timestamp ? new Date(raw.timestamp).toISOString() : new Date().toISOString(),
    level,
    message: raw.message || '',
  };
}

export const api = {
  // Processes
  async getProcesses(): Promise<ProcessInfo[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await request<any[]>('/api/v1/processes');
    return raw.map(transformProcess);
  },

  async getProcess(id: string): Promise<ProcessInfo> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await request<any>(`/api/v1/processes/${id}`);
    return transformProcess(raw);
  },

  async startProcess(config: ProcessStartConfig): Promise<ProcessInfo> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await request<any>('/api/v1/processes', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    return transformProcess(raw);
  },

  restartProcess(id: string): Promise<{ status: string }> {
    return request<{ status: string }>(`/api/v1/processes/${id}/restart`, {
      method: 'PUT',
    });
  },

  stopProcess(id: string): Promise<{ status: string }> {
    return request<{ status: string }>(`/api/v1/processes/${id}/stop`, {
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

  async getSystemMetrics(): Promise<SystemMetrics> {
    // Transform flat API response to nested format expected by dashboard.
    // API returns: cpuUsage, cpuCount, cpuModel, memoryTotal, memoryUsed, memoryFree, etc.
    // Dashboard expects: cpu.usage, cpu.cores, cpu.model, memory.total, memory.used, etc.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await request<any>('/api/v1/system');
    const memTotal = (raw.memoryTotal as number) || 0;
    const memUsed = (raw.memoryUsed as number) || 0;
    const memFree = (raw.memoryFree as number) || 0;
    return {
      cpu: {
        usage: (raw.cpuUsage as number) || 0,
        cores: (raw.cpuCount as number) || 0,
        model: (raw.cpuModel as string) || '',
      },
      memory: {
        total: memTotal,
        used: memUsed,
        free: memFree,
        percentage: memTotal > 0 ? (memUsed / memTotal) * 100 : 0,
      },
      uptime: (raw.uptime as number) || 0,
      loadAvg: (raw.loadAvg as number[]) || [],
      platform: (raw.platform as string) || '',
      hostname: (raw.hostname as string) || '',
    };
  },

  // Logs
  async getLogs(processId?: string, lines?: number): Promise<LogEntry[]> {
    const params = new URLSearchParams();
    if (lines) params.set('lines', String(lines));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let raw: any[];
    if (processId) {
      raw = await request<unknown[]>(`/api/v1/logs/${processId}?${params.toString()}`);
    } else {
      raw = await request<unknown[]>(`/api/v1/logs?${params.toString()}`);
    }
    return raw.map(transformLog);
  },

  // Health
  async getHealth(): Promise<HealthStatus> {
    // API returns { status, timestamp }. Fill in defaults for fields the dashboard expects.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await request<any>('/api/v1/health');
    return {
      status: raw.status || 'ok',
      version: raw.version || '1.0.0',
      uptime: raw.uptime ?? 0,
      processCount: raw.processCount ?? 0,
    };
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
