'use client';

import { cn } from '@/lib/utils';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface MetricChartProps {
  title: string;
  data: Array<Record<string, string | number>>;
  dataKeys: Array<{
    key: string;
    color: string;
    name?: string;
  }>;
  xAxisKey?: string;
  yAxisFormatter?: (value: number) => string;
  className?: string;
  height?: number;
}

export function MetricChart({
  title,
  data,
  dataKeys,
  xAxisKey = 'time',
  yAxisFormatter,
  className,
  height = 250,
}: MetricChartProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-nova-border bg-nova-card p-5',
        className
      )}
    >
      <h3 className="mb-4 text-sm font-medium text-nova-text-secondary">
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            {dataKeys.map((dk) => (
              <linearGradient
                key={dk.key}
                id={`gradient-${dk.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={dk.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={dk.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2030" vertical={false} />
          <XAxis
            dataKey={xAxisKey}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: '#454866' }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: '#454866' }}
            tickFormatter={yAxisFormatter}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#181923',
              border: '1px solid #1e2030',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#e2e4f0',
            }}
          />
          {dataKeys.map((dk) => (
            <Area
              key={dk.key}
              type="monotone"
              dataKey={dk.key}
              name={dk.name || dk.key}
              stroke={dk.color}
              strokeWidth={2}
              fill={`url(#gradient-${dk.key})`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
