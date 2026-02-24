'use client';

import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from 'lucide-react';

interface StatsCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color: 'green' | 'cyan' | 'purple' | 'blue' | 'red' | 'yellow';
  className?: string;
}

const colorMap = {
  green: {
    iconBg: 'bg-nova-green/10',
    iconColor: 'text-nova-green',
    border: 'border-nova-green/10',
  },
  cyan: {
    iconBg: 'bg-nova-cyan/10',
    iconColor: 'text-nova-cyan',
    border: 'border-nova-cyan/10',
  },
  purple: {
    iconBg: 'bg-nova-purple/10',
    iconColor: 'text-nova-purple',
    border: 'border-nova-purple/10',
  },
  blue: {
    iconBg: 'bg-nova-blue/10',
    iconColor: 'text-nova-blue',
    border: 'border-nova-blue/10',
  },
  red: {
    iconBg: 'bg-nova-red/10',
    iconColor: 'text-nova-red',
    border: 'border-nova-red/10',
  },
  yellow: {
    iconBg: 'bg-nova-yellow/10',
    iconColor: 'text-nova-yellow',
    border: 'border-nova-yellow/10',
  },
};

const trendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
};

export function StatsCard({
  icon: Icon,
  label,
  value,
  trend,
  trendValue,
  color,
  className,
}: StatsCardProps) {
  const colors = colorMap[color];
  const TrendIcon = trend ? trendIcons[trend] : null;

  return (
    <div
      className={cn(
        'rounded-xl border border-nova-border bg-nova-card p-5 transition-all hover:border-nova-elevated',
        colors.border,
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-3">
          <p className="text-sm font-medium text-nova-text-secondary">{label}</p>
          <p className="text-2xl font-bold text-nova-text-primary">{value}</p>
        </div>
        <div className={cn('rounded-lg p-2.5', colors.iconBg)}>
          <Icon className={cn('h-5 w-5', colors.iconColor)} />
        </div>
      </div>
      {trend && trendValue && TrendIcon && (
        <div className="mt-3 flex items-center gap-1.5">
          <TrendIcon
            className={cn(
              'h-3.5 w-3.5',
              trend === 'up' && 'text-nova-green',
              trend === 'down' && 'text-nova-red',
              trend === 'neutral' && 'text-nova-text-muted'
            )}
          />
          <span
            className={cn(
              'text-xs font-medium',
              trend === 'up' && 'text-nova-green',
              trend === 'down' && 'text-nova-red',
              trend === 'neutral' && 'text-nova-text-muted'
            )}
          >
            {trendValue}
          </span>
        </div>
      )}
    </div>
  );
}
