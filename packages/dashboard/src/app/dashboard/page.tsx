'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Header } from '@/components/Header';
import { StatsCard } from '@/components/StatsCard';
import { ProcessTable } from '@/components/ProcessTable';
import { MetricChart } from '@/components/MetricChart';
import { LogViewer } from '@/components/LogViewer';
import { Server, Cpu, MemoryStick, Clock } from 'lucide-react';
import { formatBytes, formatUptime } from '@/lib/utils';
import { useWebSocket, useSystemMetricsBuffer } from '@/lib/useWebSocket';

export default function DashboardPage() {
  const queryClient = useQueryClient();

  const { data: processes = [] } = useQuery({
    queryKey: ['processes'],
    queryFn: () => api.getProcesses(),
  });

  const { data: systemMetrics } = useQuery({
    queryKey: ['system'],
    queryFn: () => api.getSystemMetrics(),
  });

  const { data: logs = [] } = useQuery({
    queryKey: ['logs', 'recent'],
    queryFn: () => api.getLogs(undefined, 10),
  });

  // Real-time system metrics via WebSocket
  const { buffer: metricsBuffer, addPoint } = useSystemMetricsBuffer();

  useWebSocket({
    path: '/ws/metrics',
    onMessage: addPoint,
  });

  const restartMutation = useMutation({
    mutationFn: (id: string) => api.restartProcess(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['processes'] }),
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.stopProcess(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['processes'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProcess(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['processes'] }),
  });

  const onlineCount = processes.filter((p) => p.status === 'online').length;
  const totalCpu = processes.reduce((sum, p) => sum + p.cpu, 0);
  const totalMemory = processes.reduce((sum, p) => sum + p.memory, 0);

  // Use real-time WebSocket data for the chart, fallback to current system metric
  const chartData = metricsBuffer.length > 0
    ? metricsBuffer
    : systemMetrics
      ? [
          {
            time: 'now',
            cpu: systemMetrics.cpu.usage,
            memory: systemMetrics.memory.percentage,
          },
        ]
      : [];

  return (
    <div className="space-y-6">
      <Header
        title="Dashboard"
        description="Overview of your process manager"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          icon={Server}
          label="Total Processes"
          value={`${onlineCount} / ${processes.length}`}
          trend="up"
          trendValue={`${onlineCount} online`}
          color="green"
        />
        <StatsCard
          icon={Cpu}
          label="CPU Usage"
          value={systemMetrics ? `${systemMetrics.cpu.usage.toFixed(1)}%` : `${totalCpu.toFixed(1)}%`}
          trend={totalCpu > 80 ? 'up' : 'neutral'}
          trendValue={systemMetrics ? `${systemMetrics.cpu.cores} cores` : 'Loading...'}
          color="cyan"
        />
        <StatsCard
          icon={MemoryStick}
          label="Memory Usage"
          value={systemMetrics ? `${systemMetrics.memory.percentage.toFixed(1)}%` : formatBytes(totalMemory)}
          trend="neutral"
          trendValue={
            systemMetrics
              ? `${formatBytes(systemMetrics.memory.used)} / ${formatBytes(systemMetrics.memory.total)}`
              : 'Loading...'
          }
          color="purple"
        />
        <StatsCard
          icon={Clock}
          label="Uptime"
          value={systemMetrics ? formatUptime(systemMetrics.uptime) : '-'}
          trend="up"
          trendValue="System uptime"
          color="blue"
        />
      </div>

      {/* Process List */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-nova-text-primary">
          Processes
        </h2>
        <ProcessTable
          processes={processes}
          onRestart={(id) => restartMutation.mutate(id)}
          onStop={(id) => stopMutation.mutate(id)}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      </div>

      {/* Charts and Logs */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MetricChart
          title="System Metrics"
          data={chartData}
          dataKeys={[
            { key: 'cpu', color: '#22d3ee', name: 'CPU %' },
            { key: 'memory', color: '#6c5ce7', name: 'Memory %' },
          ]}
          yAxisFormatter={(v) => `${v}%`}
        />

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-nova-text-secondary">
            Recent Logs
          </h3>
          <LogViewer logs={logs} maxHeight="280px" autoScroll />
        </div>
      </div>
    </div>
  );
}
