'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import type { LogEntry } from '@/lib/api';

interface LogViewerProps {
  logs: LogEntry[];
  autoScroll?: boolean;
  showTimestamps?: boolean;
  className?: string;
  maxHeight?: string;
}

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

export function LogViewer({
  logs,
  autoScroll = true,
  showTimestamps = true,
  className,
  maxHeight = '500px',
}: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'overflow-auto rounded-xl border border-nova-border bg-nova-bg font-mono text-sm',
        className
      )}
      style={{ maxHeight }}
    >
      {logs.length === 0 ? (
        <div className="flex items-center justify-center p-8 text-nova-text-muted">
          No logs available
        </div>
      ) : (
        <div className="p-3 space-y-0.5">
          {logs.map((log, i) => (
            <div
              key={log.id || i}
              className="flex items-start gap-2 rounded px-2 py-1 hover:bg-nova-card/50"
            >
              {showTimestamps && (
                <span className="shrink-0 text-xs text-nova-text-muted">
                  {format(new Date(log.timestamp), 'HH:mm:ss.SSS')}
                </span>
              )}
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium uppercase',
                  levelBadgeColors[log.level] || levelBadgeColors.info
                )}
              >
                {log.level}
              </span>
              <span className="shrink-0 text-xs text-nova-purple">
                [{log.processName}]
              </span>
              <span className={cn('break-all', levelColors[log.level] || 'text-nova-text-primary')}>
                {log.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
