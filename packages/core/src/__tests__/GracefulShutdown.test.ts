import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { gracefulShutdown } from '../process/GracefulShutdown.js';

function createMockChildProcess(overrides: Partial<ChildProcess> = {}): ChildProcess {
  const emitter = new EventEmitter();

  const child = Object.assign(emitter, {
    pid: 99999,
    stdin: null,
    stdout: null,
    stderr: null,
    stdio: [null, null, null] as ChildProcess['stdio'],
    connected: false,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    killed: false,
    channel: undefined,
    kill: vi.fn().mockReturnValue(true),
    send: vi.fn().mockReturnValue(true),
    disconnect: vi.fn(),
    unref: vi.fn(),
    ref: vi.fn(),
    [Symbol.dispose]: vi.fn(),
    serialization: 'json' as const,
    ...overrides,
  }) as unknown as ChildProcess;

  return child;
}

describe('gracefulShutdown', () => {
  let mockChild: ChildProcess;

  beforeEach(() => {
    vi.useFakeTimers();
    mockChild = createMockChildProcess();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('already-dead processes', () => {
    it('should resolve immediately if process has exitCode set', async () => {
      mockChild = createMockChildProcess({ exitCode: 0 });

      const promise = gracefulShutdown(mockChild);

      const result = await promise;
      expect(result).toBe(0);
      expect(mockChild.kill).not.toHaveBeenCalled();
    });

    it('should resolve immediately if process is already killed', async () => {
      mockChild = createMockChildProcess({ killed: true });

      const promise = gracefulShutdown(mockChild);

      const result = await promise;
      expect(result).toBeNull();
      expect(mockChild.kill).not.toHaveBeenCalled();
    });

    it('should resolve with non-zero exit code for crashed process', async () => {
      mockChild = createMockChildProcess({ exitCode: 1 });

      const result = await gracefulShutdown(mockChild);
      expect(result).toBe(1);
    });
  });

  describe('graceful shutdown sequence (SIGINT -> SIGTERM -> SIGKILL)', () => {
    it('should send SIGINT first', () => {
      gracefulShutdown(mockChild, { timeout: 5000 });

      expect(mockChild.kill).toHaveBeenCalledWith('SIGINT');
    });

    it('should resolve when process exits after SIGINT', async () => {
      const promise = gracefulShutdown(mockChild, { timeout: 5000 });

      // Process exits immediately after SIGINT
      mockChild.emit('exit', 0);

      const result = await promise;
      expect(result).toBe(0);
      // Only SIGINT should have been sent
      expect(mockChild.kill).toHaveBeenCalledTimes(1);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGINT');
    });

    it('should send SIGTERM after timeout if process does not exit', async () => {
      gracefulShutdown(mockChild, { timeout: 5000 });

      expect(mockChild.kill).toHaveBeenCalledWith('SIGINT');
      expect(mockChild.kill).toHaveBeenCalledTimes(1);

      // Advance past the timeout
      vi.advanceTimersByTime(5000);

      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockChild.kill).toHaveBeenCalledTimes(2);
    });

    it('should resolve when process exits after SIGTERM', async () => {
      const promise = gracefulShutdown(mockChild, { timeout: 5000 });

      // Advance to SIGTERM
      vi.advanceTimersByTime(5000);

      // Process exits after SIGTERM
      mockChild.emit('exit', 0);

      const result = await promise;
      expect(result).toBe(0);
    });

    it('should send SIGKILL after timeout/2 from SIGTERM if process still alive', async () => {
      gracefulShutdown(mockChild, { timeout: 5000 });

      // Advance to SIGTERM (5000ms)
      vi.advanceTimersByTime(5000);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

      // Advance past SIGKILL delay (timeout/2 = 2500ms)
      vi.advanceTimersByTime(2500);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should resolve with null after SIGKILL', async () => {
      const promise = gracefulShutdown(mockChild, { timeout: 5000 });

      // Advance through all stages: SIGINT -> SIGTERM (5000) -> SIGKILL (2500) -> resolve (500)
      vi.advanceTimersByTime(5000); // SIGTERM
      vi.advanceTimersByTime(2500); // SIGKILL
      vi.advanceTimersByTime(500); // Final resolve

      const result = await promise;
      expect(result).toBeNull();
    });

    it('should use default timeout when not specified', () => {
      gracefulShutdown(mockChild);

      expect(mockChild.kill).toHaveBeenCalledWith('SIGINT');

      // Default timeout is 5000ms (DEFAULT_KILL_TIMEOUT)
      vi.advanceTimersByTime(5000);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('useMessage option (IPC shutdown)', () => {
    it('should send IPC shutdown message when useMessage is true and child is connected', () => {
      mockChild = createMockChildProcess({ connected: true });

      gracefulShutdown(mockChild, { useMessage: true, timeout: 5000 });

      expect(mockChild.send).toHaveBeenCalledWith({ type: 'shutdown' });
      expect(mockChild.kill).toHaveBeenCalledWith('SIGINT');
    });

    it('should not send IPC message when useMessage is false', () => {
      mockChild = createMockChildProcess({ connected: true });

      gracefulShutdown(mockChild, { useMessage: false, timeout: 5000 });

      expect(mockChild.send).not.toHaveBeenCalled();
    });

    it('should not send IPC message when child is not connected', () => {
      mockChild = createMockChildProcess({ connected: false });

      gracefulShutdown(mockChild, { useMessage: true, timeout: 5000 });

      expect(mockChild.send).not.toHaveBeenCalled();
    });

    it('should handle IPC send failure gracefully', () => {
      mockChild = createMockChildProcess({ connected: true });
      (mockChild.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Channel closed');
      });

      // Should not throw
      expect(() => {
        gracefulShutdown(mockChild, { useMessage: true, timeout: 5000 });
      }).not.toThrow();

      // Should still proceed with SIGINT
      expect(mockChild.kill).toHaveBeenCalledWith('SIGINT');
    });
  });

  describe('kill failure handling', () => {
    it('should resolve with null if SIGINT kill throws', async () => {
      (mockChild.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('No such process');
      });

      const result = await gracefulShutdown(mockChild, { timeout: 5000 });

      expect(result).toBeNull();
    });

    it('should resolve with null if SIGTERM kill throws', async () => {
      let callCount = 0;
      (mockChild.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          // SIGTERM call
          throw new Error('No such process');
        }
        return true;
      });

      const promise = gracefulShutdown(mockChild, { timeout: 5000 });

      // Advance to SIGTERM
      vi.advanceTimersByTime(5000);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('should handle SIGKILL failure gracefully', async () => {
      let callCount = 0;
      (mockChild.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 3) {
          // SIGKILL call
          throw new Error('No such process');
        }
        return true;
      });

      const promise = gracefulShutdown(mockChild, { timeout: 5000 });

      // Advance through SIGTERM
      vi.advanceTimersByTime(5000);
      // Advance through SIGKILL
      vi.advanceTimersByTime(2500);
      // Advance past final timeout
      vi.advanceTimersByTime(500);

      // Should still resolve (not reject)
      const result = await promise;
      expect(result).toBeNull();
    });
  });

  describe('early exit scenarios', () => {
    it('should resolve only once even if exit fires multiple times', async () => {
      const promise = gracefulShutdown(mockChild, { timeout: 5000 });

      // Fire exit twice
      mockChild.emit('exit', 0);
      mockChild.emit('exit', 1);

      const result = await promise;
      // Should resolve with the first exit code
      expect(result).toBe(0);
    });

    it('should not send SIGTERM if process exited before timeout', async () => {
      const promise = gracefulShutdown(mockChild, { timeout: 5000 });

      // Process exits before SIGTERM timeout
      vi.advanceTimersByTime(1000);
      mockChild.emit('exit', 0);

      await promise;

      // Advance past the SIGTERM timeout to make sure it does not fire
      vi.advanceTimersByTime(5000);

      // Only SIGINT should have been sent
      expect(mockChild.kill).toHaveBeenCalledTimes(1);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGINT');
    });

    it('should resolve with exit code when process exits between SIGTERM and SIGKILL', async () => {
      const promise = gracefulShutdown(mockChild, { timeout: 5000 });

      // Advance to SIGTERM
      vi.advanceTimersByTime(5000);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

      // Process exits before SIGKILL
      vi.advanceTimersByTime(1000);
      mockChild.emit('exit', 143); // 128 + 15 (SIGTERM)

      const result = await promise;
      expect(result).toBe(143);

      // Advance past SIGKILL timeout - SIGKILL should not be sent
      vi.advanceTimersByTime(2000);
      expect(mockChild.kill).not.toHaveBeenCalledWith('SIGKILL');
    });
  });

  describe('custom timeout values', () => {
    it('should respect custom timeout for SIGTERM delay', () => {
      gracefulShutdown(mockChild, { timeout: 10000 });

      // Should not have sent SIGTERM yet at 5s
      vi.advanceTimersByTime(5000);
      expect(mockChild.kill).toHaveBeenCalledTimes(1); // only SIGINT

      // Should send SIGTERM at 10s
      vi.advanceTimersByTime(5000);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should use half the timeout for SIGKILL delay after SIGTERM', () => {
      gracefulShutdown(mockChild, { timeout: 10000 });

      // Advance to SIGTERM (10000ms)
      vi.advanceTimersByTime(10000);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

      // SIGKILL delay should be timeout/2 = 5000ms
      vi.advanceTimersByTime(4999);
      expect(mockChild.kill).not.toHaveBeenCalledWith('SIGKILL');

      vi.advanceTimersByTime(1);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should handle very short timeout', async () => {
      const promise = gracefulShutdown(mockChild, { timeout: 100 });

      // SIGINT sent immediately
      expect(mockChild.kill).toHaveBeenCalledWith('SIGINT');

      // SIGTERM at 100ms
      vi.advanceTimersByTime(100);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

      // SIGKILL at 100 + 50 = 150ms
      vi.advanceTimersByTime(50);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');

      // Resolve after final timeout
      vi.advanceTimersByTime(500);
      const result = await promise;
      expect(result).toBeNull();
    });
  });
});
