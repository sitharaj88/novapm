'use client';

import { cn, formatBytes, formatUptime, formatCpu } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import { RotateCw, Square, Trash2 } from 'lucide-react';
import type { ProcessInfo } from '@/lib/api';

interface ProcessTableProps {
  processes: ProcessInfo[];
  onRestart?: (id: string) => void;
  onStop?: (id: string) => void;
  onDelete?: (id: string) => void;
  className?: string;
}

function ProcessCard({
  proc,
  onRestart,
  onStop,
  onDelete,
}: {
  proc: ProcessInfo;
  onRestart?: (id: string) => void;
  onStop?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-nova-border bg-nova-card p-4 transition-all hover:border-nova-text-muted/30">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              proc.status === 'online' ? 'bg-nova-green' : proc.status === 'errored' ? 'bg-nova-red' : 'bg-nova-text-muted'
            )}
          />
          <div>
            <p className="text-sm font-semibold text-nova-text-primary">{proc.name}</p>
            <p className="text-xs text-nova-text-muted">ID: {proc.id} {proc.pid ? `| PID: ${proc.pid}` : ''}</p>
          </div>
        </div>
        <StatusBadge status={proc.status} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase text-nova-text-muted">CPU</p>
          <p className="text-sm font-medium text-nova-text-primary">{formatCpu(proc.cpu)}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase text-nova-text-muted">Memory</p>
          <p className="text-sm font-medium text-nova-text-primary">{formatBytes(proc.memory)}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase text-nova-text-muted">Uptime</p>
          <p className="text-sm font-medium text-nova-text-primary">
            {proc.status === 'online' ? formatUptime(proc.uptime) : '-'}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-nova-border pt-3">
        <span className="text-xs text-nova-text-muted">
          {proc.restarts > 0 ? `${proc.restarts} restart${proc.restarts > 1 ? 's' : ''}` : 'No restarts'}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onRestart?.(proc.id)}
            className="rounded-lg p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-cyan"
            title="Restart"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onStop?.(proc.id)}
            className="rounded-lg p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-yellow"
            title="Stop"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete?.(proc.id)}
            className="rounded-lg p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-red"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProcessTable({
  processes,
  onRestart,
  onStop,
  onDelete,
  className,
}: ProcessTableProps) {
  if (processes.length === 0) {
    return (
      <div className={cn('rounded-xl border border-dashed border-nova-border bg-nova-card/50 px-4 py-12 text-center', className)}>
        <p className="text-sm text-nova-text-muted">No processes running</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: Card layout */}
      <div className={cn('grid grid-cols-1 gap-3 md:hidden', className)}>
        {processes.map((proc) => (
          <ProcessCard
            key={proc.id}
            proc={proc}
            onRestart={onRestart}
            onStop={onStop}
            onDelete={onDelete}
          />
        ))}
      </div>

      {/* Desktop: Table layout */}
      <div className={cn('hidden overflow-hidden rounded-xl border border-nova-border bg-nova-card md:block', className)}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-nova-border bg-nova-elevated/30">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted">
                  PID
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted">
                  CPU
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted">
                  Memory
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted">
                  Restarts
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted">
                  Uptime
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-nova-border">
              {processes.map((proc) => (
                <tr
                  key={proc.id}
                  className="transition-colors hover:bg-nova-elevated/50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-nova-text-primary">
                        {proc.name}
                      </span>
                      <span className="text-xs text-nova-text-muted">
                        #{proc.id}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={proc.status} />
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums text-nova-text-secondary">
                    {proc.pid ?? '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-nova-border">
                        <div
                          className="h-full rounded-full bg-nova-cyan transition-all"
                          style={{ width: `${Math.min(proc.cpu, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-nova-text-secondary">
                        {formatCpu(proc.cpu)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums text-nova-text-secondary">
                    {formatBytes(proc.memory)}
                  </td>
                  <td className="px-4 py-3 text-sm tabular-nums text-nova-text-secondary">
                    {proc.restarts}
                  </td>
                  <td className="px-4 py-3 text-sm text-nova-text-secondary">
                    {proc.status === 'online' ? formatUptime(proc.uptime) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onRestart?.(proc.id)}
                        className="rounded-lg p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-cyan"
                        title="Restart"
                      >
                        <RotateCw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => onStop?.(proc.id)}
                        className="rounded-lg p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-yellow"
                        title="Stop"
                      >
                        <Square className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => onDelete?.(proc.id)}
                        className="rounded-lg p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-red"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
