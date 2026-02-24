import { describe, it, expect, vi } from 'vitest';

// Mock chalk to return plain text
vi.mock('chalk', () => {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'default') return chainable;
      return chainable;
    },
    apply(_target, _thisArg, args) {
      return String(args[0]);
    },
  };

  const chainable: unknown = new Proxy(function () {} as object, handler);

  return { default: chainable };
});

// Mock @novapm/shared for format functions
vi.mock('@novapm/shared', () => {
  function formatBytes(value: number): string {
    if (value === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(value) / Math.log(k));
    const num = value / Math.pow(k, i);
    const formatted = num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
    return `${formatted} ${units[i]}`;
  }

  function formatCpu(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  function formatUptime(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }

  return {
    formatBytes,
    formatCpu,
    formatUptime,
  };
});

import { renderProcessTable, renderProcessInfo } from '../ui/Table.js';
import type { ProcessWithMetrics } from '../ui/Table.js';
import type { ProcessStatus } from '@novapm/shared';

function makeProcess(overrides: Partial<ProcessWithMetrics> = {}): ProcessWithMetrics {
  return {
    id: 0,
    name: 'test-app',
    script: '/path/to/app.js',
    cwd: '/path/to',
    args: [],
    interpreter: 'node',
    interpreterArgs: [],
    execMode: 'fork',
    instances: 1,
    status: 'online' as ProcessStatus,
    pid: 12345,
    port: null,
    env: {},
    createdAt: new Date('2025-01-01T00:00:00Z'),
    startedAt: new Date('2025-01-01T00:00:00Z'),
    restarts: 0,
    maxRestarts: 16,
    restartDelay: 0,
    expBackoffRestartDelay: 0,
    maxMemoryRestart: null,
    autorestart: true,
    watch: false,
    ignoreWatch: [],
    killTimeout: 5000,
    listenTimeout: 8000,
    shutdownWithMessage: false,
    windowsHide: false,
    mergeLogs: false,
    sourceMapSupport: true,
    vizion: false,
    metrics: null,
    ...overrides,
  };
}

describe('Table UI', () => {
  describe('renderProcessTable', () => {
    it('should return a string', () => {
      const result = renderProcessTable([]);
      expect(typeof result).toBe('string');
    });

    it('should render an empty table with just headers when no processes', () => {
      const result = renderProcessTable([]);
      // Table should still contain header text
      expect(result).toContain('id');
      expect(result).toContain('name');
      expect(result).toContain('pid');
      expect(result).toContain('cpu');
      expect(result).toContain('memory');
      expect(result).toContain('restarts');
      expect(result).toContain('uptime');
      expect(result).toContain('mode');
    });

    it('should include process id in the table', () => {
      const proc = makeProcess({ id: 5 });
      const result = renderProcessTable([proc]);
      expect(result).toContain('5');
    });

    it('should include process name in the table', () => {
      const proc = makeProcess({ name: 'my-web-server' });
      const result = renderProcessTable([proc]);
      expect(result).toContain('my-web-server');
    });

    it('should include process pid in the table', () => {
      const proc = makeProcess({ pid: 99999 });
      const result = renderProcessTable([proc]);
      expect(result).toContain('99999');
    });

    it('should show "-" for pid when pid is null', () => {
      const proc = makeProcess({ pid: null });
      const result = renderProcessTable([proc]);
      expect(result).toContain('-');
    });

    it('should include the exec mode in the table', () => {
      const proc = makeProcess({ execMode: 'fork' });
      const result = renderProcessTable([proc]);
      expect(result).toContain('fork');
    });

    it('should include cluster exec mode (may be truncated by table width)', () => {
      const proc = makeProcess({ execMode: 'cluster' });
      const result = renderProcessTable([proc]);
      // The mode column width is 8 chars, so "cluster" may be truncated to "clust..."
      expect(result).toMatch(/clust/);
    });

    it('should include restart count in the table', () => {
      const proc = makeProcess({ restarts: 3 });
      const result = renderProcessTable([proc]);
      expect(result).toContain('3');
    });

    it('should render multiple processes', () => {
      const proc1 = makeProcess({ id: 0, name: 'app-one', pid: 1001 });
      const proc2 = makeProcess({ id: 1, name: 'app-two', pid: 1002 });
      const proc3 = makeProcess({ id: 2, name: 'app-three', pid: 1003 });
      const result = renderProcessTable([proc1, proc2, proc3]);
      expect(result).toContain('app-one');
      expect(result).toContain('app-two');
      expect(result).toContain('app-three');
      expect(result).toContain('1001');
      expect(result).toContain('1002');
      expect(result).toContain('1003');
    });

    it('should render process with metrics', () => {
      const proc = makeProcess({
        metrics: {
          processId: 0,
          cpu: 45.2,
          memory: 52428800, // 50 MB
          heapUsed: 30000000,
          heapTotal: 60000000,
          eventLoopLatency: 1.5,
          activeHandles: 10,
          activeRequests: 2,
          uptime: 3600,
          timestamp: new Date(),
        },
      });
      const result = renderProcessTable([proc]);
      expect(result).toContain('45.2%');
    });

    it('should show "-" for cpu and memory when metrics are null', () => {
      const proc = makeProcess({ metrics: null });
      const result = renderProcessTable([proc]);
      // The dash "-" should appear in the cpu, memory, and uptime columns
      expect(result).toContain('-');
    });

    it('should render a status icon for each process', () => {
      const proc = makeProcess({ status: 'online' });
      const result = renderProcessTable([proc]);
      // statusIcon returns a dot character
      expect(result).toContain('●');
    });

    it('should handle processes with different statuses', () => {
      const statuses: ProcessStatus[] = ['online', 'stopped', 'errored', 'launching'];
      const processes = statuses.map((status, i) =>
        makeProcess({ id: i, name: `app-${status}`, status }),
      );
      const result = renderProcessTable(processes);
      for (const status of statuses) {
        expect(result).toContain(`app-${status}`);
      }
    });

    it('should handle process with zero restarts', () => {
      const proc = makeProcess({ restarts: 0 });
      const result = renderProcessTable([proc]);
      expect(result).toContain('0');
    });
  });

  describe('renderProcessInfo', () => {
    it('should return a string', () => {
      const proc = makeProcess();
      const result = renderProcessInfo(proc);
      expect(typeof result).toBe('string');
    });

    it('should include the process name and id', () => {
      const proc = makeProcess({ id: 7, name: 'my-service' });
      const result = renderProcessInfo(proc);
      expect(result).toContain('my-service');
      expect(result).toContain('7');
    });

    it('should include the status', () => {
      const proc = makeProcess({ status: 'online' });
      const result = renderProcessInfo(proc);
      expect(result).toContain('online');
      expect(result).toContain('Status');
    });

    it('should include the PID', () => {
      const proc = makeProcess({ pid: 42000 });
      const result = renderProcessInfo(proc);
      expect(result).toContain('42000');
      expect(result).toContain('PID');
    });

    it('should show "-" when PID is null', () => {
      const proc = makeProcess({ pid: null });
      const result = renderProcessInfo(proc);
      expect(result).toContain('PID');
      expect(result).toContain('-');
    });

    it('should include the script path', () => {
      const proc = makeProcess({ script: '/home/user/app/server.js' });
      const result = renderProcessInfo(proc);
      expect(result).toContain('/home/user/app/server.js');
      expect(result).toContain('Script');
    });

    it('should include the CWD', () => {
      const proc = makeProcess({ cwd: '/home/user/app' });
      const result = renderProcessInfo(proc);
      expect(result).toContain('/home/user/app');
      expect(result).toContain('CWD');
    });

    it('should include the interpreter', () => {
      const proc = makeProcess({ interpreter: 'node' });
      const result = renderProcessInfo(proc);
      expect(result).toContain('node');
      expect(result).toContain('Interpreter');
    });

    it('should include the exec mode', () => {
      const proc = makeProcess({ execMode: 'cluster' });
      const result = renderProcessInfo(proc);
      expect(result).toContain('cluster');
      expect(result).toContain('Exec Mode');
    });

    it('should include the number of instances', () => {
      const proc = makeProcess({ instances: 4 });
      const result = renderProcessInfo(proc);
      expect(result).toContain('4');
      expect(result).toContain('Instances');
    });

    it('should include restart count', () => {
      const proc = makeProcess({ restarts: 12 });
      const result = renderProcessInfo(proc);
      expect(result).toContain('12');
      expect(result).toContain('Restarts');
    });

    it('should include max restarts', () => {
      const proc = makeProcess({ maxRestarts: 16 });
      const result = renderProcessInfo(proc);
      expect(result).toContain('16');
      expect(result).toContain('Max Restarts');
    });

    it('should include metrics section when metrics are present', () => {
      const proc = makeProcess({
        metrics: {
          processId: 0,
          cpu: 25.5,
          memory: 104857600, // 100 MB
          heapUsed: 50000000,
          heapTotal: 100000000,
          eventLoopLatency: 2.0,
          activeHandles: 5,
          activeRequests: 1,
          uptime: 7200,
          timestamp: new Date(),
        },
      });
      const result = renderProcessInfo(proc);
      expect(result).toContain('Metrics');
      expect(result).toContain('CPU');
      expect(result).toContain('Memory');
      expect(result).toContain('Uptime');
      expect(result).toContain('25.5%');
    });

    it('should not include metrics section when metrics are null', () => {
      const proc = makeProcess({ metrics: null });
      const result = renderProcessInfo(proc);
      // "Metrics" as a section header should not be present
      // but "memory" / "cpu" from the table headers also shouldn't appear as sections
      const lines = result.split('\n');
      const metricsHeaderLine = lines.find(
        (l) => l.trim() === 'Metrics' || l.includes('  Metrics'),
      );
      // When there are no metrics, the Metrics section heading should not appear.
      // But note the renderProcessInfo function uses chalk.bold('  Metrics'), which
      // with our mock just returns '  Metrics'
      expect(metricsHeaderLine).toBeUndefined();
    });

    it('should not include metrics section when metrics are undefined', () => {
      const proc = makeProcess({ metrics: undefined });
      // metrics is optional so undefined is similar to not having it
      const result = renderProcessInfo(proc);
      const lines = result.split('\n');
      const metricsHeaderLine = lines.find((l) => l.trim() === 'Metrics');
      expect(metricsHeaderLine).toBeUndefined();
    });

    it('should include the startedAt date when present', () => {
      const startDate = new Date('2025-06-15T10:30:00Z');
      const proc = makeProcess({ startedAt: startDate });
      const result = renderProcessInfo(proc);
      expect(result).toContain('Started At');
    });

    it('should not include startedAt when it is null', () => {
      const proc = makeProcess({ startedAt: null });
      const result = renderProcessInfo(proc);
      expect(result).not.toContain('Started At');
    });

    it('should always include the createdAt date', () => {
      const proc = makeProcess({ createdAt: new Date('2025-01-01T00:00:00Z') });
      const result = renderProcessInfo(proc);
      expect(result).toContain('Created At');
    });

    it('should include a status icon', () => {
      const proc = makeProcess({ status: 'online' });
      const result = renderProcessInfo(proc);
      expect(result).toContain('●');
    });

    it('should produce multi-line output', () => {
      const proc = makeProcess();
      const result = renderProcessInfo(proc);
      const lines = result.split('\n');
      expect(lines.length).toBeGreaterThan(5);
    });

    it('should handle process with all optional metrics fields', () => {
      const proc = makeProcess({
        metrics: {
          processId: 0,
          cpu: 0,
          memory: 0,
          heapUsed: 0,
          heapTotal: 0,
          eventLoopLatency: 0,
          activeHandles: 0,
          activeRequests: 0,
          uptime: 0,
          timestamp: new Date(),
        },
      });
      // Should not throw even with zero metrics
      const result = renderProcessInfo(proc);
      expect(result).toContain('Metrics');
    });
  });
});
