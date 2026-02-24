import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------
const { mockResolveSrv } = vi.hoisted(() => {
  return {
    mockResolveSrv: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------
vi.mock('node:dns', () => ({
  promises: {
    resolveSrv: mockResolveSrv,
  },
}));

vi.mock('@novapm/shared', () => ({
  DEFAULT_AGENT_PORT: 9616,
}));

import { Discovery } from '../Discovery.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Discovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset env vars that might be set by individual tests
    delete process.env['NOVA_CONTROLLER_HOST'];
    delete process.env['NOVA_CONTROLLER_PORT'];
    delete process.env['NOVA_AGENT_PORT'];
    delete process.env['NOVA_AGENT_TOKEN'];
    delete process.env['NOVA_HEARTBEAT_INTERVAL'];
    delete process.env['NOVA_RECONNECT_INTERVAL'];
    delete process.env['NOVA_MAX_RECONNECT_ATTEMPTS'];
  });

  afterEach(() => {
    delete process.env['NOVA_CONTROLLER_HOST'];
    delete process.env['NOVA_CONTROLLER_PORT'];
    delete process.env['NOVA_AGENT_PORT'];
    delete process.env['NOVA_AGENT_TOKEN'];
    delete process.env['NOVA_HEARTBEAT_INTERVAL'];
    delete process.env['NOVA_RECONNECT_INTERVAL'];
    delete process.env['NOVA_MAX_RECONNECT_ATTEMPTS'];
  });

  // ---- fromConfig ---------------------------------------------------------

  describe('fromConfig', () => {
    it('should create AgentConfig from explicit host and port', () => {
      const config = Discovery.fromConfig({
        host: '10.0.0.1',
        port: 9100,
      });

      expect(config.controllerHost).toBe('10.0.0.1');
      expect(config.controllerPort).toBe(9100);
      expect(config.agentPort).toBe(9616);
      expect(config.heartbeatInterval).toBe(30_000);
      expect(config.reconnectInterval).toBe(5_000);
      expect(config.maxReconnectAttempts).toBe(50);
      expect(config.auth).toBeUndefined();
    });

    it('should apply custom optional values', () => {
      const config = Discovery.fromConfig({
        host: '10.0.0.1',
        port: 9100,
        agentPort: 8000,
        heartbeatInterval: 10_000,
        reconnectInterval: 2_000,
        maxReconnectAttempts: 10,
        token: 'my-token',
      });

      expect(config.agentPort).toBe(8000);
      expect(config.heartbeatInterval).toBe(10_000);
      expect(config.reconnectInterval).toBe(2_000);
      expect(config.maxReconnectAttempts).toBe(10);
      expect(config.auth).toEqual({ token: 'my-token' });
    });

    it('should set auth to undefined when no token is provided', () => {
      const config = Discovery.fromConfig({
        host: 'localhost',
        port: 9100,
      });

      expect(config.auth).toBeUndefined();
    });
  });

  // ---- fromEnvironment ----------------------------------------------------

  describe('fromEnvironment', () => {
    it('should create AgentConfig from environment variables', () => {
      process.env['NOVA_CONTROLLER_HOST'] = '192.168.1.1';
      process.env['NOVA_CONTROLLER_PORT'] = '9200';

      const config = Discovery.fromEnvironment();

      expect(config).not.toBeNull();
      expect(config!.controllerHost).toBe('192.168.1.1');
      expect(config!.controllerPort).toBe(9200);
      expect(config!.agentPort).toBe(9616);
    });

    it('should return null when NOVA_CONTROLLER_HOST is missing', () => {
      process.env['NOVA_CONTROLLER_PORT'] = '9200';

      expect(Discovery.fromEnvironment()).toBeNull();
    });

    it('should return null when NOVA_CONTROLLER_PORT is missing', () => {
      process.env['NOVA_CONTROLLER_HOST'] = '192.168.1.1';

      expect(Discovery.fromEnvironment()).toBeNull();
    });

    it('should return null for invalid port', () => {
      process.env['NOVA_CONTROLLER_HOST'] = '192.168.1.1';
      process.env['NOVA_CONTROLLER_PORT'] = 'not-a-number';

      expect(Discovery.fromEnvironment()).toBeNull();
    });

    it('should return null for port out of range (0)', () => {
      process.env['NOVA_CONTROLLER_HOST'] = '192.168.1.1';
      process.env['NOVA_CONTROLLER_PORT'] = '0';

      expect(Discovery.fromEnvironment()).toBeNull();
    });

    it('should return null for port out of range (99999)', () => {
      process.env['NOVA_CONTROLLER_HOST'] = '192.168.1.1';
      process.env['NOVA_CONTROLLER_PORT'] = '99999';

      expect(Discovery.fromEnvironment()).toBeNull();
    });

    it('should parse all optional environment variables', () => {
      process.env['NOVA_CONTROLLER_HOST'] = '10.0.0.1';
      process.env['NOVA_CONTROLLER_PORT'] = '9100';
      process.env['NOVA_AGENT_PORT'] = '7000';
      process.env['NOVA_AGENT_TOKEN'] = 'env-token';
      process.env['NOVA_HEARTBEAT_INTERVAL'] = '15000';
      process.env['NOVA_RECONNECT_INTERVAL'] = '3000';
      process.env['NOVA_MAX_RECONNECT_ATTEMPTS'] = '20';

      const config = Discovery.fromEnvironment();

      expect(config).not.toBeNull();
      expect(config!.agentPort).toBe(7000);
      expect(config!.auth).toEqual({ token: 'env-token' });
      expect(config!.heartbeatInterval).toBe(15_000);
      expect(config!.reconnectInterval).toBe(3_000);
      expect(config!.maxReconnectAttempts).toBe(20);
    });

    it('should use defaults for NaN optional values', () => {
      process.env['NOVA_CONTROLLER_HOST'] = '10.0.0.1';
      process.env['NOVA_CONTROLLER_PORT'] = '9100';
      process.env['NOVA_AGENT_PORT'] = 'nope';
      process.env['NOVA_HEARTBEAT_INTERVAL'] = 'bad';
      process.env['NOVA_RECONNECT_INTERVAL'] = 'bad';
      process.env['NOVA_MAX_RECONNECT_ATTEMPTS'] = 'bad';

      const config = Discovery.fromEnvironment();

      expect(config).not.toBeNull();
      expect(config!.agentPort).toBe(9616);
      expect(config!.heartbeatInterval).toBe(30_000);
      expect(config!.reconnectInterval).toBe(5_000);
      expect(config!.maxReconnectAttempts).toBe(50);
    });

    it('should not set auth when NOVA_AGENT_TOKEN is not set', () => {
      process.env['NOVA_CONTROLLER_HOST'] = '10.0.0.1';
      process.env['NOVA_CONTROLLER_PORT'] = '9100';

      const config = Discovery.fromEnvironment();
      expect(config!.auth).toBeUndefined();
    });
  });

  // ---- fromDNS ------------------------------------------------------------

  describe('fromDNS', () => {
    it('should discover controller via DNS SRV records', async () => {
      mockResolveSrv.mockResolvedValueOnce([
        { name: 'controller.example.com', port: 9100, priority: 10, weight: 50 },
      ]);

      const config = await Discovery.fromDNS('example.com');

      expect(config).not.toBeNull();
      expect(config!.controllerHost).toBe('controller.example.com');
      expect(config!.controllerPort).toBe(9100);
      expect(config!.agentPort).toBe(9616);

      expect(mockResolveSrv).toHaveBeenCalledWith('_novapm._tcp.example.com');
    });

    it('should select the record with highest priority (lowest number)', async () => {
      mockResolveSrv.mockResolvedValueOnce([
        { name: 'secondary.example.com', port: 9200, priority: 20, weight: 50 },
        { name: 'primary.example.com', port: 9100, priority: 10, weight: 50 },
      ]);

      const config = await Discovery.fromDNS('example.com');

      expect(config).not.toBeNull();
      expect(config!.controllerHost).toBe('primary.example.com');
      expect(config!.controllerPort).toBe(9100);
    });

    it('should prefer higher weight when priorities are equal', async () => {
      mockResolveSrv.mockResolvedValueOnce([
        { name: 'low-weight.example.com', port: 9200, priority: 10, weight: 10 },
        { name: 'high-weight.example.com', port: 9100, priority: 10, weight: 90 },
      ]);

      const config = await Discovery.fromDNS('example.com');

      expect(config).not.toBeNull();
      expect(config!.controllerHost).toBe('high-weight.example.com');
    });

    it('should return null when no SRV records are found', async () => {
      mockResolveSrv.mockResolvedValueOnce([]);

      const config = await Discovery.fromDNS('example.com');
      expect(config).toBeNull();
    });

    it('should return null when DNS lookup fails', async () => {
      mockResolveSrv.mockRejectedValueOnce(new Error('ENOTFOUND'));

      const config = await Discovery.fromDNS('nonexistent.example.com');
      expect(config).toBeNull();
    });

    it('should return null when DNS returns ENODATA', async () => {
      mockResolveSrv.mockRejectedValueOnce(new Error('ENODATA'));

      const config = await Discovery.fromDNS('no-records.example.com');
      expect(config).toBeNull();
    });

    it('should include default config values in DNS-discovered config', async () => {
      mockResolveSrv.mockResolvedValueOnce([
        { name: 'ctrl.example.com', port: 9100, priority: 10, weight: 50 },
      ]);

      const config = await Discovery.fromDNS('example.com');

      expect(config).not.toBeNull();
      expect(config!.heartbeatInterval).toBe(30_000);
      expect(config!.reconnectInterval).toBe(5_000);
      expect(config!.maxReconnectAttempts).toBe(50);
    });
  });
});
