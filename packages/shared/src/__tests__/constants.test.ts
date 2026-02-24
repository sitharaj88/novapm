import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  NOVA_HOME,
  NOVA_PID_FILE,
  NOVA_SOCK_FILE,
  NOVA_LOG_DIR,
  NOVA_DB_FILE,
  NOVA_PLUGIN_DIR,
  NOVA_DAEMON_LOG,
  NOVA_DAEMON_ERROR_LOG,
  NOVA_CONFIG_FILES,
  DEFAULT_KILL_TIMEOUT,
  DEFAULT_LISTEN_TIMEOUT,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_RESTART_DELAY,
  DEFAULT_EXP_BACKOFF_MAX,
  DEFAULT_DASHBOARD_PORT,
  DEFAULT_AGENT_PORT,
  DEFAULT_METRICS_INTERVAL,
  DEFAULT_HEALTH_CHECK_INTERVAL,
  DEFAULT_HEALTH_CHECK_TIMEOUT,
  DEFAULT_HEALTH_CHECK_RETRIES,
  IPC_PROTOCOL_VERSION,
  NOVA_VERSION,
  DEFAULT_INTERPRETER,
  DEFAULT_EXEC_MODE,
  DEFAULT_INSTANCES,
  LOG_ROTATION_SIZE,
  LOG_ROTATION_KEEP,
} from '../constants.js';

describe('constants', () => {
  describe('NOVA_VERSION', () => {
    it('should follow semver format', () => {
      expect(NOVA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should be a non-empty string', () => {
      expect(NOVA_VERSION).toBeTruthy();
      expect(typeof NOVA_VERSION).toBe('string');
    });
  });

  describe('NOVA_HOME paths', () => {
    it('should default to ~/.novapm when NOVA_HOME env is not set', () => {
      // NOVA_HOME is evaluated at module load time, so we check it uses the expected base
      const expectedDefault = join(homedir(), '.novapm');
      if (!process.env.NOVA_HOME) {
        expect(NOVA_HOME).toBe(expectedDefault);
      } else {
        expect(NOVA_HOME).toBe(process.env.NOVA_HOME);
      }
    });

    it('should be an absolute path', () => {
      expect(NOVA_HOME).toMatch(/^\//);
    });
  });

  describe('derived path constants', () => {
    it('NOVA_PID_FILE should be nova.pid inside NOVA_HOME', () => {
      expect(NOVA_PID_FILE).toBe(join(NOVA_HOME, 'nova.pid'));
    });

    it('NOVA_SOCK_FILE should be nova.sock inside NOVA_HOME', () => {
      expect(NOVA_SOCK_FILE).toBe(join(NOVA_HOME, 'nova.sock'));
    });

    it('NOVA_LOG_DIR should be logs directory inside NOVA_HOME', () => {
      expect(NOVA_LOG_DIR).toBe(join(NOVA_HOME, 'logs'));
    });

    it('NOVA_DB_FILE should be nova.db inside NOVA_HOME', () => {
      expect(NOVA_DB_FILE).toBe(join(NOVA_HOME, 'nova.db'));
    });

    it('NOVA_PLUGIN_DIR should be plugins directory inside NOVA_HOME', () => {
      expect(NOVA_PLUGIN_DIR).toBe(join(NOVA_HOME, 'plugins'));
    });

    it('NOVA_DAEMON_LOG should be inside NOVA_LOG_DIR', () => {
      expect(NOVA_DAEMON_LOG).toBe(join(NOVA_LOG_DIR, 'nova-daemon.log'));
      expect(NOVA_DAEMON_LOG.startsWith(NOVA_LOG_DIR)).toBe(true);
    });

    it('NOVA_DAEMON_ERROR_LOG should be inside NOVA_LOG_DIR', () => {
      expect(NOVA_DAEMON_ERROR_LOG).toBe(join(NOVA_LOG_DIR, 'nova-daemon-error.log'));
      expect(NOVA_DAEMON_ERROR_LOG.startsWith(NOVA_LOG_DIR)).toBe(true);
    });

    it('all paths should be strings', () => {
      const paths = [
        NOVA_HOME,
        NOVA_PID_FILE,
        NOVA_SOCK_FILE,
        NOVA_LOG_DIR,
        NOVA_DB_FILE,
        NOVA_PLUGIN_DIR,
        NOVA_DAEMON_LOG,
        NOVA_DAEMON_ERROR_LOG,
      ];
      for (const p of paths) {
        expect(typeof p).toBe('string');
        expect(p.length).toBeGreaterThan(0);
      }
    });
  });

  describe('NOVA_CONFIG_FILES', () => {
    it('should be a non-empty array', () => {
      expect(Array.isArray(NOVA_CONFIG_FILES)).toBe(true);
      expect(NOVA_CONFIG_FILES.length).toBeGreaterThan(0);
    });

    it('should include TypeScript config files', () => {
      expect(NOVA_CONFIG_FILES).toContain('nova.config.ts');
      expect(NOVA_CONFIG_FILES).toContain('ecosystem.config.ts');
    });

    it('should include JavaScript config files', () => {
      expect(NOVA_CONFIG_FILES).toContain('nova.config.js');
      expect(NOVA_CONFIG_FILES).toContain('ecosystem.config.js');
      expect(NOVA_CONFIG_FILES).toContain('ecosystem.config.cjs');
    });

    it('should include JSON config files', () => {
      expect(NOVA_CONFIG_FILES).toContain('nova.config.json');
    });

    it('should include YAML config files', () => {
      expect(NOVA_CONFIG_FILES).toContain('nova.config.yaml');
      expect(NOVA_CONFIG_FILES).toContain('nova.config.yml');
    });

    it('should have TypeScript configs listed before JavaScript configs (priority order)', () => {
      const tsIndex = NOVA_CONFIG_FILES.indexOf('nova.config.ts');
      const jsIndex = NOVA_CONFIG_FILES.indexOf('nova.config.js');
      expect(tsIndex).toBeLessThan(jsIndex);
    });

    it('all entries should be non-empty strings with file extensions', () => {
      for (const file of NOVA_CONFIG_FILES) {
        expect(typeof file).toBe('string');
        expect(file.length).toBeGreaterThan(0);
        expect(file).toMatch(/\.\w+$/);
      }
    });
  });

  describe('timeout and restart defaults', () => {
    it('DEFAULT_KILL_TIMEOUT should be a positive number in milliseconds', () => {
      expect(DEFAULT_KILL_TIMEOUT).toBe(5000);
      expect(DEFAULT_KILL_TIMEOUT).toBeGreaterThan(0);
    });

    it('DEFAULT_LISTEN_TIMEOUT should be a positive number in milliseconds', () => {
      expect(DEFAULT_LISTEN_TIMEOUT).toBe(8000);
      expect(DEFAULT_LISTEN_TIMEOUT).toBeGreaterThan(0);
    });

    it('DEFAULT_MAX_RESTARTS should be a reasonable positive integer', () => {
      expect(DEFAULT_MAX_RESTARTS).toBe(16);
      expect(Number.isInteger(DEFAULT_MAX_RESTARTS)).toBe(true);
      expect(DEFAULT_MAX_RESTARTS).toBeGreaterThan(0);
    });

    it('DEFAULT_RESTART_DELAY should be zero (immediate restart)', () => {
      expect(DEFAULT_RESTART_DELAY).toBe(0);
    });

    it('DEFAULT_EXP_BACKOFF_MAX should be a positive number greater than kill timeout', () => {
      expect(DEFAULT_EXP_BACKOFF_MAX).toBe(30000);
      expect(DEFAULT_EXP_BACKOFF_MAX).toBeGreaterThan(DEFAULT_KILL_TIMEOUT);
    });

    it('DEFAULT_LISTEN_TIMEOUT should be greater than DEFAULT_KILL_TIMEOUT', () => {
      expect(DEFAULT_LISTEN_TIMEOUT).toBeGreaterThan(DEFAULT_KILL_TIMEOUT);
    });
  });

  describe('port defaults', () => {
    it('DEFAULT_DASHBOARD_PORT should be a valid port number', () => {
      expect(DEFAULT_DASHBOARD_PORT).toBe(9615);
      expect(DEFAULT_DASHBOARD_PORT).toBeGreaterThan(0);
      expect(DEFAULT_DASHBOARD_PORT).toBeLessThanOrEqual(65535);
    });

    it('DEFAULT_AGENT_PORT should be a valid port number', () => {
      expect(DEFAULT_AGENT_PORT).toBe(9616);
      expect(DEFAULT_AGENT_PORT).toBeGreaterThan(0);
      expect(DEFAULT_AGENT_PORT).toBeLessThanOrEqual(65535);
    });

    it('dashboard and agent ports should be different', () => {
      expect(DEFAULT_DASHBOARD_PORT).not.toBe(DEFAULT_AGENT_PORT);
    });

    it('ports should be above well-known port range', () => {
      expect(DEFAULT_DASHBOARD_PORT).toBeGreaterThan(1024);
      expect(DEFAULT_AGENT_PORT).toBeGreaterThan(1024);
    });
  });

  describe('metrics and health check defaults', () => {
    it('DEFAULT_METRICS_INTERVAL should be a positive number', () => {
      expect(DEFAULT_METRICS_INTERVAL).toBe(5000);
      expect(DEFAULT_METRICS_INTERVAL).toBeGreaterThan(0);
    });

    it('DEFAULT_HEALTH_CHECK_INTERVAL should be a duration string', () => {
      expect(DEFAULT_HEALTH_CHECK_INTERVAL).toBe('30s');
      expect(typeof DEFAULT_HEALTH_CHECK_INTERVAL).toBe('string');
    });

    it('DEFAULT_HEALTH_CHECK_TIMEOUT should be a duration string shorter than interval', () => {
      expect(DEFAULT_HEALTH_CHECK_TIMEOUT).toBe('5s');
      expect(typeof DEFAULT_HEALTH_CHECK_TIMEOUT).toBe('string');
    });

    it('DEFAULT_HEALTH_CHECK_RETRIES should be a positive integer', () => {
      expect(DEFAULT_HEALTH_CHECK_RETRIES).toBe(3);
      expect(Number.isInteger(DEFAULT_HEALTH_CHECK_RETRIES)).toBe(true);
      expect(DEFAULT_HEALTH_CHECK_RETRIES).toBeGreaterThan(0);
    });
  });

  describe('process execution defaults', () => {
    it('DEFAULT_INTERPRETER should be node', () => {
      expect(DEFAULT_INTERPRETER).toBe('node');
    });

    it('DEFAULT_EXEC_MODE should be fork', () => {
      expect(DEFAULT_EXEC_MODE).toBe('fork');
    });

    it('DEFAULT_INSTANCES should be 1', () => {
      expect(DEFAULT_INSTANCES).toBe(1);
    });
  });

  describe('IPC protocol', () => {
    it('IPC_PROTOCOL_VERSION should be a positive integer', () => {
      expect(IPC_PROTOCOL_VERSION).toBe(1);
      expect(Number.isInteger(IPC_PROTOCOL_VERSION)).toBe(true);
      expect(IPC_PROTOCOL_VERSION).toBeGreaterThan(0);
    });
  });

  describe('log rotation defaults', () => {
    it('LOG_ROTATION_SIZE should be a byte size string', () => {
      expect(LOG_ROTATION_SIZE).toBe('100M');
      expect(typeof LOG_ROTATION_SIZE).toBe('string');
      expect(LOG_ROTATION_SIZE).toMatch(/^\d+[KMGT]?B?$/i);
    });

    it('LOG_ROTATION_KEEP should be a positive integer', () => {
      expect(LOG_ROTATION_KEEP).toBe(10);
      expect(Number.isInteger(LOG_ROTATION_KEEP)).toBe(true);
      expect(LOG_ROTATION_KEEP).toBeGreaterThan(0);
    });
  });
});
