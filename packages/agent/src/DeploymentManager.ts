import { randomUUID } from 'node:crypto';
import { createLogger } from '@novapm/shared';

import type { Controller } from './Controller.js';
import type { DeploymentPlan } from './types.js';

const logger = createLogger({ name: 'deployment-manager' });

/** Default timeout for deployment commands (ms). */
const DEPLOY_COMMAND_TIMEOUT = 60_000;

/** Delay between rolling deploy steps (ms). */
const ROLLING_STEP_DELAY = 5_000;

/**
 * Orchestrates multi-server deployments with different strategies.
 * Supports rolling, canary, and blue-green deployment patterns.
 */
export class DeploymentManager {
  private controller: Controller;
  private deployments: Map<string, DeploymentPlan> = new Map();

  constructor(controller: Controller) {
    this.controller = controller;
  }

  /**
   * Execute a rolling deployment: deploy to one server at a time,
   * run a health check after each, and rollback on failure.
   */
  async rollingDeploy(servers: string[], config: Record<string, unknown>): Promise<DeploymentPlan> {
    const plan = this.createPlan('rolling', servers, config);
    plan.totalSteps = servers.length;

    logger.info({ deploymentId: plan.id, servers: servers.length }, 'Starting rolling deployment');

    plan.status = 'in-progress';
    plan.startedAt = new Date();
    this.updatePlan(plan);

    for (let i = 0; i < servers.length; i++) {
      const serverId = servers[i]!;
      plan.currentStep = i + 1;
      this.updatePlan(plan);

      logger.info(
        { deploymentId: plan.id, step: plan.currentStep, serverId },
        'Deploying to server',
      );

      const deployed = await this.deployToServer(serverId, config);

      if (!deployed) {
        plan.errors.push(`Deployment failed on server ${serverId}`);
        plan.status = 'failed';
        plan.completedAt = new Date();
        this.updatePlan(plan);

        logger.error(
          { deploymentId: plan.id, serverId, step: plan.currentStep },
          'Rolling deployment failed, initiating rollback',
        );

        // Rollback servers that were already deployed
        await this.rollbackServers(servers.slice(0, i), plan);

        return plan;
      }

      const healthy = await this.healthCheckServer(serverId);
      if (!healthy) {
        plan.errors.push(`Health check failed on server ${serverId} after deployment`);
        plan.status = 'failed';
        plan.completedAt = new Date();
        this.updatePlan(plan);

        logger.error(
          { deploymentId: plan.id, serverId },
          'Health check failed, initiating rollback',
        );

        await this.rollbackServers(servers.slice(0, i + 1), plan);

        return plan;
      }

      // Brief pause between steps to allow stabilization
      if (i < servers.length - 1) {
        await this.delay(ROLLING_STEP_DELAY);
      }
    }

    plan.status = 'completed';
    plan.completedAt = new Date();
    this.updatePlan(plan);

    logger.info({ deploymentId: plan.id }, 'Rolling deployment completed successfully');
    return plan;
  }

  /**
   * Execute a canary deployment: deploy to a small percentage of servers first,
   * monitor for errors, then gradually roll out to all.
   */
  async canaryDeploy(
    servers: string[],
    config: Record<string, unknown>,
    canaryPercent: number = 10,
  ): Promise<DeploymentPlan> {
    const plan = this.createPlan('canary', servers, config);

    // Calculate canary servers (at least 1)
    const canaryCount = Math.max(1, Math.floor(servers.length * (canaryPercent / 100)));
    const canaryServers = servers.slice(0, canaryCount);
    const remainingServers = servers.slice(canaryCount);

    plan.totalSteps = 2; // Phase 1: canary, Phase 2: remaining
    plan.status = 'in-progress';
    plan.startedAt = new Date();

    logger.info(
      {
        deploymentId: plan.id,
        canaryCount,
        totalServers: servers.length,
        canaryPercent,
      },
      'Starting canary deployment',
    );

    // Phase 1: Deploy to canary servers
    plan.currentStep = 1;
    this.updatePlan(plan);

    for (const serverId of canaryServers) {
      const deployed = await this.deployToServer(serverId, config);
      if (!deployed) {
        plan.errors.push(`Canary deployment failed on server ${serverId}`);
        plan.status = 'failed';
        plan.completedAt = new Date();
        this.updatePlan(plan);

        logger.error({ deploymentId: plan.id, serverId }, 'Canary deployment failed');
        await this.rollbackServers(canaryServers, plan);
        return plan;
      }
    }

    // Health check all canary servers
    for (const serverId of canaryServers) {
      const healthy = await this.healthCheckServer(serverId);
      if (!healthy) {
        plan.errors.push(`Canary health check failed on server ${serverId}`);
        plan.status = 'failed';
        plan.completedAt = new Date();
        this.updatePlan(plan);

        logger.error({ deploymentId: plan.id, serverId }, 'Canary health check failed');
        await this.rollbackServers(canaryServers, plan);
        return plan;
      }
    }

    logger.info(
      { deploymentId: plan.id, canaryCount },
      'Canary phase passed, deploying to remaining servers',
    );

    // Phase 2: Deploy to remaining servers
    plan.currentStep = 2;
    this.updatePlan(plan);

    for (const serverId of remainingServers) {
      const deployed = await this.deployToServer(serverId, config);
      if (!deployed) {
        plan.errors.push(`Deployment failed on server ${serverId} during rollout`);
        plan.status = 'failed';
        plan.completedAt = new Date();
        this.updatePlan(plan);

        logger.error({ deploymentId: plan.id, serverId }, 'Rollout deployment failed');
        return plan;
      }

      const healthy = await this.healthCheckServer(serverId);
      if (!healthy) {
        plan.errors.push(`Health check failed on server ${serverId} during rollout`);
        plan.status = 'failed';
        plan.completedAt = new Date();
        this.updatePlan(plan);

        logger.error({ deploymentId: plan.id, serverId }, 'Rollout health check failed');
        return plan;
      }
    }

    plan.status = 'completed';
    plan.completedAt = new Date();
    this.updatePlan(plan);

    logger.info({ deploymentId: plan.id }, 'Canary deployment completed successfully');
    return plan;
  }

  /**
   * Execute a blue-green deployment: deploy to the green set,
   * health check, then switch traffic.
   */
  async blueGreenDeploy(
    blueServers: string[],
    greenServers: string[],
    config: Record<string, unknown>,
  ): Promise<DeploymentPlan> {
    const allServers = [...blueServers, ...greenServers];
    const plan = this.createPlan('blue-green', allServers, config);

    plan.totalSteps = 3; // Deploy green, health check, switch
    plan.status = 'in-progress';
    plan.startedAt = new Date();

    logger.info(
      {
        deploymentId: plan.id,
        blueCount: blueServers.length,
        greenCount: greenServers.length,
      },
      'Starting blue-green deployment',
    );

    // Step 1: Deploy to green servers
    plan.currentStep = 1;
    this.updatePlan(plan);

    for (const serverId of greenServers) {
      const deployed = await this.deployToServer(serverId, config);
      if (!deployed) {
        plan.errors.push(`Green deployment failed on server ${serverId}`);
        plan.status = 'failed';
        plan.completedAt = new Date();
        this.updatePlan(plan);

        logger.error({ deploymentId: plan.id, serverId }, 'Green deployment failed');
        await this.rollbackServers(greenServers, plan);
        return plan;
      }
    }

    // Step 2: Health check green servers
    plan.currentStep = 2;
    this.updatePlan(plan);

    for (const serverId of greenServers) {
      const healthy = await this.healthCheckServer(serverId);
      if (!healthy) {
        plan.errors.push(`Green health check failed on server ${serverId}`);
        plan.status = 'failed';
        plan.completedAt = new Date();
        this.updatePlan(plan);

        logger.error({ deploymentId: plan.id, serverId }, 'Green health check failed');
        await this.rollbackServers(greenServers, plan);
        return plan;
      }
    }

    // Step 3: Switch traffic (signal blue servers to drain, green to receive)
    plan.currentStep = 3;
    this.updatePlan(plan);

    logger.info({ deploymentId: plan.id }, 'Switching traffic from blue to green');

    // Send switch command to all servers
    for (const serverId of blueServers) {
      try {
        await this.controller.sendCommand(serverId, 'traffic.drain', {}, DEPLOY_COMMAND_TIMEOUT);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn({ serverId, error: errorMsg }, 'Failed to drain blue server (non-fatal)');
      }
    }

    for (const serverId of greenServers) {
      try {
        await this.controller.sendCommand(serverId, 'traffic.accept', {}, DEPLOY_COMMAND_TIMEOUT);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        plan.errors.push(`Failed to activate green server ${serverId}: ${errorMsg}`);
      }
    }

    plan.status = 'completed';
    plan.completedAt = new Date();
    this.updatePlan(plan);

    logger.info({ deploymentId: plan.id }, 'Blue-green deployment completed successfully');
    return plan;
  }

  /**
   * Rollback a deployment by sending rollback commands to all affected servers.
   */
  async rollback(deploymentId: string): Promise<void> {
    const plan = this.deployments.get(deploymentId);
    if (!plan) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    logger.info({ deploymentId }, 'Rolling back deployment');

    await this.rollbackServers(plan.servers, plan);

    plan.status = 'rolled-back';
    plan.completedAt = new Date();
    this.updatePlan(plan);

    logger.info({ deploymentId }, 'Deployment rolled back');
  }

  /**
   * Get a deployment plan by ID.
   */
  getDeployment(id: string): DeploymentPlan | null {
    return this.deployments.get(id) ?? null;
  }

  /**
   * Get all deployments that are currently in progress.
   */
  getActiveDeployments(): DeploymentPlan[] {
    const active: DeploymentPlan[] = [];
    for (const plan of this.deployments.values()) {
      if (plan.status === 'in-progress' || plan.status === 'pending') {
        active.push(plan);
      }
    }
    return active;
  }

  /**
   * Get all deployment plans.
   */
  getAllDeployments(): DeploymentPlan[] {
    return Array.from(this.deployments.values());
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Deploy configuration to a single server via the controller.
   * Returns true on success, false on failure.
   */
  private async deployToServer(agentId: string, config: Record<string, unknown>): Promise<boolean> {
    try {
      const result = await this.controller.sendCommand(
        agentId,
        'deploy',
        config,
        DEPLOY_COMMAND_TIMEOUT,
      );

      const resultObj = result as Record<string, unknown> | null;
      return resultObj !== null && resultObj !== undefined && resultObj['success'] === true;
    } catch (err) {
      logger.error({ err, agentId }, 'Failed to deploy to server');
      return false;
    }
  }

  /**
   * Check if a server is healthy after deployment.
   * Sends a health check command and validates the response.
   */
  private async healthCheckServer(agentId: string): Promise<boolean> {
    try {
      const result = await this.controller.sendCommand(
        agentId,
        'health.check',
        {},
        DEPLOY_COMMAND_TIMEOUT,
      );

      const resultObj = result as Record<string, unknown> | null;
      return resultObj !== null && resultObj !== undefined && resultObj['healthy'] === true;
    } catch (err) {
      logger.error({ err, agentId }, 'Health check failed for server');
      return false;
    }
  }

  /**
   * Send rollback commands to a list of servers.
   */
  private async rollbackServers(servers: string[], plan: DeploymentPlan): Promise<void> {
    for (const serverId of servers) {
      try {
        await this.controller.sendCommand(
          serverId,
          'deploy.rollback',
          { deploymentId: plan.id },
          DEPLOY_COMMAND_TIMEOUT,
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(
          { serverId, deploymentId: plan.id, error: errorMsg },
          'Failed to rollback server',
        );
        plan.errors.push(`Rollback failed on server ${serverId}: ${errorMsg}`);
      }
    }
  }

  /**
   * Create a new deployment plan with the given strategy.
   */
  private createPlan(
    strategy: DeploymentPlan['strategy'],
    servers: string[],
    config: Record<string, unknown>,
  ): DeploymentPlan {
    const plan: DeploymentPlan = {
      id: randomUUID(),
      strategy,
      servers: [...servers],
      config,
      status: 'pending',
      currentStep: 0,
      totalSteps: 0,
      errors: [],
    };

    this.deployments.set(plan.id, plan);
    this.controller.addDeployment(plan);

    return plan;
  }

  /**
   * Update a deployment plan in the local store and the controller.
   */
  private updatePlan(plan: DeploymentPlan): void {
    this.deployments.set(plan.id, plan);
  }

  /**
   * Utility: pause for the given number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
