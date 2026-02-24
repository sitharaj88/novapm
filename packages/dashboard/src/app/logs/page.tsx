'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { LogEntry } from '@/lib/api';
import { Header } from '@/components/Header';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import {
  Search,
  ArrowDownToLine,
  Clock,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';

const levelColors: Record<string, string> = {
  info: 'text-nova-blue',
  warn: 'text-nova-yellow',
  error: 'text-nova-red',
  debug: 'text-nova-text-muted',
};

const levelBadgeColors: Record<string, string> = {
  info: 'bg-nova-blue/10 text-nova-blue',
  warn: 'bg-nova-yellow/10 text-nova-yellow',
  error: 'bg-nova-red/10 text-nova-red',
  debug: 'bg-nova-text-muted/10 text-nova-text-muted',
};

export default function LogsPage() {
  const [search, setSearch] = useState('');
  const [selectedProcess, setSelectedProcess] = useState<string>('all');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);

  const { data: processes = [] } = useQuery({
    queryKey: ['processes'],
    queryFn: () => api.getProcesses(),
  });

  const logViewerLines = useAppStore((s) => s.logViewerLines);

  const { data: logs = [] } = useQuery({
    queryKey: ['logs', selectedProcess, logViewerLines],
    queryFn: () =>
      api.getLogs(selectedProcess === 'all' ? undefined : selectedProcess, logViewerLines),
    refetchInterval: 3000,
  });

  const filteredLogs = logs.filter((log: LogEntry) => {
    if (selectedLevel !== 'all' && log.level !== selectedLevel) return false;
    if (search && !log.message.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col space-y-3 md:h-[calc(100vh-3rem)] md:space-y-4">
      <Header
        title="Logs"
        description="Real-time log stream from all processes"
      />

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-nova-text-muted" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-nova-border bg-nova-card py-2 pl-10 pr-4 text-sm text-nova-text-primary placeholder:text-nova-text-muted focus:border-nova-purple focus:outline-none focus:ring-1 focus:ring-nova-purple"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedProcess}
            onChange={(e) => setSelectedProcess(e.target.value)}
            className="flex-1 rounded-xl border border-nova-border bg-nova-card px-3 py-2 text-xs sm:text-sm text-nova-text-primary focus:border-nova-purple focus:outline-none focus:ring-1 focus:ring-nova-purple"
          >
            <option value="all">All Processes</option>
            {processes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="flex-1 rounded-xl border border-nova-border bg-nova-card px-3 py-2 text-xs sm:text-sm text-nova-text-primary focus:border-nova-purple focus:outline-none focus:ring-1 focus:ring-nova-purple"
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              'flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
              autoScroll
                ? 'border-nova-purple/30 bg-nova-purple/10 text-nova-purple'
                : 'border-nova-border text-nova-text-secondary hover:bg-nova-elevated'
            )}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Auto-scroll</span>
            <span className="sm:hidden">Scroll</span>
          </button>

          <button
            onClick={() => setShowTimestamps(!showTimestamps)}
            className={cn(
              'flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs sm:text-sm font-medium transition-colors',
              showTimestamps
                ? 'border-nova-cyan/30 bg-nova-cyan/10 text-nova-cyan'
                : 'border-nova-border text-nova-text-secondary hover:bg-nova-elevated'
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Timestamps</span>
            <span className="sm:hidden">Time</span>
          </button>
        </div>
      </div>

      {/* Log Stream */}
      <div className="flex-1 overflow-auto rounded-xl border border-nova-border bg-nova-bg font-mono text-xs sm:text-sm">
        {filteredLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-nova-text-muted">
            {search ? 'No logs match your search' : 'No logs available'}
          </div>
        ) : (
          <div className="p-2 sm:p-3 space-y-0.5">
            {filteredLogs.map((log: LogEntry, i: number) => (
              <div
                key={log.id || i}
                className="flex items-start gap-1.5 sm:gap-2 rounded px-1.5 sm:px-2 py-1 hover:bg-nova-card/50"
              >
                {showTimestamps && (
                  <span className="hidden shrink-0 text-[10px] sm:text-xs text-nova-text-muted sm:block">
                    {format(new Date(log.timestamp), 'HH:mm:ss.SSS')}
                  </span>
                )}
                <span
                  className={cn(
                    'shrink-0 rounded px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs font-medium uppercase',
                    levelBadgeColors[log.level] || levelBadgeColors.info
                  )}
                >
                  {log.level}
                </span>
                <span className="shrink-0 text-[10px] sm:text-xs text-nova-purple">
                  [{log.processName}]
                </span>
                <span
                  className={cn(
                    'break-all text-[11px] sm:text-sm',
                    levelColors[log.level] || 'text-nova-text-primary'
                  )}
                >
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
