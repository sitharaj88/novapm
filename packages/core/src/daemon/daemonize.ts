import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  NOVA_PID_FILE,
  NOVA_HOME,
  NOVA_DAEMON_LOG,
  NOVA_DAEMON_ERROR_LOG,
  NOVA_LOG_DIR,
  DaemonAlreadyRunningError,
} from '@novapm/shared';
import { openSync } from 'node:fs';

/**
 * Check if the daemon is already running by checking the PID file.
 */
export function isDaemonRunning(): boolean {
  if (!existsSync(NOVA_PID_FILE)) return false;

  try {
    const pid = parseInt(readFileSync(NOVA_PID_FILE, 'utf-8').trim(), 10);
    // Check if process is actually running
    process.kill(pid, 0);
    return true;
  } catch {
    // Process doesn't exist, clean up stale PID file
    try {
      unlinkSync(NOVA_PID_FILE);
    } catch {
      // Ignore
    }
    return false;
  }
}

/**
 * Get the daemon PID from the PID file.
 */
export function getDaemonPid(): number | null {
  if (!existsSync(NOVA_PID_FILE)) return null;

  try {
    const pid = parseInt(readFileSync(NOVA_PID_FILE, 'utf-8').trim(), 10);
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/**
 * Write the current process PID to the PID file.
 */
export function writePidFile(): void {
  mkdirSync(dirname(NOVA_PID_FILE), { recursive: true });
  writeFileSync(NOVA_PID_FILE, String(process.pid));
}

/**
 * Remove the PID file.
 */
export function removePidFile(): void {
  try {
    unlinkSync(NOVA_PID_FILE);
  } catch {
    // Ignore
  }
}

/**
 * Spawn the daemon as a detached background process.
 */
export function spawnDaemon(): number {
  if (isDaemonRunning()) {
    const pid = getDaemonPid();
    throw new DaemonAlreadyRunningError(pid!);
  }

  mkdirSync(NOVA_HOME, { recursive: true });
  mkdirSync(NOVA_LOG_DIR, { recursive: true });

  const outFd = openSync(NOVA_DAEMON_LOG, 'a');
  const errFd = openSync(NOVA_DAEMON_ERROR_LOG, 'a');

  // Find the daemon entry point
  const daemonScript = new URL('./daemon-entry.js', import.meta.url).pathname;

  const child = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: {
      ...process.env,
      NOVA_DAEMON: '1',
    },
  });

  child.unref();

  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to spawn daemon process');
  }

  // Write PID file for the spawned daemon
  mkdirSync(dirname(NOVA_PID_FILE), { recursive: true });
  writeFileSync(NOVA_PID_FILE, String(pid));

  return pid;
}
