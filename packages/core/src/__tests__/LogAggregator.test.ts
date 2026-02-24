import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock node:fs before importing LogAggregator ---
const mockWrite = vi.fn((_chunk: unknown, cb?: () => void) => {
  if (cb) cb();
  return true;
});
const mockEnd = vi.fn((cb?: () => void) => {
  if (cb) cb();
});

const mockWriteStream = () => ({
  write: mockWrite,
  end: mockEnd,
  on: vi.fn(),
  once: vi.fn(),
  emit: vi.fn(),
  destroy: vi.fn(),
});

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(() => mockWriteStream()),
}));

vi.mock('@novapm/shared', () => ({
  NOVA_LOG_DIR: '/tmp/nova-test-logs',
}));

import { LogAggregator } from '../logs/LogAggregator.js';
import { mkdirSync, createWriteStream } from 'node:fs';
import type { EventBus } from '../events/EventBus.js';
import type { LogEntry } from '@novapm/shared';

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    onAny: vi.fn(),
    offAny: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as EventBus;
}

describe('LogAggregator', () => {
  let aggregator: LogAggregator;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = createMockEventBus();
    aggregator = new LogAggregator(eventBus, '/tmp/nova-test-logs');
  });

  afterEach(async () => {
    await aggregator.flush();
  });

  describe('constructor', () => {
    it('should create log directory on construction', () => {
      expect(mkdirSync).toHaveBeenCalledWith('/tmp/nova-test-logs', { recursive: true });
    });

    it('should use NOVA_LOG_DIR as default when no logDir provided', () => {
      vi.clearAllMocks();
      const agg = new LogAggregator(eventBus);
      expect(mkdirSync).toHaveBeenCalledWith('/tmp/nova-test-logs', { recursive: true });
      // Cleanup
      agg.flush();
    });
  });

  describe('write', () => {
    it('should write stdout data to the out stream', () => {
      const data = Buffer.from('hello stdout');
      aggregator.write(1, 'my-app', 'stdout', data);

      expect(createWriteStream).toHaveBeenCalled();
      expect(mockWrite).toHaveBeenCalled();
      const writtenLine = mockWrite.mock.calls[0][0] as string;
      expect(writtenLine).toContain('hello stdout');
      expect(writtenLine).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(writtenLine).toMatch(/\n$/);
    });

    it('should write stderr data to the err stream', () => {
      const data = Buffer.from('error message');
      aggregator.write(1, 'my-app', 'stderr', data);

      expect(mockWrite).toHaveBeenCalled();
      const writtenLine = mockWrite.mock.calls[0][0] as string;
      expect(writtenLine).toContain('error message');
    });

    it('should not write empty messages after trimming', () => {
      const data = Buffer.from('   \n  ');
      aggregator.write(1, 'my-app', 'stdout', data);

      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should emit log:entry event via eventBus', () => {
      const data = Buffer.from('log line');
      aggregator.write(1, 'my-app', 'stdout', data);

      expect(eventBus.emit).toHaveBeenCalledWith(
        'log:entry',
        expect.objectContaining({
          processId: 1,
          processName: 'my-app',
          stream: 'stdout',
          message: 'log line',
          timestamp: expect.any(Date),
        }),
      );
    });

    it('should store log entries in the recent logs buffer', () => {
      aggregator.write(1, 'my-app', 'stdout', Buffer.from('line 1'));
      aggregator.write(1, 'my-app', 'stderr', Buffer.from('line 2'));

      const recent = aggregator.getRecentLogs(1);
      expect(recent).toHaveLength(2);
      expect(recent[0].message).toBe('line 1');
      expect(recent[0].stream).toBe('stdout');
      expect(recent[1].message).toBe('line 2');
      expect(recent[1].stream).toBe('stderr');
    });

    it('should reuse the same file stream for the same process name', () => {
      aggregator.write(1, 'my-app', 'stdout', Buffer.from('line 1'));
      aggregator.write(1, 'my-app', 'stdout', Buffer.from('line 2'));

      // createWriteStream is called once for out and once for err (pair), not again
      const callCount = vi.mocked(createWriteStream).mock.calls.length;
      expect(callCount).toBe(2); // one for out, one for err
    });

    it('should create separate streams for different process names', () => {
      aggregator.write(1, 'app-a', 'stdout', Buffer.from('a'));
      aggregator.write(2, 'app-b', 'stdout', Buffer.from('b'));

      // Two pairs = 4 createWriteStream calls
      const callCount = vi.mocked(createWriteStream).mock.calls.length;
      expect(callCount).toBe(4);
    });

    it('should trim trailing whitespace from messages', () => {
      const data = Buffer.from('hello world  \n');
      aggregator.write(1, 'my-app', 'stdout', data);

      const recent = aggregator.getRecentLogs(1);
      expect(recent[0].message).toBe('hello world');
    });

    it('should enforce maxRecentLogs limit per process', () => {
      // The default maxRecentLogs is 1000
      for (let i = 0; i < 1010; i++) {
        aggregator.write(1, 'my-app', 'stdout', Buffer.from(`line ${i}`));
      }

      const recent = aggregator.getRecentLogs(1, 2000);
      expect(recent).toHaveLength(1000);
      // The oldest entries should have been shifted out
      expect(recent[0].message).toBe('line 10');
      expect(recent[999].message).toBe('line 1009');
    });
  });

  describe('getRecentLogs', () => {
    it('should return the last N logs for a process', () => {
      for (let i = 0; i < 10; i++) {
        aggregator.write(1, 'my-app', 'stdout', Buffer.from(`line ${i}`));
      }

      const recent = aggregator.getRecentLogs(1, 3);
      expect(recent).toHaveLength(3);
      expect(recent[0].message).toBe('line 7');
      expect(recent[1].message).toBe('line 8');
      expect(recent[2].message).toBe('line 9');
    });

    it('should default to 50 lines', () => {
      for (let i = 0; i < 100; i++) {
        aggregator.write(1, 'my-app', 'stdout', Buffer.from(`line ${i}`));
      }

      const recent = aggregator.getRecentLogs(1);
      expect(recent).toHaveLength(50);
    });

    it('should return empty array for unknown process', () => {
      const recent = aggregator.getRecentLogs(999);
      expect(recent).toEqual([]);
    });

    it('should return all logs when fewer than requested', () => {
      aggregator.write(1, 'my-app', 'stdout', Buffer.from('only line'));

      const recent = aggregator.getRecentLogs(1, 100);
      expect(recent).toHaveLength(1);
      expect(recent[0].message).toBe('only line');
    });
  });

  describe('getAllRecentLogs', () => {
    it('should return logs from all processes sorted by timestamp', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
        aggregator.write(1, 'app-a', 'stdout', Buffer.from('a1'));

        vi.setSystemTime(new Date('2025-01-01T00:00:01Z'));
        aggregator.write(2, 'app-b', 'stdout', Buffer.from('b1'));

        vi.setSystemTime(new Date('2025-01-01T00:00:02Z'));
        aggregator.write(1, 'app-a', 'stdout', Buffer.from('a2'));

        const all = aggregator.getAllRecentLogs(10);
        expect(all).toHaveLength(3);
        // Should be sorted by timestamp (chronological order)
        expect(all[0].message).toBe('a1');
        expect(all[1].message).toBe('b1');
        expect(all[2].message).toBe('a2');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should default to 50 lines', () => {
      for (let i = 0; i < 30; i++) {
        aggregator.write(1, 'app-a', 'stdout', Buffer.from(`a${i}`));
        aggregator.write(2, 'app-b', 'stdout', Buffer.from(`b${i}`));
      }

      const all = aggregator.getAllRecentLogs();
      expect(all).toHaveLength(50);
    });

    it('should return empty array when no logs exist', () => {
      const all = aggregator.getAllRecentLogs();
      expect(all).toEqual([]);
    });

    it('should slice to the most recent N logs', () => {
      for (let i = 0; i < 10; i++) {
        aggregator.write(1, 'app-a', 'stdout', Buffer.from(`line ${i}`));
      }

      const all = aggregator.getAllRecentLogs(3);
      expect(all).toHaveLength(3);
      expect(all[0].message).toBe('line 7');
      expect(all[2].message).toBe('line 9');
    });
  });

  describe('getLogFiles', () => {
    it('should return correct file paths for stdout and stderr', () => {
      const files = aggregator.getLogFiles('my-app');
      expect(files.out).toBe('/tmp/nova-test-logs/my-app-out.log');
      expect(files.err).toBe('/tmp/nova-test-logs/my-app-error.log');
    });

    it('should handle process names with special characters', () => {
      const files = aggregator.getLogFiles('my-app-v2');
      expect(files.out).toBe('/tmp/nova-test-logs/my-app-v2-out.log');
      expect(files.err).toBe('/tmp/nova-test-logs/my-app-v2-error.log');
    });
  });

  describe('flush', () => {
    it('should end all write streams', async () => {
      aggregator.write(1, 'app-a', 'stdout', Buffer.from('data'));
      aggregator.write(2, 'app-b', 'stdout', Buffer.from('data'));

      await aggregator.flush();

      // Each process has an out and err stream; end should be called on all
      // app-a out + app-a err + app-b out + app-b err = 4 calls
      expect(mockEnd).toHaveBeenCalledTimes(4);
    });

    it('should clear the streams map after flushing', async () => {
      aggregator.write(1, 'my-app', 'stdout', Buffer.from('data'));
      await aggregator.flush();

      // Writing again should create new streams
      vi.mocked(createWriteStream).mockClear();
      aggregator.write(1, 'my-app', 'stdout', Buffer.from('more data'));
      expect(createWriteStream).toHaveBeenCalled();
    });

    it('should handle flush when no streams exist', async () => {
      await expect(aggregator.flush()).resolves.toBeUndefined();
    });
  });

  describe('removeProcess', () => {
    it('should remove recent logs for a specific process', () => {
      aggregator.write(1, 'app-a', 'stdout', Buffer.from('keep'));
      aggregator.write(2, 'app-b', 'stdout', Buffer.from('remove'));

      aggregator.removeProcess(2);

      expect(aggregator.getRecentLogs(2)).toEqual([]);
      expect(aggregator.getRecentLogs(1)).toHaveLength(1);
    });

    it('should not throw when removing non-existent process', () => {
      expect(() => aggregator.removeProcess(999)).not.toThrow();
    });

    it('should not affect other processes when removing one', () => {
      aggregator.write(1, 'app-a', 'stdout', Buffer.from('a'));
      aggregator.write(2, 'app-b', 'stdout', Buffer.from('b'));
      aggregator.write(3, 'app-c', 'stdout', Buffer.from('c'));

      aggregator.removeProcess(2);

      expect(aggregator.getRecentLogs(1)).toHaveLength(1);
      expect(aggregator.getRecentLogs(2)).toEqual([]);
      expect(aggregator.getRecentLogs(3)).toHaveLength(1);
    });
  });

  describe('log entry structure', () => {
    it('should include all required fields in emitted log entries', () => {
      aggregator.write(42, 'test-app', 'stdout', Buffer.from('test message'));

      const emittedEntry = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls[0][1] as LogEntry;
      expect(emittedEntry).toEqual({
        processId: 42,
        processName: 'test-app',
        stream: 'stdout',
        message: 'test message',
        timestamp: expect.any(Date),
      });
    });

    it('should create stderr entries with correct stream type', () => {
      aggregator.write(1, 'test-app', 'stderr', Buffer.from('error!'));

      const emittedEntry = (eventBus.emit as ReturnType<typeof vi.fn>).mock.calls[0][1] as LogEntry;
      expect(emittedEntry.stream).toBe('stderr');
    });
  });
});
