import { homedir } from 'node:os';
import { join } from 'node:path';

export const NOVA_HOME = process.env.NOVA_HOME || join(homedir(), '.novapm');
export const NOVA_PID_FILE = join(NOVA_HOME, 'nova-pm.pid');
export const NOVA_SOCK_FILE = join(NOVA_HOME, 'nova-pm.sock');
export const NOVA_LOG_DIR = join(NOVA_HOME, 'logs');
export const NOVA_DB_FILE = join(NOVA_HOME, 'nova-pm.db');
export const NOVA_PLUGIN_DIR = join(NOVA_HOME, 'plugins');
export const NOVA_DAEMON_LOG = join(NOVA_LOG_DIR, 'nova-pm-daemon.log');
export const NOVA_DAEMON_ERROR_LOG = join(NOVA_LOG_DIR, 'nova-pm-daemon-error.log');

export const NOVA_CONFIG_FILES = [
  'nova-pm.config.ts',
  'nova-pm.config.js',
  'nova-pm.config.json',
  'nova-pm.config.yaml',
  'nova-pm.config.yml',
  'ecosystem.config.ts',
  'ecosystem.config.js',
  'ecosystem.config.cjs',
];

export const DEFAULT_KILL_TIMEOUT = 5000;
export const DEFAULT_LISTEN_TIMEOUT = 8000;
export const DEFAULT_MAX_RESTARTS = 16;
export const DEFAULT_RESTART_DELAY = 0;
export const DEFAULT_EXP_BACKOFF_MAX = 30000;
export const DEFAULT_DASHBOARD_PORT = 9615;
export const DEFAULT_AGENT_PORT = 9616;
export const DEFAULT_METRICS_INTERVAL = 5000;
export const DEFAULT_HEALTH_CHECK_INTERVAL = '30s';
export const DEFAULT_HEALTH_CHECK_TIMEOUT = '5s';
export const DEFAULT_HEALTH_CHECK_RETRIES = 3;
export const IPC_PROTOCOL_VERSION = 1;
export const NOVA_VERSION = '1.0.1';

export const DEFAULT_INTERPRETER = 'node';
export const DEFAULT_EXEC_MODE = 'fork' as const;
export const DEFAULT_INSTANCES = 1;

export const LOG_ROTATION_SIZE = '100M';
export const LOG_ROTATION_KEEP = 10;
