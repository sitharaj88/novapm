import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@novapm/plugin-sdk';
import type { ProcessEvent } from '@novapm/shared';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
  } as unknown as PluginContext['logger'];
}

function createMockStorage() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
  };
}

function createMockContext(configOverrides: Record<string, unknown> = {}): PluginContext {
  const defaultConfig: Record<string, unknown> = {
    smtp: {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: 'testuser@example.com',
        pass: 'testpass123',
      },
    },
    from: 'novapm@example.com',
    to: ['admin@example.com', 'ops@example.com'],
    events: ['crash', 'start', 'stop', 'restart', 'exit', 'health-check-fail', 'health-check-restore'],
    ...configOverrides,
  };

  return {
    config: defaultConfig,
    logger: createMockLogger(),
    api: {
      getProcesses: vi.fn().mockReturnValue([]),
      getProcess: vi.fn().mockReturnValue(null),
      restartProcess: vi.fn(),
      stopProcess: vi.fn(),
      scaleProcess: vi.fn(),
      getMetrics: vi.fn().mockReturnValue(null),
      getSystemMetrics: vi.fn().mockReturnValue(null),
      getRecentLogs: vi.fn().mockReturnValue([]),
      emit: vi.fn(),
      on: vi.fn(),
    },
    storage: createMockStorage(),
  };
}

function createProcessEvent(overrides: Partial<ProcessEvent> = {}): ProcessEvent {
  return {
    type: 'start',
    processId: 1,
    processName: 'test-app',
    timestamp: new Date('2025-01-15T10:30:00.000Z'),
    data: {},
    ...overrides,
  };
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('EmailPlugin', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function getPlugin() {
    const mod = await import('../index.js');
    return mod.default;
  }

  // ------------------------------------------------------------------
  // Metadata
  // ------------------------------------------------------------------

  describe('plugin metadata', () => {
    it('should have the correct name', async () => {
      const plugin = await getPlugin();
      expect(plugin.name).toBe('plugin-email');
    });

    it('should have a valid semver version', async () => {
      const plugin = await getPlugin();
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should have a description', async () => {
      const plugin = await getPlugin();
      expect(typeof plugin.description).toBe('string');
    });

    it('should have an author', async () => {
      const plugin = await getPlugin();
      expect(plugin.author).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // Lifecycle – onInit (config validation)
  // ------------------------------------------------------------------

  describe('onInit – configuration validation', () => {
    it('should initialize successfully with valid config', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await expect(plugin.onInit(ctx)).resolves.toBeUndefined();
      expect(ctx.logger.info).toHaveBeenCalled();
    });

    it('should throw when smtp is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).smtp;
      await expect(plugin.onInit(ctx)).rejects.toThrow('smtp.host');
    });

    it('should throw when smtp.host is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ smtp: { port: 587, auth: { user: 'u', pass: 'p' } } });
      await expect(plugin.onInit(ctx)).rejects.toThrow('smtp.host');
    });

    it('should throw when smtp.auth.user is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({
        smtp: { host: 'smtp.example.com', auth: { pass: 'p' } },
      });
      await expect(plugin.onInit(ctx)).rejects.toThrow('smtp.auth.user');
    });

    it('should throw when smtp.auth.pass is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({
        smtp: { host: 'smtp.example.com', auth: { user: 'u' } },
      });
      await expect(plugin.onInit(ctx)).rejects.toThrow('smtp.auth');
    });

    it('should throw when smtp.auth is missing entirely', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({
        smtp: { host: 'smtp.example.com' },
      });
      await expect(plugin.onInit(ctx)).rejects.toThrow('smtp.auth');
    });

    it('should throw when from is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).from;
      await expect(plugin.onInit(ctx)).rejects.toThrow('from');
    });

    it('should throw when from is not a string', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ from: 42 });
      await expect(plugin.onInit(ctx)).rejects.toThrow('from');
    });

    it('should throw when to is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).to;
      await expect(plugin.onInit(ctx)).rejects.toThrow('to');
    });

    it('should throw when to is an empty array', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ to: [] });
      await expect(plugin.onInit(ctx)).rejects.toThrow('to');
    });

    it('should default smtp port to 587 when not provided', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({
        smtp: { host: 'smtp.example.com', auth: { user: 'u', pass: 'p' } },
        endpoint: 'https://email-api.example.com/send',
      });
      await plugin.onInit(ctx);

      // Trigger an event to inspect the payload
      const event = createProcessEvent({ type: 'start' });
      await plugin.onProcessStart!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.smtp.port).toBe(587);
      expect(body.smtp.secure).toBe(false);
    });

    it('should default events to crash and health-check-fail when not provided', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      delete (ctx.config as Record<string, unknown>).events;
      await plugin.onInit(ctx);

      // crash should trigger
      const crashEvent = createProcessEvent({ type: 'crash', data: { exitCode: 1, signal: 'SIGTERM' } });
      await plugin.onProcessCrash!(crashEvent);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // start should NOT trigger
      await plugin.onProcessStart!(createProcessEvent());
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------------------------------
  // Lifecycle – onDestroy
  // ------------------------------------------------------------------

  describe('onDestroy', () => {
    it('should execute without errors', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);
      await expect(plugin.onDestroy!()).resolves.toBeUndefined();
      expect(ctx.logger.info).toHaveBeenCalledWith('Email plugin destroyed');
    });
  });

  // ------------------------------------------------------------------
  // Email sending – via endpoint
  // ------------------------------------------------------------------

  describe('sending emails via endpoint', () => {
    it('should POST email payload to configured endpoint', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      const event = createProcessEvent({ type: 'crash', data: { exitCode: 1, signal: 'SIGTERM' } });
      await plugin.onProcessCrash!(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://email-api.example.com/send');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(options.body as string);
      expect(body.from).toBe('novapm@example.com');
      expect(body.to).toEqual(['admin@example.com', 'ops@example.com']);
      expect(body.subject).toContain('CRASH');
      expect(body.subject).toContain('test-app');
      expect(body.html).toContain('test-app');
      expect(body.text).toContain('test-app');
      expect(body.smtp.host).toBe('smtp.example.com');
    });

    it('should log error when endpoint returns non-ok response', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: vi.fn().mockResolvedValue('Server Error'),
      });

      const event = createProcessEvent({ type: 'crash', data: { exitCode: 1 } });
      await plugin.onProcessCrash!(event);

      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ status: 500 }),
        'Failed to send email notification via endpoint',
      );
    });

    it('should log error when fetch throws', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const event = createProcessEvent({ type: 'crash', data: { exitCode: 1 } });
      await plugin.onProcessCrash!(event);

      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        'Error sending email notification',
      );
    });

    it('should log debug on successful endpoint send', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      const event = createProcessEvent({ type: 'start' });
      await plugin.onProcessStart!(event);

      expect(ctx.logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringContaining('started') }),
        'Email notification sent via endpoint',
      );
    });
  });

  // ------------------------------------------------------------------
  // Email sending – without endpoint (logs and stores)
  // ------------------------------------------------------------------

  describe('sending emails without endpoint (storage fallback)', () => {
    it('should log the notification payload when no endpoint is configured', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const event = createProcessEvent({ type: 'crash', data: { exitCode: 1, signal: 'SIGTERM' } });
      await plugin.onProcessCrash!(event);

      // Should NOT call fetch (no endpoint)
      expect(mockFetch).not.toHaveBeenCalled();

      // Should log the notification payload
      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('CRASH'),
          to: ['admin@example.com', 'ops@example.com'],
          templateType: 'crash',
          processName: 'test-app',
          processId: 1,
        }),
        expect.stringContaining('no endpoint configured'),
      );
    });

    it('should store the notification in plugin storage', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const event = createProcessEvent({ type: 'start' });
      await plugin.onProcessStart!(event);

      expect(ctx.storage.set).toHaveBeenCalledWith(
        expect.stringMatching(/^notification:\d+$/),
        expect.objectContaining({
          from: 'novapm@example.com',
          to: ['admin@example.com', 'ops@example.com'],
          subject: expect.stringContaining('started'),
          html: expect.any(String),
          text: expect.any(String),
          timestamp: expect.any(String),
        }),
      );
    });
  });

  // ------------------------------------------------------------------
  // Event filtering
  // ------------------------------------------------------------------

  describe('event filtering', () => {
    it('should not send for events not in the events list', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ events: ['crash'], endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      await plugin.onProcessStart!(createProcessEvent({ type: 'start' }));
      await plugin.onProcessStop!(createProcessEvent({ type: 'stop' }));
      await plugin.onProcessRestart!(createProcessEvent({ type: 'restart' }));
      await plugin.onProcessExit!(createProcessEvent({ type: 'exit', data: { exitCode: 0 } }));
      await plugin.onHealthCheckFail!(createProcessEvent({ type: 'health-check-fail', data: { reason: 'fail' } }));
      await plugin.onHealthCheckRestore!(createProcessEvent({ type: 'health-check-restore' }));

      expect(mockFetch).not.toHaveBeenCalled();

      // Only crash should trigger
      await plugin.onProcessCrash!(createProcessEvent({ type: 'crash', data: { exitCode: 1 } }));
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------------------------------
  // Each event type
  // ------------------------------------------------------------------

  describe('onProcessCrash', () => {
    it('should include exit code and signal in the email', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      const event = createProcessEvent({
        type: 'crash',
        data: { exitCode: 137, signal: 'SIGKILL' },
      });
      await plugin.onProcessCrash!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.subject).toContain('CRASH');
      expect(body.text).toContain('137');
      expect(body.text).toContain('SIGKILL');
      expect(body.html).toContain('137');
    });
  });

  describe('onProcessStop', () => {
    it('should send a stop email notification', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      await plugin.onProcessStop!(createProcessEvent({ type: 'stop' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.subject).toContain('stopped');
    });
  });

  describe('onProcessRestart', () => {
    it('should send a restart email notification', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      await plugin.onProcessRestart!(createProcessEvent({ type: 'restart' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.subject).toContain('restarted');
    });
  });

  describe('onProcessExit', () => {
    it('should include exit code in the email subject', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      const event = createProcessEvent({ type: 'exit', data: { exitCode: 0 } });
      await plugin.onProcessExit!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.subject).toContain('exited');
      expect(body.subject).toContain('0');
    });
  });

  describe('onHealthCheckFail', () => {
    it('should include reason in the email', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      const event = createProcessEvent({
        type: 'health-check-fail',
        data: { reason: 'Connection refused on port 3000' },
      });
      await plugin.onHealthCheckFail!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.subject).toContain('ALERT');
      expect(body.subject).toContain('Health check');
      expect(body.text).toContain('Connection refused on port 3000');
    });
  });

  describe('onHealthCheckRestore', () => {
    it('should send a health check restore email', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      await plugin.onHealthCheckRestore!(createProcessEvent({ type: 'health-check-restore' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.subject).toContain('Health check restored');
    });
  });

  // ------------------------------------------------------------------
  // HTML and text template content
  // ------------------------------------------------------------------

  describe('email template content', () => {
    it('should generate HTML with proper structure', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      const event = createProcessEvent({ type: 'crash', data: { exitCode: 1, signal: 'SIGTERM' } });
      await plugin.onProcessCrash!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);

      // HTML structure checks
      expect(body.html).toContain('<!DOCTYPE html>');
      expect(body.html).toContain('NovaPM Alert');
      expect(body.html).toContain('test-app');
      expect(body.html).toContain('Process Crashed');

      // Text structure checks
      expect(body.text).toContain('NovaPM Alert');
      expect(body.text).toContain('test-app');
      expect(body.text).toContain('crash');
    });

    it('should include process ID in the email body', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ endpoint: 'https://email-api.example.com/send' });
      await plugin.onInit(ctx);

      const event = createProcessEvent({ type: 'start', processId: 42 });
      await plugin.onProcessStart!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.html).toContain('42');
      expect(body.text).toContain('42');
    });
  });
});
