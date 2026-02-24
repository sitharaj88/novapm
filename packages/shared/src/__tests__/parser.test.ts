import { describe, it, expect } from 'vitest';
import {
  parseDuration,
  formatDuration,
  parseBytes,
  formatBytes,
  formatCpu,
  formatUptime,
} from '../utils/parser.js';

describe('parseDuration', () => {
  it('should return the number directly when given a number', () => {
    expect(parseDuration(5000)).toBe(5000);
    expect(parseDuration(0)).toBe(0);
    expect(parseDuration(100)).toBe(100);
  });

  it('should parse seconds', () => {
    expect(parseDuration('30s')).toBe(30000);
    expect(parseDuration('1s')).toBe(1000);
    expect(parseDuration('0s')).toBe(0);
  });

  it('should parse minutes', () => {
    expect(parseDuration('5m')).toBe(300000);
    expect(parseDuration('1m')).toBe(60000);
  });

  it('should parse hours', () => {
    expect(parseDuration('1h')).toBe(3600000);
    expect(parseDuration('2h')).toBe(7200000);
  });

  it('should parse days', () => {
    expect(parseDuration('1d')).toBe(86400000);
    expect(parseDuration('2d')).toBe(172800000);
  });

  it('should parse milliseconds', () => {
    expect(parseDuration('100ms')).toBe(100);
    expect(parseDuration('500ms')).toBe(500);
  });

  it('should throw on invalid duration string', () => {
    expect(() => parseDuration('invalid')).toThrow('Invalid duration string: "invalid"');
  });

  it('should throw on empty string', () => {
    expect(() => parseDuration('')).toThrow();
  });

  it('should handle negative number input', () => {
    expect(parseDuration(-100)).toBe(-100);
  });
});

describe('formatDuration', () => {
  it('should format milliseconds below 1 second', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format seconds (1000ms to 59999ms)', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(30000)).toBe('30s');
    expect(formatDuration(59999)).toBe('60s');
  });

  it('should format minutes (60000ms to 3599999ms)', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(300000)).toBe('5m');
    expect(formatDuration(3599999)).toBe('60m');
  });

  it('should format hours (3600000ms to 86399999ms)', () => {
    expect(formatDuration(3600000)).toBe('1h');
    expect(formatDuration(7200000)).toBe('2h');
    expect(formatDuration(86399999)).toBe('24h');
  });

  it('should format days (86400000ms and above)', () => {
    expect(formatDuration(86400000)).toBe('1d');
    expect(formatDuration(172800000)).toBe('2d');
    expect(formatDuration(604800000)).toBe('7d');
  });

  it('should round to nearest unit', () => {
    expect(formatDuration(1500)).toBe('2s');
    expect(formatDuration(90000)).toBe('2m');
  });

  it('should handle boundary values precisely', () => {
    // At exactly 1000ms, should switch to seconds
    expect(formatDuration(1000)).toBe('1s');
    // At exactly 60000ms, should switch to minutes
    expect(formatDuration(60000)).toBe('1m');
    // At exactly 3600000ms, should switch to hours
    expect(formatDuration(3600000)).toBe('1h');
    // At exactly 86400000ms, should switch to days
    expect(formatDuration(86400000)).toBe('1d');
  });
});

describe('parseBytes', () => {
  it('should return the number directly when given a number', () => {
    expect(parseBytes(1024)).toBe(1024);
    expect(parseBytes(0)).toBe(0);
  });

  it('should parse megabytes', () => {
    expect(parseBytes('1MB')).toBe(1048576);
    expect(parseBytes('100MB')).toBe(104857600);
  });

  it('should parse gigabytes', () => {
    expect(parseBytes('1GB')).toBe(1073741824);
    expect(parseBytes('2GB')).toBe(2147483648);
  });

  it('should parse kilobytes', () => {
    expect(parseBytes('1KB')).toBe(1024);
    expect(parseBytes('512KB')).toBe(524288);
  });

  it('should parse plain bytes', () => {
    expect(parseBytes('1024B')).toBe(1024);
  });

  it('should throw on invalid byte size string', () => {
    expect(() => parseBytes('invalid')).toThrow('Invalid byte size string: "invalid"');
  });

  it('should throw on empty string', () => {
    expect(() => parseBytes('')).toThrow('Invalid byte size string');
  });

  it('should handle negative number input', () => {
    expect(parseBytes(-512)).toBe(-512);
  });
});

describe('formatBytes', () => {
  it('should format zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format bytes', () => {
    const result = formatBytes(512);
    expect(result).toBe('512 B');
  });

  it('should format kilobytes', () => {
    const result = formatBytes(1024);
    expect(result).toBe('1 KB');
  });

  it('should format megabytes', () => {
    const result = formatBytes(1048576);
    expect(result).toBe('1 MB');
  });

  it('should format gigabytes', () => {
    const result = formatBytes(1073741824);
    expect(result).toBe('1 GB');
  });

  it('should include a space between number and unit', () => {
    const result = formatBytes(2048);
    expect(result).toMatch(/^\d+(\.\d+)? [KMGT]?B$/);
  });

  it('should handle large values', () => {
    const result = formatBytes(1099511627776); // 1 TB
    expect(result).toBe('1 TB');
  });
});

describe('formatCpu', () => {
  it('should format zero CPU', () => {
    expect(formatCpu(0)).toBe('0.0%');
  });

  it('should format integer CPU values with one decimal', () => {
    expect(formatCpu(50)).toBe('50.0%');
    expect(formatCpu(100)).toBe('100.0%');
  });

  it('should format decimal CPU values with one decimal', () => {
    expect(formatCpu(45.678)).toBe('45.7%');
    expect(formatCpu(99.95)).toBe('100.0%');
  });

  it('should format very small CPU values', () => {
    expect(formatCpu(0.1)).toBe('0.1%');
    expect(formatCpu(0.05)).toBe('0.1%');
    expect(formatCpu(0.01)).toBe('0.0%');
  });

  it('should format CPU values above 100%', () => {
    // Multi-core systems can report above 100%
    expect(formatCpu(200)).toBe('200.0%');
    expect(formatCpu(350.5)).toBe('350.5%');
  });

  it('should always include the percent sign', () => {
    expect(formatCpu(42)).toMatch(/%$/);
    expect(formatCpu(0)).toMatch(/%$/);
  });
});

describe('formatUptime', () => {
  it('should format seconds (less than 60)', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(1)).toBe('1s');
    expect(formatUptime(30)).toBe('30s');
    expect(formatUptime(59)).toBe('59s');
    expect(formatUptime(59.9)).toBe('59s');
  });

  it('should format minutes (60 to 3599)', () => {
    expect(formatUptime(60)).toBe('1m');
    expect(formatUptime(300)).toBe('5m');
    expect(formatUptime(3599)).toBe('59m');
  });

  it('should format hours (3600 to 86399)', () => {
    expect(formatUptime(3600)).toBe('1h');
    expect(formatUptime(7200)).toBe('2h');
    expect(formatUptime(86399)).toBe('23h');
  });

  it('should format days (86400 and above)', () => {
    expect(formatUptime(86400)).toBe('1d');
    expect(formatUptime(172800)).toBe('2d');
    expect(formatUptime(604800)).toBe('7d');
  });

  it('should use floor rounding (not ceil or round)', () => {
    // 89 seconds: 89 >= 60, so it formats as minutes: floor(89/60) = 1m
    expect(formatUptime(89)).toBe('1m');
    expect(formatUptime(119)).toBe('1m'); // floor(119/60) = 1
    expect(formatUptime(7199)).toBe('1h'); // floor(7199/3600) = 1
    expect(formatUptime(90000)).toBe('1d'); // floor(90000/86400) = 1
  });

  it('should handle fractional seconds by flooring', () => {
    expect(formatUptime(0.5)).toBe('0s');
    expect(formatUptime(1.9)).toBe('1s');
    expect(formatUptime(59.99)).toBe('59s');
  });

  it('should handle boundary values', () => {
    // Exactly at boundary between seconds and minutes
    expect(formatUptime(60)).toBe('1m');
    // Exactly at boundary between minutes and hours
    expect(formatUptime(3600)).toBe('1h');
    // Exactly at boundary between hours and days
    expect(formatUptime(86400)).toBe('1d');
  });

  it('should handle very large uptimes', () => {
    // 365 days
    expect(formatUptime(31536000)).toBe('365d');
    // 1000 days
    expect(formatUptime(86400000)).toBe('1000d');
  });
});
