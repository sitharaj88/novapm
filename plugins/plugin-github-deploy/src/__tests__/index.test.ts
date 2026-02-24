import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginContext } from '@novapm/plugin-sdk';

// Mock child_process so we never execute real shell commands
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return {
    ...actual,
    promisify: vi.fn().mockReturnValue(
      vi.fn().mockResolvedValue({ stdout: 'deploy ok', stderr: '' }),
    ),
  };
});

import { promisify } from 'node:util';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

const TEST_SECRET = 'super-secret-webhook-key';
const TEST_BRANCH = 'main';
const TEST_COMMAND = 'echo "deploying..."';

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
      secret: TEST_SECRET,
      branch: TEST_BRANCH,
      command: TEST_COMMAND,
      repository: 'myorg/myrepo',
      cwd: '/opt/app',
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

function createPushPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: `refs/heads/${TEST_BRANCH}`,
    repository: {
      full_name: 'myorg/myrepo',
      name: 'myrepo',
      clone_url: 'https://github.com/myorg/myrepo.git',
    },
    head_commit: {
      id: 'abc123def456',
      message: 'feat: add new feature',
      author: { name: 'Test User', email: 'test@example.com' },
      timestamp: '2025-01-15T10:30:00Z',
    },
    pusher: {
      name: 'testuser',
      email: 'test@example.com',
    },
    ...overrides,
  };
}

function signPayload(body: string, secret: string = TEST_SECRET): string {
  const hmac = createHmac('sha256', secret).update(body, 'utf-8').digest('hex');
  return `sha256=${hmac}`;
}

function createWebhookRequest(
  body: string,
  signature?: string,
): { headers: Record<string, string | undefined>; body: string } {
  return {
    headers: {
      'x-hub-signature-256': signature,
      'content-type': 'application/json',
    },
    body,
  };
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('GitHubDeployPlugin', () => {
  let execAsyncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T10:30:00.000Z'));

    // Reset the promisify mock to return a fresh mock function
    execAsyncMock = vi.fn().mockResolvedValue({ stdout: 'deploy ok', stderr: '' });
    vi.mocked(promisify).mockReturnValue(execAsyncMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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
      expect(plugin.name).toBe('plugin-github-deploy');
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
  // Lifecycle – onInit
  // ------------------------------------------------------------------

  describe('onInit', () => {
    it('should initialize successfully with valid config', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await expect(plugin.onInit(ctx)).resolves.toBeUndefined();
      expect(ctx.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ branch: TEST_BRANCH }),
        'GitHub Deploy plugin initialized',
      );
    });

    it('should throw when secret is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).secret;
      await expect(plugin.onInit(ctx)).rejects.toThrow('secret');
    });

    it('should throw when secret is not a string', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ secret: 42 });
      await expect(plugin.onInit(ctx)).rejects.toThrow('secret');
    });

    it('should throw when branch is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).branch;
      await expect(plugin.onInit(ctx)).rejects.toThrow('branch');
    });

    it('should throw when command is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).command;
      await expect(plugin.onInit(ctx)).rejects.toThrow('command');
    });

    it('should restore deployment counter from storage', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      vi.mocked(ctx.storage.get).mockResolvedValueOnce(42);
      await plugin.onInit(ctx);

      expect(ctx.storage.get).toHaveBeenCalledWith('deploymentCounter');
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
      expect(ctx.logger.info).toHaveBeenCalledWith('GitHub Deploy plugin destroyed');
    });
  });

  // ------------------------------------------------------------------
  // Routes
  // ------------------------------------------------------------------

  describe('routes', () => {
    it('should register a POST webhook route', async () => {
      const plugin = await getPlugin();
      const routes = plugin.routes!();
      const webhookRoute = routes.find((r) => r.path.includes('webhook'));

      expect(webhookRoute).toBeDefined();
      expect(webhookRoute!.method).toBe('POST');
      expect(webhookRoute!.path).toBe('/api/v1/plugins/github-deploy/webhook');
    });

    it('should register a GET deployments route', async () => {
      const plugin = await getPlugin();
      const routes = plugin.routes!();
      const deploymentsRoute = routes.find((r) => r.path.includes('deployments'));

      expect(deploymentsRoute).toBeDefined();
      expect(deploymentsRoute!.method).toBe('GET');
      expect(deploymentsRoute!.path).toBe('/api/v1/plugins/github-deploy/deployments');
    });
  });

  // ------------------------------------------------------------------
  // Webhook – signature validation
  // ------------------------------------------------------------------

  describe('webhook signature validation', () => {
    it('should return 401 when signature header is missing', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const body = JSON.stringify(createPushPayload());
      const request = createWebhookRequest(body, undefined);
      const result = (await webhookHandler(request, {})) as { statusCode: number; body: { error: string } };

      expect(result.statusCode).toBe(401);
      expect(result.body.error).toBe('Missing signature');
      expect(ctx.logger.warn).toHaveBeenCalledWith('Webhook received without signature');
    });

    it('should return 403 when signature is invalid', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const body = JSON.stringify(createPushPayload());
      const request = createWebhookRequest(body, 'sha256=invalidhex');
      const result = (await webhookHandler(request, {})) as { statusCode: number; body: { error: string } };

      expect(result.statusCode).toBe(403);
      expect(result.body.error).toBe('Invalid signature');
    });

    it('should accept valid HMAC-SHA256 signature', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const body = JSON.stringify(createPushPayload());
      const signature = signPayload(body);
      const request = createWebhookRequest(body, signature);

      const result = (await webhookHandler(request, {})) as { statusCode: number; body: { message: string } };

      expect(result.statusCode).toBe(202);
      expect(result.body.message).toBe('Deployment triggered');
    });

    it('should reject a signature computed with the wrong secret', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const body = JSON.stringify(createPushPayload());
      const wrongSignature = signPayload(body, 'wrong-secret');
      const request = createWebhookRequest(body, wrongSignature);

      const result = (await webhookHandler(request, {})) as { statusCode: number; body: { error: string } };

      expect(result.statusCode).toBe(403);
      expect(result.body.error).toBe('Invalid signature');
    });
  });

  // ------------------------------------------------------------------
  // Webhook – payload parsing
  // ------------------------------------------------------------------

  describe('webhook payload parsing', () => {
    it('should return 400 for invalid JSON body', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const body = 'not-json{{{';
      const signature = signPayload(body);
      const request = createWebhookRequest(body, signature);

      const result = (await webhookHandler(request, {})) as { statusCode: number; body: { error: string } };

      expect(result.statusCode).toBe(400);
      expect(result.body.error).toBe('Invalid JSON payload');
    });
  });

  // ------------------------------------------------------------------
  // Webhook – branch filtering
  // ------------------------------------------------------------------

  describe('webhook branch filtering', () => {
    it('should ignore pushes to non-target branches', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload({ ref: 'refs/heads/develop' });
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      const result = (await webhookHandler(request, {})) as { statusCode: number; body: { message: string } };

      expect(result.statusCode).toBe(200);
      expect(result.body.message).toContain('non-target branch');
    });

    it('should accept pushes to the configured branch', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ branch: 'production' });
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload({ ref: 'refs/heads/production' });
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      const result = (await webhookHandler(request, {})) as { statusCode: number; body: { message: string } };

      expect(result.statusCode).toBe(202);
      expect(result.body.message).toBe('Deployment triggered');
    });
  });

  // ------------------------------------------------------------------
  // Webhook – repository filtering
  // ------------------------------------------------------------------

  describe('webhook repository filtering', () => {
    it('should ignore pushes from non-target repositories', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext({ repository: 'myorg/myrepo' });
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload({
        repository: { full_name: 'other/repo', name: 'repo', clone_url: 'https://github.com/other/repo.git' },
      });
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      const result = (await webhookHandler(request, {})) as { statusCode: number; body: { message: string } };

      expect(result.statusCode).toBe(200);
      expect(result.body.message).toContain('non-target repository');
    });

    it('should accept pushes from the configured repository', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload();
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      const result = (await webhookHandler(request, {})) as { statusCode: number; body: { message: string } };

      expect(result.statusCode).toBe(202);
    });

    it('should accept pushes from any repository when repository is not configured', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      delete (ctx.config as Record<string, unknown>).repository;
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload({
        repository: { full_name: 'any/repo', name: 'repo', clone_url: 'https://github.com/any/repo.git' },
      });
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      const result = (await webhookHandler(request, {})) as { statusCode: number; body: { message: string } };

      expect(result.statusCode).toBe(202);
    });
  });

  // ------------------------------------------------------------------
  // Deployment triggering
  // ------------------------------------------------------------------

  describe('deployment triggering', () => {
    it('should return a deployment ID in the response', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload();
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      const result = (await webhookHandler(request, {})) as {
        statusCode: number;
        body: { deploymentId: string; branch: string; commit: string };
      };

      expect(result.statusCode).toBe(202);
      expect(result.body.deploymentId).toMatch(/^deploy-/);
      expect(result.body.branch).toBe(TEST_BRANCH);
      expect(result.body.commit).toBe('abc123def456');
    });

    it('should store the deployment record in storage', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload();
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      await webhookHandler(request, {});

      // Should store both the deployment record and the updated counter.
      // Note: the record object is mutated in-place through pending→running→success,
      // so we check the key pattern and final field values (not status).
      expect(ctx.storage.set).toHaveBeenCalledWith(
        expect.stringMatching(/^deployment:deploy-/),
        expect.objectContaining({
          repository: 'myorg/myrepo',
          branch: TEST_BRANCH,
          commitId: 'abc123def456',
          commitMessage: 'feat: add new feature',
          author: 'testuser',
        }),
      );

      expect(ctx.storage.set).toHaveBeenCalledWith(
        'deploymentCounter',
        expect.any(Number),
      );
    });

    it('should emit github-deploy:triggered event', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload();
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      await webhookHandler(request, {});

      expect(ctx.api.emit).toHaveBeenCalledWith(
        'github-deploy:triggered',
        expect.objectContaining({
          repository: 'myorg/myrepo',
          branch: TEST_BRANCH,
          commit: 'abc123def456',
        }),
      );
    });

    it('should handle null head_commit gracefully', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload({ head_commit: null });
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      const result = (await webhookHandler(request, {})) as {
        statusCode: number;
        body: { commit: string };
      };

      expect(result.statusCode).toBe(202);
      expect(result.body.commit).toBe('unknown');
    });
  });

  // ------------------------------------------------------------------
  // Deployment execution
  // ------------------------------------------------------------------

  describe('deployment execution', () => {
    it('should execute the configured command', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload();
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      await webhookHandler(request, {});

      // Allow the background deployment to run
      await vi.advanceTimersByTimeAsync(100);

      expect(execAsyncMock).toHaveBeenCalledWith(
        TEST_COMMAND,
        expect.objectContaining({
          cwd: '/opt/app',
          timeout: 300000,
          env: expect.objectContaining({
            NOVAPM_DEPLOY_BRANCH: TEST_BRANCH,
            NOVAPM_DEPLOY_REPO: 'myorg/myrepo',
          }),
        }),
      );
    });

    it('should update record to success on successful execution', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload();
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      await webhookHandler(request, {});
      await vi.advanceTimersByTimeAsync(100);

      // The final storage.set call should have status: 'success'
      const setCalls = vi.mocked(ctx.storage.set).mock.calls;
      const finalRecord = setCalls
        .filter(([key]) => (key as string).startsWith('deployment:deploy-'))
        .pop();

      expect(finalRecord).toBeDefined();
      expect((finalRecord![1] as Record<string, unknown>).status).toBe('success');
      expect((finalRecord![1] as Record<string, unknown>).output).toContain('deploy ok');
    });

    it('should emit github-deploy:success on successful deployment', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload();
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      await webhookHandler(request, {});
      await vi.advanceTimersByTimeAsync(100);

      expect(ctx.api.emit).toHaveBeenCalledWith(
        'github-deploy:success',
        expect.objectContaining({
          repository: 'myorg/myrepo',
          commit: 'abc123def456',
        }),
      );
    });

    it('should update record to failed when command throws', async () => {
      execAsyncMock.mockRejectedValueOnce(new Error('Command failed'));

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload();
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      await webhookHandler(request, {});
      await vi.advanceTimersByTimeAsync(100);

      const setCalls = vi.mocked(ctx.storage.set).mock.calls;
      const finalRecord = setCalls
        .filter(([key]) => (key as string).startsWith('deployment:deploy-'))
        .pop();

      expect(finalRecord).toBeDefined();
      expect((finalRecord![1] as Record<string, unknown>).status).toBe('failed');
      expect((finalRecord![1] as Record<string, unknown>).error).toContain('Command failed');
    });

    it('should emit github-deploy:failed when command fails', async () => {
      execAsyncMock.mockRejectedValueOnce(new Error('Deploy script error'));

      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const webhookHandler = routes.find((r) => r.path.includes('webhook'))!.handler;

      const payload = createPushPayload();
      const body = JSON.stringify(payload);
      const request = createWebhookRequest(body, signPayload(body));

      await webhookHandler(request, {});
      await vi.advanceTimersByTimeAsync(100);

      expect(ctx.api.emit).toHaveBeenCalledWith(
        'github-deploy:failed',
        expect.objectContaining({
          repository: 'myorg/myrepo',
          error: 'Deploy script error',
        }),
      );
    });
  });

  // ------------------------------------------------------------------
  // GET deployments
  // ------------------------------------------------------------------

  describe('GET deployments endpoint', () => {
    it('should return empty deployments list when storage is empty', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const deploymentsHandler = routes.find((r) => r.path.includes('deployments'))!.handler;

      vi.mocked(ctx.storage.list).mockResolvedValueOnce([]);

      const result = (await deploymentsHandler({}, {})) as {
        statusCode: number;
        body: { deployments: unknown[] };
      };

      expect(result.statusCode).toBe(200);
      expect(result.body.deployments).toEqual([]);
    });

    it('should return deployments sorted by startedAt descending', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const deploymentsHandler = routes.find((r) => r.path.includes('deployments'))!.handler;

      vi.mocked(ctx.storage.list).mockResolvedValueOnce([
        'deployment:deploy-1',
        'deployment:deploy-2',
      ]);

      vi.mocked(ctx.storage.get)
        .mockResolvedValueOnce({
          id: 'deploy-1',
          startedAt: '2025-01-15T10:00:00.000Z',
          status: 'success',
        })
        .mockResolvedValueOnce({
          id: 'deploy-2',
          startedAt: '2025-01-15T11:00:00.000Z',
          status: 'running',
        });

      const result = (await deploymentsHandler({}, {})) as {
        statusCode: number;
        body: { deployments: Array<{ id: string }> };
      };

      expect(result.statusCode).toBe(200);
      expect(result.body.deployments).toHaveLength(2);
      // deploy-2 should come first (more recent)
      expect(result.body.deployments[0].id).toBe('deploy-2');
      expect(result.body.deployments[1].id).toBe('deploy-1');
    });

    it('should limit to 50 deployments', async () => {
      const plugin = await getPlugin();
      const ctx = createMockContext();
      await plugin.onInit(ctx);

      const routes = plugin.routes!();
      const deploymentsHandler = routes.find((r) => r.path.includes('deployments'))!.handler;

      // Create 60 fake deployment keys
      const keys = Array.from({ length: 60 }, (_, i) => `deployment:deploy-${i}`);
      vi.mocked(ctx.storage.list).mockResolvedValueOnce(keys);

      // Return deployment records for all
      vi.mocked(ctx.storage.get).mockImplementation(async (key: string) => {
        if (key === 'deploymentCounter') return null;
        const idx = parseInt(key.split('-').pop()!, 10);
        return {
          id: `deploy-${idx}`,
          startedAt: new Date(Date.now() - idx * 60000).toISOString(),
          status: 'success',
        };
      });

      const result = (await deploymentsHandler({}, {})) as {
        statusCode: number;
        body: { deployments: unknown[] };
      };

      expect(result.body.deployments).toHaveLength(50);
    });
  });
});
