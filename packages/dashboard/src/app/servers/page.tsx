'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ServerInfo } from '@/lib/api';
import { Header } from '@/components/Header';
import { cn } from '@/lib/utils';
import { formatUptime } from '@/lib/utils';
import { Server, Wifi, WifiOff, AlertTriangle, MonitorX, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type ServerStatus = 'online' | 'offline' | 'degraded';

const statusConfig: Record<ServerStatus, { icon: typeof Wifi; label: string; color: string; bg: string; border: string }> = {
  online: {
    icon: Wifi,
    label: 'Online',
    color: 'text-nova-green',
    bg: 'bg-nova-green/10',
    border: 'border-nova-green/20',
  },
  offline: {
    icon: WifiOff,
    label: 'Offline',
    color: 'text-nova-text-muted',
    bg: 'bg-nova-text-muted/10',
    border: 'border-nova-text-muted/20',
  },
  degraded: {
    icon: AlertTriangle,
    label: 'Degraded',
    color: 'text-nova-yellow',
    bg: 'bg-nova-yellow/10',
    border: 'border-nova-yellow/20',
  },
};

function CpuMemoryBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-nova-text-muted">{label}</span>
        <span className="text-nova-text-secondary">{value.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-nova-border">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

function formatLastSeen(lastHeartbeat: string): string {
  try {
    return formatDistanceToNow(new Date(lastHeartbeat), { addSuffix: true });
  } catch {
    return 'Unknown';
  }
}

function ServerCard({ server }: { server: ServerInfo }) {
  const status = statusConfig[server.status] || statusConfig.offline;
  const StatusIcon = status.icon;

  return (
    <div
      className={cn(
        'rounded-xl border bg-nova-card p-5 transition-all hover:border-nova-elevated',
        server.status === 'online'
          ? 'border-nova-border'
          : server.status === 'degraded'
            ? 'border-nova-yellow/20'
            : 'border-nova-border opacity-60'
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-nova-elevated p-2">
            <Server className="h-5 w-5 text-nova-text-secondary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-nova-text-primary">
              {server.hostname}
            </h3>
            <p className="text-xs text-nova-text-muted">
              {server.address}:{server.port}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
            status.bg,
            status.color,
            status.border
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {status.label}
        </span>
      </div>

      {/* Metrics */}
      <div className="space-y-3">
        <CpuMemoryBar label="CPU" value={server.cpuUsage} color="bg-nova-cyan" />
        <CpuMemoryBar label="Memory" value={server.memoryUsage} color="bg-nova-purple" />
      </div>

      {/* Footer info */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-nova-border pt-4">
        <div>
          <p className="text-xs text-nova-text-muted">Processes</p>
          <p className="text-sm font-medium text-nova-text-primary">
            {server.processCount}
          </p>
        </div>
        <div>
          <p className="text-xs text-nova-text-muted">Uptime</p>
          <p className="text-sm font-medium text-nova-text-primary">
            {formatUptime(server.uptime)}
          </p>
        </div>
        <div>
          <p className="text-xs text-nova-text-muted">Version</p>
          <p className="text-sm font-medium text-nova-text-primary">
            {server.version || '-'}
          </p>
        </div>
      </div>

      <div className="mt-3 text-xs text-nova-text-muted">
        Last seen: {formatLastSeen(server.lastHeartbeat)}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-nova-border bg-nova-card/50 px-6 py-16">
      <div className="rounded-full bg-nova-elevated p-4">
        <MonitorX className="h-8 w-8 text-nova-text-muted" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-nova-text-primary">
        No agents connected
      </h3>
      <p className="mt-2 max-w-sm text-center text-sm text-nova-text-secondary">
        Start an agent on each server you want to manage, then connect it to the controller.
      </p>
      <div className="mt-6 rounded-lg bg-nova-bg p-4">
        <p className="text-xs font-medium text-nova-text-muted">Quick Start</p>
        <code className="mt-2 block text-sm text-nova-cyan">
          nova agent start --controller host:9616
        </code>
      </div>
    </div>
  );
}

export default function ServersPage() {
  const { data: servers = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['servers'],
    queryFn: () => api.getServers(),
    retry: false,
  });

  return (
    <div className="space-y-6">
      <Header
        title="Servers"
        description="Multi-server monitoring and management"
        actions={
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-lg border border-nova-border bg-nova-card px-3 py-1.5 text-sm text-nova-text-secondary transition-colors hover:text-nova-text-primary"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        }
      />

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-nova-purple border-t-transparent" />
        </div>
      )}

      {isError && <EmptyState />}

      {!isLoading && !isError && servers.length === 0 && <EmptyState />}

      {!isLoading && servers.length > 0 && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-nova-border bg-nova-card p-4">
              <p className="text-xs font-medium text-nova-text-muted">Total Servers</p>
              <p className="mt-1 text-xl font-bold text-nova-text-primary">{servers.length}</p>
            </div>
            <div className="rounded-lg border border-nova-border bg-nova-card p-4">
              <p className="text-xs font-medium text-nova-text-muted">Online</p>
              <p className="mt-1 text-xl font-bold text-nova-green">
                {servers.filter((s) => s.status === 'online').length}
              </p>
            </div>
            <div className="rounded-lg border border-nova-border bg-nova-card p-4">
              <p className="text-xs font-medium text-nova-text-muted">Total Processes</p>
              <p className="mt-1 text-xl font-bold text-nova-text-primary">
                {servers.reduce((sum, s) => sum + s.processCount, 0)}
              </p>
            </div>
          </div>

          {/* Server Grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {servers.map((server) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
