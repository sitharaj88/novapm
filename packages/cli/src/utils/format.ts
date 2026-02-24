import chalk from 'chalk';
import type { ProcessStatus } from '@novapm/shared';
import { formatBytes, formatUptime, formatCpu } from '@novapm/shared';

export { formatBytes, formatUptime, formatCpu };

export function colorStatus(status: ProcessStatus): string {
  switch (status) {
    case 'online':
      return chalk.green(status);
    case 'stopping':
      return chalk.yellow(status);
    case 'stopped':
      return chalk.gray(status);
    case 'errored':
      return chalk.red(status);
    case 'launching':
      return chalk.cyan(status);
    case 'waiting-restart':
      return chalk.yellow('restarting');
    case 'one-launch-status':
      return chalk.blue(status);
    default:
      return status;
  }
}

export function statusIcon(status: ProcessStatus): string {
  switch (status) {
    case 'online':
      return chalk.green('●');
    case 'stopping':
    case 'waiting-restart':
      return chalk.yellow('●');
    case 'stopped':
      return chalk.gray('●');
    case 'errored':
      return chalk.red('●');
    case 'launching':
      return chalk.cyan('●');
    default:
      return chalk.gray('●');
  }
}

export function formatMemory(bytes: number | undefined): string {
  if (!bytes) return chalk.gray('-');
  return formatBytes(bytes);
}

export function formatCpuDisplay(cpu: number | undefined): string {
  if (cpu === undefined) return chalk.gray('-');
  const str = formatCpu(cpu);
  if (cpu > 80) return chalk.red(str);
  if (cpu > 50) return chalk.yellow(str);
  return chalk.green(str);
}

export function formatUptimeDisplay(seconds: number | undefined): string {
  if (!seconds) return chalk.gray('-');
  return formatUptime(seconds);
}
