import type { ChildProcess } from 'node:child_process';
import { DEFAULT_KILL_TIMEOUT } from '@novapm/shared';

export interface ShutdownOptions {
  timeout?: number;
  useMessage?: boolean;
}

/**
 * Gracefully shut down a child process.
 *
 * Sequence:
 * 1. If useMessage: send IPC 'shutdown' message
 * 2. Send SIGINT
 * 3. Wait for timeout
 * 4. Send SIGTERM
 * 5. Wait for timeout / 2
 * 6. Send SIGKILL
 */
export function gracefulShutdown(
  child: ChildProcess,
  options: ShutdownOptions = {},
): Promise<number | null> {
  const { timeout = DEFAULT_KILL_TIMEOUT, useMessage = false } = options;

  return new Promise((resolve) => {
    let resolved = false;

    const done = (code: number | null) => {
      if (!resolved) {
        resolved = true;
        resolve(code);
      }
    };

    child.once('exit', (code: number | null) => done(code));

    // If the process is already dead
    if (child.exitCode !== null || child.killed) {
      done(child.exitCode);
      return;
    }

    // Step 1: Try IPC message if connected
    if (useMessage && child.connected) {
      try {
        child.send({ type: 'shutdown' });
      } catch {
        // Process may have already disconnected
      }
    }

    // Step 2: Send SIGINT
    try {
      child.kill('SIGINT');
    } catch {
      done(null);
      return;
    }

    // Step 3: Wait, then SIGTERM
    const termTimer = setTimeout(() => {
      if (resolved) return;
      try {
        child.kill('SIGTERM');
      } catch {
        done(null);
        return;
      }

      // Step 4: Wait, then SIGKILL
      const killTimer = setTimeout(
        () => {
          if (resolved) return;
          try {
            child.kill('SIGKILL');
          } catch {
            // Already dead
          }
          // Give SIGKILL a moment to take effect
          setTimeout(() => done(null), 500);
        },
        Math.floor(timeout / 2),
      );

      killTimer.unref();
    }, timeout);

    termTimer.unref();
  });
}
