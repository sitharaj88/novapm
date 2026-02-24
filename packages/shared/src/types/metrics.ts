export interface SystemMetrics {
  hostname: string;
  platform: string;
  arch: string;
  cpuCount: number;
  cpuModel: string;
  cpuUsage: number;
  cpuUsagePerCore: number[];
  memoryTotal: number;
  memoryUsed: number;
  memoryFree: number;
  loadAvg: [number, number, number];
  uptime: number;
  networkInterfaces: NetworkInterface[];
  diskUsage: DiskUsage[];
  timestamp: Date;
}

export interface NetworkInterface {
  name: string;
  address: string;
  rxBytes: number;
  txBytes: number;
}

export interface DiskUsage {
  mount: string;
  total: number;
  used: number;
  available: number;
}

export interface TimeSeriesPoint {
  timestamp: Date;
  value: number;
  labels?: Record<string, string>;
}
