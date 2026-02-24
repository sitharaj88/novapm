import { createHmac, timingSafeEqual } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  NovaPMPlugin,
  PluginContext,
  RouteDefinition,
} from '@novapm/plugin-sdk';

const execAsync = promisify(exec);

/**
 * Configuration for the GitHub Deploy plugin.
 */
interface GitHubDeployConfig {
  secret: string;
  branch: string;
  command: string;
  repository?: string;
  cwd?: string;
}

/**
 * GitHub push event payload (partial type covering fields we use).
 */
interface GitHubPushPayload {
  ref: string;
  repository: {
    full_name: string;
    name: string;
    clone_url: string;
  };
  head_commit: {
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
    timestamp: string;
  } | null;
  pusher: {
    name: string;
    email: string;
  };
}

/**
 * Represents the incoming webhook request.
 */
interface WebhookRequest {
  headers: Record<string, string | undefined>;
  body: string;
}

/**
 * Deployment record stored in plugin storage.
 */
interface DeploymentRecord {
  id: string;
  repository: string;
  branch: string;
  commitId: string;
  commitMessage: string;
  author: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  startedAt: string;
  completedAt: string | null;
  output: string | null;
  error: string | null;
}

/**
 * GitHub webhook deployment plugin for NovaPM.
 *
 * Receives GitHub push webhooks, verifies the signature using HMAC-SHA256,
 * and triggers deployment commands when pushes to the configured branch occur.
 */
class GitHubDeployPlugin implements NovaPMPlugin {
  readonly name = 'plugin-github-deploy';
  readonly version = '0.2.0';
  readonly description = 'GitHub webhook deployment for NovaPM';
  readonly author = 'NovaPM Team';

  private context: PluginContext | null = null;
  private config: GitHubDeployConfig | null = null;
  private deploymentCounter = 0;

  async onInit(context: PluginContext): Promise<void> {
    this.context = context;

    const rawConfig = context.config as Record<string, unknown>;
    if (!rawConfig.secret || typeof rawConfig.secret !== 'string') {
      throw new Error('GitHub Deploy plugin requires a "secret" configuration');
    }
    if (!rawConfig.branch || typeof rawConfig.branch !== 'string') {
      throw new Error('GitHub Deploy plugin requires a "branch" configuration');
    }
    if (!rawConfig.command || typeof rawConfig.command !== 'string') {
      throw new Error('GitHub Deploy plugin requires a "command" configuration');
    }

    this.config = {
      secret: rawConfig.secret,
      branch: rawConfig.branch,
      command: rawConfig.command,
      repository: rawConfig.repository as string | undefined,
      cwd: rawConfig.cwd as string | undefined,
    };

    // Restore counter from storage
    const storedCounter = await context.storage.get<number>('deploymentCounter');
    if (storedCounter !== null) {
      this.deploymentCounter = storedCounter;
    }

    context.logger.info(
      { branch: this.config.branch, repository: this.config.repository },
      'GitHub Deploy plugin initialized',
    );
  }

  async onDestroy(): Promise<void> {
    this.context?.logger.info('GitHub Deploy plugin destroyed');
  }

  routes(): RouteDefinition[] {
    return [
      {
        method: 'POST',
        path: '/api/v1/plugins/github-deploy/webhook',
        handler: async (request: unknown, _reply: unknown): Promise<unknown> => {
          return this.handleWebhook(request as WebhookRequest);
        },
      },
      {
        method: 'GET',
        path: '/api/v1/plugins/github-deploy/deployments',
        handler: async (_request: unknown, _reply: unknown): Promise<unknown> => {
          return this.getDeployments();
        },
      },
    ];
  }

  /**
   * Handle an incoming GitHub webhook request.
   */
  private async handleWebhook(request: WebhookRequest): Promise<unknown> {
    if (!this.config || !this.context) {
      return { statusCode: 500, body: { error: 'Plugin not initialized' } };
    }

    // Verify the webhook signature
    const signature = request.headers['x-hub-signature-256'];
    if (!signature) {
      this.context.logger.warn('Webhook received without signature');
      return { statusCode: 401, body: { error: 'Missing signature' } };
    }

    if (!this.verifySignature(request.body, signature)) {
      this.context.logger.warn('Webhook signature verification failed');
      return { statusCode: 403, body: { error: 'Invalid signature' } };
    }

    // Parse the payload
    let payload: GitHubPushPayload;
    try {
      payload = JSON.parse(request.body) as GitHubPushPayload;
    } catch {
      this.context.logger.error('Failed to parse webhook payload');
      return { statusCode: 400, body: { error: 'Invalid JSON payload' } };
    }

    // Check if this is a push event to the configured branch
    const expectedRef = `refs/heads/${this.config.branch}`;
    if (payload.ref !== expectedRef) {
      this.context.logger.debug(
        { ref: payload.ref, expected: expectedRef },
        'Push to non-target branch, ignoring',
      );
      return {
        statusCode: 200,
        body: { message: 'Push to non-target branch, ignored' },
      };
    }

    // Check repository filter if configured
    if (
      this.config.repository &&
      payload.repository.full_name !== this.config.repository
    ) {
      this.context.logger.debug(
        { repository: payload.repository.full_name, expected: this.config.repository },
        'Push from non-target repository, ignoring',
      );
      return {
        statusCode: 200,
        body: { message: 'Push from non-target repository, ignored' },
      };
    }

    // Trigger deployment
    const deploymentId = await this.triggerDeployment(payload);

    return {
      statusCode: 202,
      body: {
        message: 'Deployment triggered',
        deploymentId,
        branch: this.config.branch,
        commit: payload.head_commit?.id ?? 'unknown',
      },
    };
  }

  /**
   * Verify the GitHub webhook signature using HMAC-SHA256.
   */
  private verifySignature(body: string, signature: string): boolean {
    if (!this.config) return false;

    const expectedSignature = `sha256=${createHmac('sha256', this.config.secret)
      .update(body, 'utf-8')
      .digest('hex')}`;

    try {
      const sigBuffer = Buffer.from(signature, 'utf-8');
      const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');

      if (sigBuffer.length !== expectedBuffer.length) {
        return false;
      }

      return timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Trigger a deployment by executing the configured command.
   */
  private async triggerDeployment(payload: GitHubPushPayload): Promise<string> {
    if (!this.config || !this.context) {
      throw new Error('Plugin not initialized');
    }

    this.deploymentCounter++;
    const deploymentId = `deploy-${Date.now()}-${this.deploymentCounter}`;

    const record: DeploymentRecord = {
      id: deploymentId,
      repository: payload.repository.full_name,
      branch: this.config.branch,
      commitId: payload.head_commit?.id ?? 'unknown',
      commitMessage: payload.head_commit?.message ?? 'No commit message',
      author: payload.pusher.name,
      status: 'pending',
      startedAt: new Date().toISOString(),
      completedAt: null,
      output: null,
      error: null,
    };

    // Store the record
    await this.context.storage.set(`deployment:${deploymentId}`, record);
    await this.context.storage.set('deploymentCounter', this.deploymentCounter);

    // Execute deployment in the background
    this.executeDeployment(deploymentId, record).catch((error) => {
      this.context?.logger.error(
        { deploymentId, error },
        'Unhandled error during deployment',
      );
    });

    this.context.logger.info(
      {
        deploymentId,
        repository: payload.repository.full_name,
        branch: this.config.branch,
        commit: payload.head_commit?.id,
      },
      'Deployment triggered',
    );

    // Emit event for other plugins
    this.context.api.emit('github-deploy:triggered', {
      deploymentId,
      repository: payload.repository.full_name,
      branch: this.config.branch,
      commit: payload.head_commit?.id,
    });

    return deploymentId;
  }

  /**
   * Execute the deployment command and update the deployment record.
   */
  private async executeDeployment(
    deploymentId: string,
    record: DeploymentRecord,
  ): Promise<void> {
    if (!this.config || !this.context) return;

    record.status = 'running';
    await this.context.storage.set(`deployment:${deploymentId}`, record);

    try {
      const { stdout, stderr } = await execAsync(this.config.command, {
        cwd: this.config.cwd,
        timeout: 300_000, // 5 minute timeout
        env: {
          ...process.env,
          NOVAPM_DEPLOY_ID: deploymentId,
          NOVAPM_DEPLOY_COMMIT: record.commitId,
          NOVAPM_DEPLOY_BRANCH: record.branch,
          NOVAPM_DEPLOY_REPO: record.repository,
        },
      });

      record.status = 'success';
      record.output = `${stdout}\n${stderr}`.trim();
      record.completedAt = new Date().toISOString();

      this.context.logger.info(
        { deploymentId, duration: record.completedAt },
        'Deployment completed successfully',
      );

      this.context.api.emit('github-deploy:success', {
        deploymentId,
        repository: record.repository,
        commit: record.commitId,
      });
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      record.completedAt = new Date().toISOString();

      this.context.logger.error(
        { deploymentId, error: record.error },
        'Deployment failed',
      );

      this.context.api.emit('github-deploy:failed', {
        deploymentId,
        repository: record.repository,
        commit: record.commitId,
        error: record.error,
      });
    }

    await this.context.storage.set(`deployment:${deploymentId}`, record);
  }

  /**
   * Get recent deployment records from storage.
   */
  private async getDeployments(): Promise<unknown> {
    if (!this.context) {
      return { statusCode: 500, body: { error: 'Plugin not initialized' } };
    }

    const keys = await this.context.storage.list('deployment:deploy-');
    const deployments: DeploymentRecord[] = [];

    for (const key of keys) {
      const record = await this.context.storage.get<DeploymentRecord>(key);
      if (record) {
        deployments.push(record);
      }
    }

    // Sort by startedAt descending
    deployments.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

    return {
      statusCode: 200,
      body: { deployments: deployments.slice(0, 50) },
    };
  }
}

export default new GitHubDeployPlugin();
