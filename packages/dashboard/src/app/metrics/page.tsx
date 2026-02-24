'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MetricRow } from '@/lib/api';
import { Header } from '@/components/Header';
import { MetricChart } from '@/components/MetricChart';
import { cn, formatBytes } from '@/lib/utils';
import { useWebSocket, useSystemMetricsBuffer } from '@/lib/useWebSocket';

const timeRanges = [
  { label: '1h', value: '1h', ms: 3600000 },
  { label: '6h', value: '6h', ms: 21600000 },
  { label: '24h', value: '24h', ms: 86400000 },
  { label: '7d', value: '7d', ms: 604800000 },
];

function formatTimestamp(ts: number, range: string): string {
  const d = new Date(ts * 1000);
  if (range === '7d') {
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
  }
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function metricsToChartData(rows: MetricRow[], range: string) {
  return rows.map((r) => ({
    time: formatTimestamp(r.timestamp, range),
    cpu: r.cpu,
    memory: r.memory,
  }));
}

export default function MetricsPage() {
  const [timeRange, setTimeRange] = useState('1h');
  const [selectedProcess, setSelectedProcess] = useState<string>('all');

  const { data: processes = [] } = useQuery({
    queryKey: ['processes'],
    queryFn: () => api.getProcesses(),
  });

  const { data: systemMetrics } = useQuery({
    queryKey: ['system'],
    queryFn: () => api.getSystemMetrics(),
  });

  // Real-time system metrics via WebSocket
  const { buffer: systemBuffer, addPoint } = useSystemMetricsBuffer();

  useWebSocket({
    path: '/ws/metrics',
    onMessage: addPoint,
  });

  // Compute time range boundaries for process metrics API call
  const timeRangeConfig = useMemo(() => {
    const tr = timeRanges.find((t) => t.value === timeRange);
    const ms = tr?.ms || 3600000;
    const end = new Date();
    const start = new Date(end.getTime() - ms);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [timeRange]);

  // Fetch per-process metrics from API with time range
  const processId = selectedProcess !== 'all' ? selectedProcess : processes[0]?.id;
  const { data: processMetricsRaw = [] } = useQuery({
    queryKey: ['processMetrics', processId, timeRangeConfig.start, timeRangeConfig.end],
    queryFn: () =>
      processId
        ? api.getProcessMetrics(processId, timeRangeConfig.start, timeRangeConfig.end)
        : Promise.resolve([]),
    enabled: !!processId,
  });

  const processChartData = useMemo(
    () => metricsToChartData(processMetricsRaw, timeRange),
    [processMetricsRaw, timeRange],
  );

  // Use WebSocket buffer for system charts (real-time data)
  const systemChartData = useMemo(() => {
    if (systemBuffer.length > 0) {
      return systemBuffer;
    }
    // Fallback: show current system metrics as a single point
    if (systemMetrics) {
      const now = new Date();
      return [
        {
          time: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
          cpu: systemMetrics.cpu.usage,
          memory: systemMetrics.memory.percentage,
          load: systemMetrics.loadAvg[0] || 0,
        },
      ];
    }
    return [];
  }, [systemBuffer, systemMetrics]);

  const handleProcessChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedProcess(e.target.value);
  }, []);

  return (
    <div className="space-y-6">
      <Header
        title="Metrics"
        description="System and process performance monitoring"
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-nova-border bg-nova-card p-1">
            {timeRanges.map((tr) => (
              <button
                key={tr.value}
                onClick={() => setTimeRange(tr.value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  timeRange === tr.value
                    ? 'bg-nova-purple text-white'
                    : 'text-nova-text-secondary hover:text-nova-text-primary'
                )}
              >
                {tr.label}
              </button>
            ))}
          </div>
        }
      />

      {/* System Overview */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-nova-text-primary">
          System Overview
        </h2>

        {/* System info cards */}
        {systemMetrics && (
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-nova-border bg-nova-card p-4">
              <p className="text-xs font-medium text-nova-text-muted">Platform</p>
              <p className="mt-1 text-sm font-medium text-nova-text-primary">
                {systemMetrics.platform}
              </p>
            </div>
            <div className="rounded-lg border border-nova-border bg-nova-card p-4">
              <p className="text-xs font-medium text-nova-text-muted">Hostname</p>
              <p className="mt-1 text-sm font-medium text-nova-text-primary">
                {systemMetrics.hostname}
              </p>
            </div>
            <div className="rounded-lg border border-nova-border bg-nova-card p-4">
              <p className="text-xs font-medium text-nova-text-muted">CPU Model</p>
              <p className="mt-1 text-sm font-medium text-nova-text-primary">
                {systemMetrics.cpu.model}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MetricChart
            title="CPU Usage"
            data={systemChartData}
            dataKeys={[{ key: 'cpu', color: '#22d3ee', name: 'CPU %' }]}
            yAxisFormatter={(v) => `${v.toFixed(0)}%`}
          />
          <MetricChart
            title="Memory Usage"
            data={systemChartData}
            dataKeys={[{ key: 'memory', color: '#6c5ce7', name: 'Memory %' }]}
            yAxisFormatter={(v) => `${v.toFixed(0)}%`}
          />
        </div>

        <div className="mt-6">
          <MetricChart
            title="Load Average"
            data={systemChartData}
            dataKeys={[{ key: 'load', color: '#3b82f6', name: 'Load Avg' }]}
            yAxisFormatter={(v) => v.toFixed(1)}
            height={200}
          />
        </div>
      </div>

      {/* Per-Process Metrics */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-nova-text-primary">
            Per-Process Metrics
          </h2>
          <select
            value={selectedProcess}
            onChange={handleProcessChange}
            className="rounded-lg border border-nova-border bg-nova-card px-3 py-2 text-sm text-nova-text-primary focus:border-nova-purple focus:outline-none focus:ring-1 focus:ring-nova-purple"
          >
            <option value="all">All Processes</option>
            {processes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {processChartData.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <MetricChart
              title="Process CPU"
              data={processChartData}
              dataKeys={[{ key: 'cpu', color: '#00d68f', name: 'CPU %' }]}
              yAxisFormatter={(v) => `${v.toFixed(0)}%`}
            />
            <MetricChart
              title="Process Memory"
              data={processChartData}
              dataKeys={[{ key: 'memory', color: '#ff4757', name: 'Memory' }]}
              yAxisFormatter={(v) => formatBytes(v)}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-nova-border bg-nova-card p-12 text-center">
            <p className="text-sm text-nova-text-muted">
              {processes.length === 0
                ? 'No processes running. Start a process to see metrics.'
                : 'Select a process to view detailed metrics, or wait for data to accumulate.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
