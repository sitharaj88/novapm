'use client';

import { cn } from '@/lib/utils';

type ProcessStatus = 'online' | 'stopped' | 'errored' | 'launching' | 'stopping';

const statusConfig: Record<ProcessStatus, { label: string; className: string; dotClass: string }> = {
  online: {
    label: 'Online',
    className: 'bg-nova-green/10 text-nova-green border-nova-green/20',
    dotClass: 'bg-nova-green',
  },
  stopped: {
    label: 'Stopped',
    className: 'bg-nova-text-muted/10 text-nova-text-secondary border-nova-text-muted/20',
    dotClass: 'bg-nova-text-muted',
  },
  errored: {
    label: 'Errored',
    className: 'bg-nova-red/10 text-nova-red border-nova-red/20',
    dotClass: 'bg-nova-red',
  },
  launching: {
    label: 'Launching',
    className: 'bg-nova-yellow/10 text-nova-yellow border-nova-yellow/20',
    dotClass: 'bg-nova-yellow',
  },
  stopping: {
    label: 'Stopping',
    className: 'bg-nova-yellow/10 text-nova-yellow border-nova-yellow/20',
    dotClass: 'bg-nova-yellow',
  },
};

interface StatusBadgeProps {
  status: ProcessStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.stopped;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', config.dotClass)} />
      {config.label}
    </span>
  );
}
