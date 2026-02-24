import { IPCClient, isDaemonRunning, spawnDaemon } from '@novapm/core';
import type { IPCMethod } from '@novapm/shared';

let client: IPCClient | null = null;

/**
 * Get an IPC client connected to the daemon.
 * Auto-starts the daemon if it's not running.
 */
export async function getClient(): Promise<IPCClient> {
  if (client?.isConnected()) return client;

  // Start daemon if not running
  if (!isDaemonRunning()) {
    spawnDaemon();
    // Give the daemon a moment to start
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  client = new IPCClient();
  await client.connect();
  return client;
}

/**
 * Send a request to the daemon and return the result.
 */
export async function daemonRequest(
  method: IPCMethod,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const c = await getClient();
  return c.request(method, params);
}

/**
 * Disconnect the IPC client.
 */
export function disconnect(): void {
  client?.disconnect();
  client = null;
}
