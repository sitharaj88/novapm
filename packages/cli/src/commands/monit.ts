import { Command } from 'commander';
import chalk from 'chalk';
import { daemonRequest } from '../utils/client.js';
import {
  statusIcon,
  formatMemory,
  formatCpuDisplay,
  formatUptimeDisplay,
} from '../utils/format.js';
import type { NovaProcess, ProcessMetrics, SystemMetrics } from '@novapm/shared';

interface ProcessWithMetrics extends NovaProcess {
  metrics?: ProcessMetrics | null;
}

export const monitCommand = new Command('monit')
  .description('Real-time process monitoring dashboard')
  .action(async () => {
    console.log(chalk.bold('\n  NovaPM Monitor'));
    console.log(chalk.gray('  Press Ctrl+C to exit\n'));

    const render = async () => {
      try {
        const processes = (await daemonRequest('process.list')) as ProcessWithMetrics[];
        const system = (await daemonRequest('metrics.system')) as SystemMetrics | null;

        // Clear screen
        process.stdout.write('\x1b[2J\x1b[H');

        // Header
        const cpuStr = system ? formatCpuDisplay(system.cpuUsage) : '-';
        const memUsed = system ? formatMemory(system.memoryUsed) : '-';
        const memTotal = system ? formatMemory(system.memoryTotal) : '-';

        console.log(
          chalk.bold.cyan('  NovaPM Monitor') +
            chalk.gray(`   CPU: ${cpuStr}  MEM: ${memUsed}/${memTotal}`),
        );
        console.log(chalk.gray('  ─'.repeat(35)));

        // Process table header
        console.log(
          chalk.bold(
            `  ${'ID'.padEnd(5)} ${'Name'.padEnd(16)} ${''.padEnd(2)} ${'PID'.padEnd(8)} ${'CPU'.padEnd(8)} ${'Memory'.padEnd(10)} ${'↺'.padEnd(5)} ${'Uptime'.padEnd(8)}`,
          ),
        );
        console.log(chalk.gray('  ' + '─'.repeat(68)));

        if (!processes || processes.length === 0) {
          console.log(chalk.gray('\n  No processes running.'));
        } else {
          for (const proc of processes) {
            const m = proc.metrics;
            const line =
              `  ${String(proc.id).padEnd(5)} ` +
              `${proc.name.padEnd(16)} ` +
              `${statusIcon(proc.status)} ` +
              `${(proc.pid ? String(proc.pid) : '-').padEnd(8)} ` +
              `${formatCpuDisplay(m?.cpu).padEnd(8)} ` +
              `${formatMemory(m?.memory).padEnd(10)} ` +
              `${String(proc.restarts).padEnd(5)} ` +
              `${formatUptimeDisplay(m?.uptime).padEnd(8)}`;
            console.log(line);
          }
        }

        console.log(chalk.gray('\n  ' + '─'.repeat(68)));
        console.log(chalk.gray('  Ctrl+C to exit  |  Refreshing every 2s'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red(`  Error: ${msg}`));
      }
    };

    await render();
    const timer = setInterval(render, 2000);

    process.on('SIGINT', () => {
      clearInterval(timer);
      console.log('\n');
      process.exit(0);
    });

    // Keep the process alive
    await new Promise(() => {});
  });
