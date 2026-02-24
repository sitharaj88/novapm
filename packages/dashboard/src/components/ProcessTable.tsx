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

export function ProcessTable({
  processes,
  onRestart,
  onStop,
  onDelete,
  className,
}: ProcessTableProps) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-nova-border bg-nova-card', className)}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-nova-border">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-nova-text-muted">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-nova-text-muted">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-nova-text-muted">
                PID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-nova-text-muted">
                CPU
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-nova-text-muted">
                Memory
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-nova-text-muted">
                Restarts
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-nova-text-muted">
                Uptime
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-nova-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-nova-border">
            {processes.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-nova-text-muted"
                >
                  No processes running
                </td>
              </tr>
            ) : (
              processes.map((proc) => (
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
                  <td className="px-4 py-3 text-sm text-nova-text-secondary">
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
                      <span className="text-xs text-nova-text-secondary">
                        {formatCpu(proc.cpu)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-nova-text-secondary">
                    {formatBytes(proc.memory)}
                  </td>
                  <td className="px-4 py-3 text-sm text-nova-text-secondary">
                    {proc.restarts}
                  </td>
                  <td className="px-4 py-3 text-sm text-nova-text-secondary">
                    {proc.status === 'online' ? formatUptime(proc.uptime) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onRestart?.(proc.id)}
                        className="rounded-md p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-cyan"
                        title="Restart"
                      >
                        <RotateCw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => onStop?.(proc.id)}
                        className="rounded-md p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-yellow"
                        title="Stop"
                      >
                        <Square className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => onDelete?.(proc.id)}
                        className="rounded-md p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-red"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
