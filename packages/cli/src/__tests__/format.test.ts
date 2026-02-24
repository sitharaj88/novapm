import { describe, it, expect, vi } from 'vitest';

// Mock chalk to return plain text so we can test string content
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

// Mock @novapm/shared to provide the real pure functions without pulling in
// the full shared package's side-effects
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

// Import after mocks
import {
  colorStatus,
  statusIcon,
  formatMemory,
  formatCpuDisplay,
  formatUptimeDisplay,
  formatBytes,
  formatUptime,
  formatCpu,
} from '../utils/format.js';
import type { ProcessStatus } from '@novapm/shared';

describe('format utilities', () => {
  describe('formatBytes (re-exported from @novapm/shared)', () => {
    it('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes under 1 KB', () => {
      const result = formatBytes(512);
      expect(result).toContain('B');
    });

    it('should format kilobytes', () => {
      const result = formatBytes(1024);
      expect(result).toContain('KB');
    });

    it('should format megabytes', () => {
      const result = formatBytes(1048576);
      expect(result).toContain('MB');
    });

    it('should format gigabytes', () => {
      const result = formatBytes(1073741824);
      expect(result).toContain('GB');
    });

    it('should format large values in terabytes', () => {
      const result = formatBytes(1099511627776);
      expect(result).toContain('TB');
    });

    it('should return a string', () => {
      expect(typeof formatBytes(12345)).toBe('string');
    });

    it('should handle power-of-2 boundaries exactly', () => {
      const kb = formatBytes(1024);
      expect(kb).toMatch(/1\s*KB/);
    });

    it('should handle non-round values', () => {
      const result = formatBytes(1536);
      expect(result).toContain('KB');
    });
  });

  describe('formatCpu (re-exported from @novapm/shared)', () => {
    it('should format 0 cpu', () => {
      expect(formatCpu(0)).toBe('0.0%');
    });

    it('should format integer cpu percentage', () => {
      expect(formatCpu(50)).toBe('50.0%');
    });

    it('should format decimal cpu percentage', () => {
      expect(formatCpu(33.33)).toBe('33.3%');
    });

    it('should format 100% cpu', () => {
      expect(formatCpu(100)).toBe('100.0%');
    });

    it('should format very small cpu values', () => {
      expect(formatCpu(0.1)).toBe('0.1%');
    });

    it('should format values over 100%', () => {
      // Multi-core systems can report over 100%
      expect(formatCpu(200)).toBe('200.0%');
    });

    it('should always include one decimal place', () => {
      const result = formatCpu(75);
      expect(result).toMatch(/^\d+\.\d%$/);
    });
  });

  describe('formatUptime (re-exported from @novapm/shared)', () => {
    it('should format 0 seconds', () => {
      expect(formatUptime(0)).toBe('0s');
    });

    it('should format seconds under a minute', () => {
      expect(formatUptime(30)).toBe('30s');
    });

    it('should format exactly 59 seconds', () => {
      expect(formatUptime(59)).toBe('59s');
    });

    it('should format minutes', () => {
      expect(formatUptime(120)).toBe('2m');
    });

    it('should format at the minute boundary', () => {
      expect(formatUptime(60)).toBe('1m');
    });

    it('should format hours', () => {
      expect(formatUptime(7200)).toBe('2h');
    });

    it('should format at the hour boundary', () => {
      expect(formatUptime(3600)).toBe('1h');
    });

    it('should format days', () => {
      expect(formatUptime(172800)).toBe('2d');
    });

    it('should format at the day boundary', () => {
      expect(formatUptime(86400)).toBe('1d');
    });

    it('should floor non-round seconds', () => {
      expect(formatUptime(59.9)).toBe('59s');
    });

    it('should floor non-round minutes', () => {
      expect(formatUptime(90)).toBe('1m');
    });

    it('should floor non-round hours', () => {
      expect(formatUptime(5400)).toBe('1h');
    });

    it('should handle very large uptime (months)', () => {
      const thirtyDays = 86400 * 30;
      expect(formatUptime(thirtyDays)).toBe('30d');
    });
  });

  describe('colorStatus', () => {
    it('should return "online" status text for online', () => {
      expect(colorStatus('online')).toBe('online');
    });

    it('should return "stopping" status text for stopping', () => {
      expect(colorStatus('stopping')).toBe('stopping');
    });

    it('should return "stopped" status text for stopped', () => {
      expect(colorStatus('stopped')).toBe('stopped');
    });

    it('should return "errored" status text for errored', () => {
      expect(colorStatus('errored')).toBe('errored');
    });

    it('should return "launching" status text for launching', () => {
      expect(colorStatus('launching')).toBe('launching');
    });

    it('should return "restarting" for waiting-restart status', () => {
      expect(colorStatus('waiting-restart')).toBe('restarting');
    });

    it('should return "one-launch-status" for one-launch-status', () => {
      expect(colorStatus('one-launch-status')).toBe('one-launch-status');
    });

    it('should handle all known ProcessStatus values without throwing', () => {
      const statuses: ProcessStatus[] = [
        'online',
        'stopping',
        'stopped',
        'errored',
        'launching',
        'waiting-restart',
        'one-launch-status',
      ];
      for (const status of statuses) {
        expect(() => colorStatus(status)).not.toThrow();
        expect(typeof colorStatus(status)).toBe('string');
      }
    });

    it('should return the status string itself for unknown statuses', () => {
      // Cast to ProcessStatus to bypass type checking for the edge case test
      const unknownStatus = 'unknown-status' as ProcessStatus;
      expect(colorStatus(unknownStatus)).toBe('unknown-status');
    });
  });

  describe('statusIcon', () => {
    it('should return a dot icon for online status', () => {
      const icon = statusIcon('online');
      expect(icon).toContain('●');
    });

    it('should return a dot icon for stopping status', () => {
      const icon = statusIcon('stopping');
      expect(icon).toContain('●');
    });

    it('should return a dot icon for waiting-restart status', () => {
      const icon = statusIcon('waiting-restart');
      expect(icon).toContain('●');
    });

    it('should return a dot icon for stopped status', () => {
      const icon = statusIcon('stopped');
      expect(icon).toContain('●');
    });

    it('should return a dot icon for errored status', () => {
      const icon = statusIcon('errored');
      expect(icon).toContain('●');
    });

    it('should return a dot icon for launching status', () => {
      const icon = statusIcon('launching');
      expect(icon).toContain('●');
    });

    it('should return a dot icon for unknown/default status', () => {
      const icon = statusIcon('something-else' as ProcessStatus);
      expect(icon).toContain('●');
    });

    it('should handle all known ProcessStatus values', () => {
      const statuses: ProcessStatus[] = [
        'online',
        'stopping',
        'stopped',
        'errored',
        'launching',
        'waiting-restart',
        'one-launch-status',
      ];
      for (const status of statuses) {
        expect(() => statusIcon(status)).not.toThrow();
        expect(statusIcon(status)).toContain('●');
      }
    });
  });

  describe('formatMemory', () => {
    it('should return "-" for undefined bytes', () => {
      expect(formatMemory(undefined)).toBe('-');
    });

    it('should return "-" for 0 bytes', () => {
      // 0 is falsy, so formatMemory treats it as missing
      expect(formatMemory(0)).toBe('-');
    });

    it('should format non-zero byte values', () => {
      const result = formatMemory(1048576);
      expect(result).toContain('MB');
    });

    it('should format small byte values', () => {
      const result = formatMemory(100);
      expect(result).toContain('B');
    });

    it('should format large byte values', () => {
      const result = formatMemory(1073741824);
      expect(result).toContain('GB');
    });

    it('should return a string for all inputs', () => {
      expect(typeof formatMemory(undefined)).toBe('string');
      expect(typeof formatMemory(0)).toBe('string');
      expect(typeof formatMemory(1024)).toBe('string');
    });
  });

  describe('formatCpuDisplay', () => {
    it('should return "-" for undefined cpu', () => {
      expect(formatCpuDisplay(undefined)).toBe('-');
    });

    it('should format low cpu (green range, <= 50%)', () => {
      const result = formatCpuDisplay(25);
      expect(result).toContain('25.0%');
    });

    it('should format medium cpu (yellow range, > 50% and <= 80%)', () => {
      const result = formatCpuDisplay(65);
      expect(result).toContain('65.0%');
    });

    it('should format high cpu (red range, > 80%)', () => {
      const result = formatCpuDisplay(95);
      expect(result).toContain('95.0%');
    });

    it('should handle exactly 0% cpu', () => {
      const result = formatCpuDisplay(0);
      expect(result).toContain('0.0%');
    });

    it('should handle exactly 50% cpu (green boundary)', () => {
      const result = formatCpuDisplay(50);
      expect(result).toContain('50.0%');
    });

    it('should handle exactly 80% cpu (yellow boundary)', () => {
      const result = formatCpuDisplay(80);
      expect(result).toContain('80.0%');
    });

    it('should handle 100% cpu', () => {
      const result = formatCpuDisplay(100);
      expect(result).toContain('100.0%');
    });

    it('should handle cpu just over 50% (yellow range)', () => {
      const result = formatCpuDisplay(50.1);
      expect(result).toContain('50.1%');
    });

    it('should handle cpu just over 80% (red range)', () => {
      const result = formatCpuDisplay(80.1);
      expect(result).toContain('80.1%');
    });
  });

  describe('formatUptimeDisplay', () => {
    it('should return "-" for undefined uptime', () => {
      expect(formatUptimeDisplay(undefined)).toBe('-');
    });

    it('should return "-" for 0 seconds (falsy)', () => {
      expect(formatUptimeDisplay(0)).toBe('-');
    });

    it('should format seconds', () => {
      const result = formatUptimeDisplay(45);
      expect(result).toBe('45s');
    });

    it('should format minutes', () => {
      const result = formatUptimeDisplay(300);
      expect(result).toBe('5m');
    });

    it('should format hours', () => {
      const result = formatUptimeDisplay(7200);
      expect(result).toBe('2h');
    });

    it('should format days', () => {
      const result = formatUptimeDisplay(172800);
      expect(result).toBe('2d');
    });

    it('should return a string for all inputs', () => {
      expect(typeof formatUptimeDisplay(undefined)).toBe('string');
      expect(typeof formatUptimeDisplay(0)).toBe('string');
      expect(typeof formatUptimeDisplay(3600)).toBe('string');
    });
  });

  describe('edge cases across all format functions', () => {
    it('should handle very large memory values', () => {
      const result = formatMemory(1099511627776); // 1 TB
      expect(result).toContain('TB');
    });

    it('should handle very large cpu values (multi-core)', () => {
      const result = formatCpuDisplay(800);
      expect(result).toContain('800.0%');
    });

    it('should handle very large uptime (years)', () => {
      const oneYear = 365 * 86400;
      const result = formatUptimeDisplay(oneYear);
      expect(result).toBe('365d');
    });

    it('should handle fractional seconds in uptime', () => {
      const result = formatUptimeDisplay(1.5);
      expect(result).toBe('1s');
    });

    it('should handle negative values gracefully for formatCpuDisplay', () => {
      // negative cpu should still format (green range since < 50)
      const result = formatCpuDisplay(-5);
      expect(result).toContain('%');
    });
  });
});
