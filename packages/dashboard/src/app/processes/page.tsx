'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProcessInfo } from '@/lib/api';
import { Header } from '@/components/Header';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useAppStore } from '@/lib/store';
import { formatBytes, formatUptime, formatCpu, cn } from '@/lib/utils';
import {
  Search,
  Plus,
  RotateCw,
  Square,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  X,
} from 'lucide-react';

type SortKey = 'name' | 'status' | 'cpu' | 'memory';
type SortDir = 'asc' | 'desc';

export default function ProcessesPage() {
  const queryClient = useQueryClient();
  const addToast = useAppStore((s) => s.addToast);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showStartModal, setShowStartModal] = useState(false);
  const [newProcessName, setNewProcessName] = useState('');
  const [newProcessScript, setNewProcessScript] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const { data: processes = [] } = useQuery({
    queryKey: ['processes'],
    queryFn: () => api.getProcesses(),
  });

  const restartMutation = useMutation({
    mutationFn: (id: string) => api.restartProcess(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      addToast('success', 'Process restarted successfully');
    },
    onError: (err: Error) => addToast('error', `Restart failed: ${err.message}`),
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.stopProcess(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      addToast('success', 'Process stopped successfully');
    },
    onError: (err: Error) => addToast('error', `Stop failed: ${err.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProcess(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      addToast('success', 'Process deleted successfully');
    },
    onError: (err: Error) => addToast('error', `Delete failed: ${err.message}`),
  });

  const startMutation = useMutation({
    mutationFn: () =>
      api.startProcess({ name: newProcessName, script: newProcessScript }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['processes'] });
      setShowStartModal(false);
      setNewProcessName('');
      setNewProcessScript('');
      addToast('success', 'Process started successfully');
    },
    onError: (err: Error) => addToast('error', `Start failed: ${err.message}`),
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filtered = processes
    .filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.id.includes(search)
    )
    .sort((a, b) => {
      const mult = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'name':
          return mult * a.name.localeCompare(b.name);
        case 'status':
          return mult * a.status.localeCompare(b.status);
        case 'cpu':
          return mult * (a.cpu - b.cpu);
        case 'memory':
          return mult * (a.memory - b.memory);
        default:
          return 0;
      }
    });

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 text-nova-text-muted" />;
    return sortDir === 'asc' ? (
      <ChevronUp className="h-3 w-3 text-nova-purple" />
    ) : (
      <ChevronDown className="h-3 w-3 text-nova-purple" />
    );
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <Header
        title="Processes"
        description="Manage and monitor your application processes"
        actions={
          <button
            onClick={() => setShowStartModal(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-nova-purple to-nova-purple/80 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-nova-purple/20 transition-all hover:shadow-nova-purple/30"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Start New Process</span>
            <span className="sm:hidden">New</span>
          </button>
        }
      />

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-nova-text-muted" />
        <input
          type="text"
          placeholder="Search processes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-nova-border bg-nova-card py-2.5 pl-10 pr-4 text-sm text-nova-text-primary placeholder:text-nova-text-muted focus:border-nova-purple focus:outline-none focus:ring-1 focus:ring-nova-purple"
        />
      </div>

      {/* Mobile: Card layout */}
      <div className="space-y-3 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-nova-border bg-nova-card/50 px-4 py-12 text-center">
            <p className="text-sm text-nova-text-muted">
              {search ? 'No processes match your search' : 'No processes running'}
            </p>
          </div>
        ) : (
          filtered.map((proc) => (
            <MobileProcessCard
              key={proc.id}
              process={proc}
              onRestart={() => restartMutation.mutate(proc.id)}
              onStop={() => stopMutation.mutate(proc.id)}
              onDelete={() => setDeleteTarget({ id: proc.id, name: proc.name })}
            />
          ))
        )}
      </div>

      {/* Desktop: Table layout */}
      <div className="hidden overflow-hidden rounded-xl border border-nova-border bg-nova-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-nova-border bg-nova-elevated/30">
                {(
                  [
                    ['name', 'Name'],
                    ['status', 'Status'],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted hover:text-nova-text-secondary"
                  >
                    <div className="flex items-center gap-1.5">
                      {label}
                      <SortIcon col={key} />
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted">
                  PID
                </th>
                {(
                  [
                    ['cpu', 'CPU'],
                    ['memory', 'Memory'],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="cursor-pointer px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-nova-text-muted hover:text-nova-text-secondary"
                  >
                    <div className="flex items-center gap-1.5">
                      {label}
                      <SortIcon col={key} />
                    </div>
                  </th>
                ))}
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
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-nova-text-muted"
                  >
                    {search ? 'No processes match your search' : 'No processes running'}
                  </td>
                </tr>
              ) : (
                filtered.map((proc) => (
                  <ProcessRow
                    key={proc.id}
                    process={proc}
                    expanded={expandedId === proc.id}
                    onToggle={() =>
                      setExpandedId(expandedId === proc.id ? null : proc.id)
                    }
                    onRestart={() => restartMutation.mutate(proc.id)}
                    onStop={() => stopMutation.mutate(proc.id)}
                    onDelete={() => setDeleteTarget({ id: proc.id, name: proc.name })}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Process"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This will stop the process if it's running and remove it permanently.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Start Process Modal */}
      {showStartModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-nova-border bg-nova-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-nova-text-primary">
                Start New Process
              </h3>
              <button
                onClick={() => setShowStartModal(false)}
                className="rounded-lg p-1 text-nova-text-muted hover:bg-nova-elevated hover:text-nova-text-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-nova-text-secondary">
                  Process Name
                </label>
                <input
                  type="text"
                  value={newProcessName}
                  onChange={(e) => setNewProcessName(e.target.value)}
                  placeholder="my-app"
                  className="w-full rounded-xl border border-nova-border bg-nova-bg px-3 py-2.5 text-sm text-nova-text-primary placeholder:text-nova-text-muted focus:border-nova-purple focus:outline-none focus:ring-1 focus:ring-nova-purple"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-nova-text-secondary">
                  Script Path
                </label>
                <input
                  type="text"
                  value={newProcessScript}
                  onChange={(e) => setNewProcessScript(e.target.value)}
                  placeholder="./app.js"
                  className="w-full rounded-xl border border-nova-border bg-nova-bg px-3 py-2.5 text-sm text-nova-text-primary placeholder:text-nova-text-muted focus:border-nova-purple focus:outline-none focus:ring-1 focus:ring-nova-purple"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowStartModal(false)}
                  className="rounded-xl border border-nova-border px-4 py-2 text-sm font-medium text-nova-text-secondary transition-colors hover:bg-nova-elevated"
                >
                  Cancel
                </button>
                <button
                  onClick={() => startMutation.mutate()}
                  disabled={!newProcessName || !newProcessScript}
                  className="rounded-xl bg-gradient-to-r from-nova-purple to-nova-purple/80 px-4 py-2 text-sm font-medium text-white transition-all hover:shadow-lg hover:shadow-nova-purple/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Process
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileProcessCard({
  process: proc,
  onRestart,
  onStop,
  onDelete,
}: {
  process: ProcessInfo;
  onRestart: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-nova-border bg-nova-card p-4">
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
            <p className="text-xs text-nova-text-muted">#{proc.id} {proc.pid ? `| PID: ${proc.pid}` : ''}</p>
          </div>
        </div>
        <StatusBadge status={proc.status} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase text-nova-text-muted">CPU</p>
          <p className="text-sm font-medium tabular-nums text-nova-text-primary">{formatCpu(proc.cpu)}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase text-nova-text-muted">Memory</p>
          <p className="text-sm font-medium tabular-nums text-nova-text-primary">{formatBytes(proc.memory)}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase text-nova-text-muted">Uptime</p>
          <p className="text-sm font-medium text-nova-text-primary">
            {proc.status === 'online' ? formatUptime(proc.uptime) : '-'}
          </p>
        </div>
      </div>
      {proc.script && (
        <div className="mt-2">
          <p className="truncate text-xs text-nova-text-muted font-mono">{proc.script}</p>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-nova-border pt-3">
        <span className="text-xs text-nova-text-muted">
          {proc.restarts > 0 ? `${proc.restarts} restart${proc.restarts > 1 ? 's' : ''}` : 'No restarts'}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={onRestart} className="rounded-lg p-1.5 text-nova-text-muted hover:bg-nova-elevated hover:text-nova-cyan" title="Restart">
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button onClick={onStop} className="rounded-lg p-1.5 text-nova-text-muted hover:bg-nova-elevated hover:text-nova-yellow" title="Stop">
            <Square className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="rounded-lg p-1.5 text-nova-text-muted hover:bg-nova-elevated hover:text-nova-red" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProcessRow({
  process: proc,
  expanded,
  onToggle,
  onRestart,
  onStop,
  onDelete,
}: {
  process: ProcessInfo;
  expanded: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          'cursor-pointer transition-colors hover:bg-nova-elevated/50',
          expanded && 'bg-nova-elevated/30'
        )}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-nova-text-primary">
              {proc.name}
            </span>
            <span className="text-xs text-nova-text-muted">#{proc.id}</span>
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
          <div
            className="flex items-center justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={onRestart} className="rounded-lg p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-cyan" title="Restart">
              <RotateCw className="h-4 w-4" />
            </button>
            <button onClick={onStop} className="rounded-lg p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-yellow" title="Stop">
              <Square className="h-4 w-4" />
            </button>
            <button onClick={onDelete} className="rounded-lg p-1.5 text-nova-text-muted transition-colors hover:bg-nova-elevated hover:text-nova-red" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="border-t border-nova-border bg-nova-elevated/20 px-6 py-4">
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <span className="text-[10px] font-medium uppercase text-nova-text-muted">Script</span>
                <p className="mt-0.5 truncate font-mono text-xs text-nova-text-primary">{proc.script}</p>
              </div>
              <div>
                <span className="text-[10px] font-medium uppercase text-nova-text-muted">Working Directory</span>
                <p className="mt-0.5 truncate font-mono text-xs text-nova-text-primary">{proc.cwd}</p>
              </div>
              <div>
                <span className="text-[10px] font-medium uppercase text-nova-text-muted">Created</span>
                <p className="mt-0.5 text-xs text-nova-text-primary">{proc.createdAt}</p>
              </div>
              <div>
                <span className="text-[10px] font-medium uppercase text-nova-text-muted">Process ID</span>
                <p className="mt-0.5 font-mono text-xs text-nova-text-primary">{proc.pid ?? 'N/A'}</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
