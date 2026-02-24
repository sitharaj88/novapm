import Table from 'cli-table3';
import chalk from 'chalk';
import type { NovaProcess, ProcessMetrics } from '@novapm/shared';
import {
  statusIcon,
  formatMemory,
  formatCpuDisplay,
  formatUptimeDisplay,
} from '../utils/format.js';

export interface ProcessWithMetrics extends NovaProcess {
  metrics?: ProcessMetrics | null;
}

export function renderProcessTable(processes: ProcessWithMetrics[]): string {
  const table = new Table({
    head: [
      chalk.bold('id'),
      chalk.bold('name'),
      chalk.bold(''),
      chalk.bold('pid'),
      chalk.bold('cpu'),
      chalk.bold('memory'),
      chalk.bold('restarts'),
      chalk.bold('uptime'),
      chalk.bold('mode'),
    ],
    style: {
      head: [],
      border: ['gray'],
    },
    colWidths: [6, 20, 3, 10, 10, 12, 10, 10, 8],
  });

  for (const proc of processes) {
    const metrics = proc.metrics;
    table.push([
      String(proc.id),
      proc.name,
      statusIcon(proc.status),
      proc.pid ? String(proc.pid) : chalk.gray('-'),
      formatCpuDisplay(metrics?.cpu),
      formatMemory(metrics?.memory),
      proc.restarts > 0 ? chalk.yellow(String(proc.restarts)) : String(proc.restarts),
      formatUptimeDisplay(metrics?.uptime),
      proc.execMode,
    ]);
  }

  return table.toString();
}

export function renderProcessInfo(proc: ProcessWithMetrics): string {
  const lines: string[] = [];
  const metrics = proc.metrics;

  lines.push(chalk.bold(`\n  ${proc.name} (id: ${proc.id})`));
  lines.push(`  Status:      ${statusIcon(proc.status)} ${proc.status}`);
  lines.push(`  PID:         ${proc.pid || '-'}`);
  lines.push(`  Script:      ${proc.script}`);
  lines.push(`  CWD:         ${proc.cwd}`);
  lines.push(`  Interpreter: ${proc.interpreter}`);
  lines.push(`  Exec Mode:   ${proc.execMode}`);
  lines.push(`  Instances:   ${proc.instances}`);
  lines.push(`  Restarts:    ${proc.restarts}`);
  lines.push(`  Max Restarts:${proc.maxRestarts}`);

  if (metrics) {
    lines.push('');
    lines.push(chalk.bold('  Metrics'));
    lines.push(`  CPU:         ${formatCpuDisplay(metrics.cpu)}`);
    lines.push(`  Memory:      ${formatMemory(metrics.memory)}`);
    lines.push(`  Uptime:      ${formatUptimeDisplay(metrics.uptime)}`);
  }

  if (proc.startedAt) {
    lines.push(`  Started At:  ${new Date(proc.startedAt).toLocaleString()}`);
  }
  lines.push(`  Created At:  ${new Date(proc.createdAt).toLocaleString()}`);
  lines.push('');

  return lines.join('\n');
}
