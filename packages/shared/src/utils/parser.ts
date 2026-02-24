import msLib from 'ms';
import bytesLib from 'bytes';

/**
 * Parse a duration string to milliseconds.
 * Supports: '30s', '5m', '1h', '2d', '100ms', etc.
 */
export function parseDuration(value: string | number): number {
  if (typeof value === 'number') return value;

  const result = msLib(value);
  if (result === undefined) {
    throw new Error(`Invalid duration string: "${value}"`);
  }
  return result;
}

/**
 * Format milliseconds to a human-readable duration string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

/**
 * Parse a byte size string to number of bytes.
 * Supports: '512M', '1G', '256K', '100MB', etc.
 */
export function parseBytes(value: string | number): number {
  if (typeof value === 'number') return value;

  const result = bytesLib.parse(value);
  if (result === null) {
    throw new Error(`Invalid byte size string: "${value}"`);
  }
  return result;
}

/**
 * Format bytes to a human-readable string.
 */
export function formatBytes(value: number): string {
  return bytesLib.format(value, { unitSeparator: ' ' }) ?? '0 B';
}

/**
 * Format a CPU percentage for display.
 */
export function formatCpu(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Format an uptime in seconds to a human-readable string.
 */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
