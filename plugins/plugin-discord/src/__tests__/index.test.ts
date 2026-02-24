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

function createMockContext(configOverrides: Record<string, unknown> = {}): PluginContext {
  return {
    config: {
      webhookUrl: 'https://discord.com/api/webhooks/1234567890/abcdef',
      events: ['crash', 'start', 'stop', 'restart', 'exit', 'health-check-fail', 'health-check-restore'],
      username: 'NovaPM',
      avatarUrl: 'https://example.com/avatar.png',
      ...configOverrides,
    },
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
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    },
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

describe('DiscordPlugin', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: vi.fn().mockResolvedValue(''),
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
      expect(plugin.name).toBe('plugin-discord');
    });

    it('should have a valid semver version', async () => {
      const plugin = await getPlugin();
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should have a description', async () => {
      const plugin = await getPlugin();
      expect(typeof plugin.description).toBe('string');
      expect(plugin.description!.length).toBeGreaterThan(0);
    });

    it('should have an author', async () => {
      const plugin = await getPlugin();
      expect(plugin.author).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // Lifecycle – onInit
  // ------------------------------------------------------------------

  describe('onInit', () => {
    it('should initialize successfully with valid config', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await expect(plugin.onInit(ctx)).resolves.toBeUndefined();
      expect(ctx.logger.info).toHaveBeenCalled();
    });

    it('should throw when webhookUrl is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).webhookUrl;
      await expect(plugin.onInit(ctx)).rejects.toThrow('webhookUrl');
    });

    it('should throw when webhookUrl is not a string', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ webhookUrl: 12345 });
      await expect(plugin.onInit(ctx)).rejects.toThrow('webhookUrl');
    });

    it('should default events to crash and health-check-fail when not provided', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).events;
      await plugin.onInit(ctx);

      // crash should trigger
      const crashEvent = createProcessEvent({ type: 'crash', data: { exitCode: 1, signal: 'SIGKILL' } });
      await plugin.onProcessCrash!(crashEvent);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // start should NOT trigger
      const startEvent = createProcessEvent({ type: 'start' });
      await plugin.onProcessStart!(startEvent);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should default username to NovaPM when not provided', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).username;
      await plugin.onInit(ctx);

      await plugin.onProcessStart!(createProcessEvent());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.username).toBe('NovaPM');
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
      expect(ctx.logger.info).toHaveBeenCalledWith('Discord plugin destroyed');
    });

    it('should not throw if called before init', async () => {
      const plugin = await getPlugin();
      await expect(plugin.onDestroy!()).resolves.toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // Event handling
  // ------------------------------------------------------------------

  describe('onProcessStart', () => {
    it('should send a Discord embed notification', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({ type: 'start' });
      await plugin.onProcessStart!(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://discord.com/api/webhooks/1234567890/abcdef');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(options.body as string);
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toBe('Process Started');
      expect(body.embeds[0].color).toBe(0x36a64f); // start color
      expect(body.embeds[0].footer.text).toBe('NovaPM Process Manager');
      expect(body.embeds[0].timestamp).toBe('2025-01-15T10:30:00.000Z');
    });

    it('should NOT send when start is not in events list', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext({ events: ['crash'] }));

      await plugin.onProcessStart!(createProcessEvent());
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('onProcessStop', () => {
    it('should send a stop notification with correct color', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      await plugin.onProcessStop!(createProcessEvent({ type: 'stop' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.embeds[0].title).toBe('Process Stopped');
      expect(body.embeds[0].color).toBe(0xffa500);
    });
  });

  describe('onProcessRestart', () => {
    it('should send a restart notification with correct color', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      await plugin.onProcessRestart!(createProcessEvent({ type: 'restart' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.embeds[0].title).toBe('Process Restarted');
      expect(body.embeds[0].color).toBe(0x2196f3);
    });
  });

  describe('onProcessCrash', () => {
    it('should send a crash notification with exit code and signal fields', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({
        type: 'crash',
        data: { exitCode: 1, signal: 'SIGTERM' },
      });
      await plugin.onProcessCrash!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.embeds[0].title).toBe('PROCESS CRASHED');
      expect(body.embeds[0].color).toBe(0xff0000);

      const fieldNames = body.embeds[0].fields.map((f: { name: string }) => f.name);
      expect(fieldNames).toContain('Exit Code');
      expect(fieldNames).toContain('Signal');
    });

    it('should handle missing exitCode and signal with defaults', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({ type: 'crash', data: {} });
      await plugin.onProcessCrash!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      const exitCodeField = body.embeds[0].fields.find((f: { name: string }) => f.name === 'Exit Code');
      const signalField = body.embeds[0].fields.find((f: { name: string }) => f.name === 'Signal');
      expect(exitCodeField.value).toBe('unknown');
      expect(signalField.value).toBe('none');
    });
  });

  describe('onProcessExit', () => {
    it('should send an exit notification with exit code field', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({ type: 'exit', data: { exitCode: 0 } });
      await plugin.onProcessExit!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.embeds[0].title).toBe('Process Exited');
      expect(body.embeds[0].color).toBe(0x808080);
      const exitCodeField = body.embeds[0].fields.find((f: { name: string }) => f.name === 'Exit Code');
      expect(exitCodeField.value).toBe('0');
    });
  });

  describe('onHealthCheckFail', () => {
    it('should send a health check fail notification with reason field', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({
        type: 'health-check-fail',
        data: { reason: 'Timeout' },
      });
      await plugin.onHealthCheckFail!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.embeds[0].title).toBe('Health Check Failed');
      expect(body.embeds[0].color).toBe(0xff6600);
      const reasonField = body.embeds[0].fields.find((f: { name: string }) => f.name === 'Reason');
      expect(reasonField.value).toBe('Timeout');
    });
  });

  describe('onHealthCheckRestore', () => {
    it('should send a health check restore notification', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      await plugin.onHealthCheckRestore!(createProcessEvent({ type: 'health-check-restore' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.embeds[0].title).toBe('Health Check Restored');
      expect(body.embeds[0].color).toBe(0x36a64f);
    });
  });

  // ------------------------------------------------------------------
  // Embed payload structure
  // ------------------------------------------------------------------

  describe('embed payload structure', () => {
    it('should always include Process and Process ID in embed fields', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      await plugin.onProcessStart!(createProcessEvent({ processName: 'my-service', processId: 42 }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      const fields = body.embeds[0].fields;
      expect(fields[0]).toEqual({ name: 'Process', value: 'my-service', inline: true });
      expect(fields[1]).toEqual({ name: 'Process ID', value: '42', inline: true });
    });

    it('should include avatar_url when configured', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext({ avatarUrl: 'https://example.com/pic.png' }));

      await plugin.onProcessStart!(createProcessEvent());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.avatar_url).toBe('https://example.com/pic.png');
    });

    it('should not include avatar_url when not configured', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).avatarUrl;
      await plugin.onInit(ctx);

      await plugin.onProcessStart!(createProcessEvent());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.avatar_url).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // Error handling
  // ------------------------------------------------------------------

  describe('error handling', () => {
    it('should log an error when fetch returns a non-ok response', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: vi.fn().mockResolvedValue('Rate limited'),
      });

      await plugin.onProcessStart!(createProcessEvent());

      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ status: 429 }),
        'Failed to send Discord notification',
      );
    });

    it('should log an error when fetch throws a network error', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      mockFetch.mockRejectedValueOnce(new Error('DNS resolution failed'));

      await plugin.onProcessStart!(createProcessEvent());

      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        'Error sending Discord notification',
      );
    });

    it('should log debug on successful send', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      await plugin.onProcessStart!(createProcessEvent({ processName: 'web-api' }));

      expect(ctx.logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'start', processName: 'web-api' }),
        'Discord notification sent',
      );
    });
  });
});
