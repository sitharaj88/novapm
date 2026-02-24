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
      webhookUrl: 'https://hooks.slack.com/services/T00/B00/xxxxx',
      events: ['crash', 'start', 'stop', 'restart', 'exit', 'health-check-fail', 'health-check-restore'],
      channel: '#alerts',
      username: 'TestBot',
      iconEmoji: ':test:',
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

describe('SlackPlugin', () => {
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

  /**
   * Re-import the module fresh for each test group so the singleton
   * instance is not shared across tests that mutate internal state.
   */
  async function getPlugin() {
    // Reset modules to get a fresh singleton instance (avoids state leakage)
    vi.resetModules();
    const mod = await import('../index.js');
    return mod.default;
  }

  // ------------------------------------------------------------------
  // Metadata
  // ------------------------------------------------------------------

  describe('plugin metadata', () => {
    it('should have the correct name', async () => {
      const plugin = await getPlugin();
      expect(plugin.name).toBe('plugin-slack');
    });

    it('should have a valid semver version', async () => {
      const plugin = await getPlugin();
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should have a description', async () => {
      const plugin = await getPlugin();
      expect(plugin.description).toBeDefined();
      expect(typeof plugin.description).toBe('string');
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
      const ctx = createMockContext({ webhookUrl: 42 });
      await expect(plugin.onInit(ctx)).rejects.toThrow('webhookUrl');
    });

    it('should default events to crash and health-check-fail when not provided', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).events;
      await plugin.onInit(ctx);

      // Crash should send, start should not
      const crashEvent = createProcessEvent({ type: 'crash', data: { exitCode: 1, signal: 'SIGTERM' } });
      await plugin.onProcessCrash!(crashEvent);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const startEvent = createProcessEvent({ type: 'start' });
      await plugin.onProcessStart!(startEvent);
      // Still 1 because start is not in the default set
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should default username to NovaPM when not provided', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).username;
      delete (ctx.config as Record<string, unknown>).iconEmoji;
      await plugin.onInit(ctx);

      const event = createProcessEvent({ type: 'start' });
      await plugin.onProcessStart!(event);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.username).toBe('NovaPM');
      expect(body.icon_emoji).toBe(':rocket:');
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
      expect(ctx.logger.info).toHaveBeenCalledWith('Slack plugin destroyed');
    });

    it('should not throw if called before init', async () => {
      const plugin = await getPlugin();
      await expect(plugin.onDestroy!()).resolves.toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // Event handling – notification sending
  // ------------------------------------------------------------------

  describe('onProcessStart', () => {
    it('should send a notification when start is in events list', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({ type: 'start' });
      await plugin.onProcessStart!(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://hooks.slack.com/services/T00/B00/xxxxx');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(options.body as string);
      expect(body.channel).toBe('#alerts');
      expect(body.username).toBe('TestBot');
      expect(body.icon_emoji).toBe(':test:');
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0].color).toBe('#36A64F'); // start color
      expect(body.attachments[0].fallback).toContain('test-app');
    });

    it('should NOT send a notification when start is not in events list', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext({ events: ['crash'] }));

      await plugin.onProcessStart!(createProcessEvent());
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('onProcessStop', () => {
    it('should send a notification for stop events', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({ type: 'stop' });
      await plugin.onProcessStop!(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.attachments[0].color).toBe('#FFA500'); // stop color
      expect(body.attachments[0].fallback).toContain('Stopped');
    });
  });

  describe('onProcessRestart', () => {
    it('should send a notification for restart events', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({ type: 'restart' });
      await plugin.onProcessRestart!(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.attachments[0].color).toBe('#2196F3'); // restart color
    });
  });

  describe('onProcessCrash', () => {
    it('should send a notification with exit code and signal fields', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({
        type: 'crash',
        data: { exitCode: 1, signal: 'SIGTERM' },
      });
      await plugin.onProcessCrash!(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.attachments[0].color).toBe('#FF0000'); // crash color

      // Should contain fields section with exit code and signal
      const blocks = body.attachments[0].blocks;
      const fieldsBlock = blocks.find(
        (b: Record<string, unknown>) => b.type === 'section' && Array.isArray(b.fields),
      );
      expect(fieldsBlock).toBeDefined();
      const fieldTexts = fieldsBlock.fields.map((f: { text: string }) => f.text);
      expect(fieldTexts.some((t: string) => t.includes('1'))).toBe(true);
      expect(fieldTexts.some((t: string) => t.includes('SIGTERM'))).toBe(true);
    });

    it('should handle missing exitCode and signal gracefully', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({ type: 'crash', data: {} });
      await plugin.onProcessCrash!(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      const blocks = body.attachments[0].blocks;
      const fieldsBlock = blocks.find(
        (b: Record<string, unknown>) => b.type === 'section' && Array.isArray(b.fields),
      );
      const fieldTexts = fieldsBlock.fields.map((f: { text: string }) => f.text);
      expect(fieldTexts.some((t: string) => t.includes('unknown'))).toBe(true);
      expect(fieldTexts.some((t: string) => t.includes('none'))).toBe(true);
    });
  });

  describe('onProcessExit', () => {
    it('should send a notification for exit events', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({ type: 'exit', data: { exitCode: 0 } });
      await plugin.onProcessExit!(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.attachments[0].fallback).toContain('Exited');
    });
  });

  describe('onHealthCheckFail', () => {
    it('should send a notification with reason field', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({
        type: 'health-check-fail',
        data: { reason: 'Connection refused' },
      });
      await plugin.onHealthCheckFail!(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.attachments[0].color).toBe('#FF6600');
      const blocks = body.attachments[0].blocks;
      const fieldsBlock = blocks.find(
        (b: Record<string, unknown>) => b.type === 'section' && Array.isArray(b.fields),
      );
      expect(fieldsBlock).toBeDefined();
    });
  });

  describe('onHealthCheckRestore', () => {
    it('should send a notification for health check restore', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      const event = createProcessEvent({ type: 'health-check-restore' });
      await plugin.onHealthCheckRestore!(event);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.attachments[0].color).toBe('#36A64F');
      expect(body.attachments[0].fallback).toContain('Restored');
    });
  });

  // ------------------------------------------------------------------
  // Message formatting
  // ------------------------------------------------------------------

  describe('message formatting', () => {
    it('should include header, section, and context blocks', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext());

      await plugin.onProcessStart!(createProcessEvent());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      const blocks = body.attachments[0].blocks;

      const blockTypes = blocks.map((b: { type: string }) => b.type);
      expect(blockTypes).toContain('header');
      expect(blockTypes).toContain('section');
      expect(blockTypes).toContain('context');
    });

    it('should not include channel when channel is not configured', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(createMockContext({ channel: undefined }));

      await plugin.onProcessStart!(createProcessEvent());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.channel).toBeUndefined();
    });

    it('should use custom template when configured', async () => {
      const plugin = await getPlugin();
      await plugin.onInit(
        createMockContext({
          templates: { start: 'Custom start message for {{processName}}' },
        }),
      );

      await plugin.onProcessStart!(createProcessEvent());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      const sectionBlock = body.attachments[0].blocks.find(
        (b: { type: string }) => b.type === 'section',
      );
      expect(sectionBlock.text.text).toBe('Custom start message for {{processName}}');
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
        status: 500,
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      });

      await plugin.onProcessStart!(createProcessEvent());

      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ status: 500 }),
        'Failed to send Slack notification',
      );
    });

    it('should log an error when fetch throws a network error', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await plugin.onProcessStart!(createProcessEvent());

      expect(ctx.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        'Error sending Slack notification',
      );
    });

    it('should log debug message on successful send', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      await plugin.onProcessStart!(createProcessEvent());

      expect(ctx.logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'start', processName: 'test-app' }),
        'Slack notification sent',
      );
    });
  });
});
