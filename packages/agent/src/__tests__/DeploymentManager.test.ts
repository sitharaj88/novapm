import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@novapm/shared', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('node:crypto', () => {
  let counter = 0;
  return {
    randomUUID: () => `deploy-uuid-${++counter}`,
  };
});

import { DeploymentManager } from '../DeploymentManager.js';
import type { Controller } from '../Controller.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockController {
  sendCommand: ReturnType<typeof vi.fn>;
  addDeployment: ReturnType<typeof vi.fn>;
}

function createMockController(commandResults?: Map<string, Map<string, unknown>>): MockController {
  const defaultResults = commandResults ?? new Map();

  return {
    sendCommand: vi.fn(
      async (agentId: string, command: string, _params: unknown, _timeout?: number) => {
        const agentResults = defaultResults.get(agentId);
        if (agentResults && agentResults.has(command)) {
          return agentResults.get(command);
        }
        // Default: deploy succeeds, health check passes
        if (command === 'deploy') return { success: true };
        if (command === 'health.check') return { healthy: true };
        if (command === 'deploy.rollback') return { rolledBack: true };
        if (command === 'traffic.drain') return { drained: true };
        if (command === 'traffic.accept') return { accepting: true };
        return null;
      },
    ),
    addDeployment: vi.fn(),
  };
}

/**
 * Run a deploy action that may include internal delays by starting it
 * as a promise and repeatedly advancing fake timers until it resolves.
 */
async function runWithTimers<T>(action: () => Promise<T>): Promise<T> {
  const promise = action();
  // Advance enough time to cover all possible delays (multiple steps * 5s each)
  for (let i = 0; i < 20; i++) {
    await vi.advanceTimersByTimeAsync(5_100);
  }
  return promise;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeploymentManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---- Construction -------------------------------------------------------

  describe('construction', () => {
    it('should create a DeploymentManager instance', () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);
      expect(dm).toBeInstanceOf(DeploymentManager);
    });
  });

  // ---- Deploy to single server (rolling with 1) --------------------------

  describe('deploy to single server', () => {
    it('should deploy to a single server successfully', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() =>
        dm.rollingDeploy(['server-1'], { app: 'myapp', version: '2.0' }),
      );

      expect(plan.status).toBe('completed');
      expect(plan.strategy).toBe('rolling');
      expect(plan.servers).toEqual(['server-1']);
      expect(plan.errors).toHaveLength(0);
      expect(plan.completedAt).toBeInstanceOf(Date);

      expect(mockCtrl.sendCommand).toHaveBeenCalledWith(
        'server-1',
        'deploy',
        { app: 'myapp', version: '2.0' },
        60_000,
      );
      expect(mockCtrl.sendCommand).toHaveBeenCalledWith('server-1', 'health.check', {}, 60_000);
    });

    it('should fail deployment when deploy command fails', async () => {
      const results = new Map<string, Map<string, unknown>>();
      results.set('server-1', new Map([['deploy', { success: false }]]));

      const mockCtrl = createMockController(results);
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() => dm.rollingDeploy(['server-1'], { app: 'myapp' }));

      expect(plan.status).toBe('failed');
      expect(plan.errors.length).toBeGreaterThan(0);
      expect(plan.errors[0]).toContain('server-1');
    });

    it('should fail deployment when health check fails', async () => {
      const results = new Map<string, Map<string, unknown>>();
      results.set(
        'server-1',
        new Map([
          ['deploy', { success: true }],
          ['health.check', { healthy: false }],
        ]),
      );

      const mockCtrl = createMockController(results);
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() => dm.rollingDeploy(['server-1'], { app: 'myapp' }));

      expect(plan.status).toBe('failed');
      expect(plan.errors.some((e) => e.includes('Health check failed'))).toBe(true);
    });

    it('should fail deployment when sendCommand throws', async () => {
      const mockCtrl = createMockController();
      mockCtrl.sendCommand.mockRejectedValueOnce(new Error('connection lost'));

      const dm = new DeploymentManager(mockCtrl as unknown as Controller);
      const plan = await runWithTimers(() => dm.rollingDeploy(['server-1'], { app: 'myapp' }));

      expect(plan.status).toBe('failed');
    });
  });

  // ---- Rolling deployment -------------------------------------------------

  describe('rolling deployment', () => {
    it('should deploy to multiple servers in sequence', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() =>
        dm.rollingDeploy(['s1', 's2', 's3'], { app: 'myapp' }),
      );

      expect(plan.status).toBe('completed');
      expect(plan.totalSteps).toBe(3);
      expect(plan.servers).toEqual(['s1', 's2', 's3']);

      const deployCallsCount = mockCtrl.sendCommand.mock.calls.filter(
        (c: unknown[]) => c[1] === 'deploy',
      ).length;
      const healthCallsCount = mockCtrl.sendCommand.mock.calls.filter(
        (c: unknown[]) => c[1] === 'health.check',
      ).length;

      expect(deployCallsCount).toBe(3);
      expect(healthCallsCount).toBe(3);
    });

    it('should stop and rollback on failure mid-way through', async () => {
      const results = new Map<string, Map<string, unknown>>();
      results.set('s2', new Map([['deploy', { success: false }]]));

      const mockCtrl = createMockController(results);
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() =>
        dm.rollingDeploy(['s1', 's2', 's3'], { app: 'myapp' }),
      );

      expect(plan.status).toBe('failed');
      expect(plan.errors.some((e) => e.includes('s2'))).toBe(true);

      const rollbackCalls = mockCtrl.sendCommand.mock.calls.filter(
        (c: unknown[]) => c[1] === 'deploy.rollback',
      );
      expect(rollbackCalls.length).toBe(1);
      expect(rollbackCalls[0][0]).toBe('s1');
    });

    it('should rollback all deployed servers when health check fails', async () => {
      const results = new Map<string, Map<string, unknown>>();
      results.set(
        's2',
        new Map([
          ['deploy', { success: true }],
          ['health.check', { healthy: false }],
        ]),
      );

      const mockCtrl = createMockController(results);
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() =>
        dm.rollingDeploy(['s1', 's2', 's3'], { app: 'myapp' }),
      );

      expect(plan.status).toBe('failed');

      const rollbackCalls = mockCtrl.sendCommand.mock.calls.filter(
        (c: unknown[]) => c[1] === 'deploy.rollback',
      );
      expect(rollbackCalls.length).toBe(2);
    });

    it('should record startedAt and completedAt timestamps', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() => dm.rollingDeploy(['s1'], { app: 'myapp' }));

      expect(plan.startedAt).toBeInstanceOf(Date);
      expect(plan.completedAt).toBeInstanceOf(Date);
    });
  });

  // ---- Canary deployment --------------------------------------------------

  describe('canary deployment', () => {
    it('should deploy to canary servers first, then remaining', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const servers = Array.from({ length: 10 }, (_, i) => `s${i + 1}`);
      const plan = await runWithTimers(() => dm.canaryDeploy(servers, { app: 'myapp' }, 10));

      expect(plan.status).toBe('completed');
      expect(plan.strategy).toBe('canary');
      expect(plan.totalSteps).toBe(2);
    });

    it('should use at least 1 canary server even for small percentage', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() => dm.canaryDeploy(['s1', 's2'], { app: 'myapp' }, 1));

      expect(plan.status).toBe('completed');

      const deployCalls = mockCtrl.sendCommand.mock.calls.filter(
        (c: unknown[]) => c[1] === 'deploy',
      );
      expect(deployCalls.length).toBe(2);
    });

    it('should fail and rollback canary if canary deployment fails', async () => {
      const results = new Map<string, Map<string, unknown>>();
      results.set('s1', new Map([['deploy', { success: false }]]));

      const mockCtrl = createMockController(results);
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() =>
        dm.canaryDeploy(['s1', 's2', 's3'], { app: 'myapp' }, 34),
      );

      expect(plan.status).toBe('failed');
      expect(plan.errors.some((e) => e.includes('Canary deployment failed'))).toBe(true);
    });

    it('should fail and rollback canary if canary health check fails', async () => {
      const results = new Map<string, Map<string, unknown>>();
      results.set(
        's1',
        new Map([
          ['deploy', { success: true }],
          ['health.check', { healthy: false }],
        ]),
      );

      const mockCtrl = createMockController(results);
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() =>
        dm.canaryDeploy(['s1', 's2', 's3'], { app: 'myapp' }, 34),
      );

      expect(plan.status).toBe('failed');
      expect(plan.errors.some((e) => e.includes('Canary health check failed'))).toBe(true);
    });

    it('should fail during rollout phase if a remaining server fails', async () => {
      const results = new Map<string, Map<string, unknown>>();
      results.set('s3', new Map([['deploy', { success: false }]]));

      const mockCtrl = createMockController(results);
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() =>
        dm.canaryDeploy(['s1', 's2', 's3'], { app: 'myapp' }, 34),
      );

      expect(plan.status).toBe('failed');
      expect(plan.errors.some((e) => e.includes('during rollout'))).toBe(true);
    });
  });

  // ---- Blue-green deployment ----------------------------------------------

  describe('blue-green deployment', () => {
    it('should deploy to green, health check, then switch traffic', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() =>
        dm.blueGreenDeploy(['blue-1', 'blue-2'], ['green-1', 'green-2'], { app: 'myapp' }),
      );

      expect(plan.status).toBe('completed');
      expect(plan.strategy).toBe('blue-green');
      expect(plan.totalSteps).toBe(3);

      const deployCalls = mockCtrl.sendCommand.mock.calls.filter(
        (c: unknown[]) => c[1] === 'deploy',
      );
      expect(deployCalls.length).toBe(2);

      const drainCalls = mockCtrl.sendCommand.mock.calls.filter(
        (c: unknown[]) => c[1] === 'traffic.drain',
      );
      expect(drainCalls.length).toBe(2);

      const acceptCalls = mockCtrl.sendCommand.mock.calls.filter(
        (c: unknown[]) => c[1] === 'traffic.accept',
      );
      expect(acceptCalls.length).toBe(2);
    });

    it('should fail if green deployment fails', async () => {
      const results = new Map<string, Map<string, unknown>>();
      results.set('green-1', new Map([['deploy', { success: false }]]));

      const mockCtrl = createMockController(results);
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() =>
        dm.blueGreenDeploy(['blue-1'], ['green-1'], { app: 'myapp' }),
      );

      expect(plan.status).toBe('failed');
      expect(plan.errors.some((e) => e.includes('Green deployment failed'))).toBe(true);
    });

    it('should fail if green health check fails', async () => {
      const results = new Map<string, Map<string, unknown>>();
      results.set(
        'green-1',
        new Map([
          ['deploy', { success: true }],
          ['health.check', { healthy: false }],
        ]),
      );

      const mockCtrl = createMockController(results);
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() =>
        dm.blueGreenDeploy(['blue-1'], ['green-1'], { app: 'myapp' }),
      );

      expect(plan.status).toBe('failed');
      expect(plan.errors.some((e) => e.includes('Green health check failed'))).toBe(true);
    });

    it('should handle non-fatal blue drain failure gracefully', async () => {
      const mockCtrl = createMockController();
      mockCtrl.sendCommand.mockImplementation(async (agentId: string, command: string) => {
        if (agentId === 'blue-1' && command === 'traffic.drain') {
          throw new Error('blue drain failed');
        }
        if (command === 'deploy') return { success: true };
        if (command === 'health.check') return { healthy: true };
        if (command === 'traffic.accept') return { accepting: true };
        return null;
      });

      const dm = new DeploymentManager(mockCtrl as unknown as Controller);
      const plan = await runWithTimers(() =>
        dm.blueGreenDeploy(['blue-1'], ['green-1'], { app: 'myapp' }),
      );

      expect(plan.status).toBe('completed');
    });
  });

  // ---- Rollback -----------------------------------------------------------

  describe('rollback', () => {
    it('should rollback a deployment by ID', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      // First create a completed deployment (need timers for delay between steps)
      const plan = await runWithTimers(() => dm.rollingDeploy(['s1', 's2'], { app: 'myapp' }));
      expect(plan.status).toBe('completed');

      // Now rollback
      await dm.rollback(plan.id);

      const rolledBack = dm.getDeployment(plan.id);
      expect(rolledBack).not.toBeNull();
      expect(rolledBack!.status).toBe('rolled-back');

      const rollbackCalls = mockCtrl.sendCommand.mock.calls.filter(
        (c: unknown[]) => c[1] === 'deploy.rollback',
      );
      expect(rollbackCalls.length).toBe(2);
    });

    it('should throw when rolling back nonexistent deployment', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      await expect(dm.rollback('no-such-id')).rejects.toThrow('Deployment not found');
    });

    it('should record rollback errors but not throw', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() => dm.rollingDeploy(['s1'], { app: 'myapp' }));

      // Make rollback command fail
      mockCtrl.sendCommand.mockImplementation(async (_agentId: string, command: string) => {
        if (command === 'deploy.rollback') {
          throw new Error('rollback failed');
        }
        return null;
      });

      await dm.rollback(plan.id);

      const rolledBack = dm.getDeployment(plan.id);
      expect(rolledBack!.status).toBe('rolled-back');
      expect(rolledBack!.errors.some((e) => e.includes('Rollback failed'))).toBe(true);
    });
  });

  // ---- Deployment validation / querying -----------------------------------

  describe('deployment validation and querying', () => {
    it('should store deployment plan on creation', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      const plan = await runWithTimers(() => dm.rollingDeploy(['s1'], { app: 'myapp' }));
      expect(dm.getDeployment(plan.id)).not.toBeNull();
    });

    it('should return null for unknown deployment ID', () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      expect(dm.getDeployment('nonexistent')).toBeNull();
    });

    it('should list all deployments', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      await runWithTimers(() => dm.rollingDeploy(['s1'], { app: 'a' }));
      await runWithTimers(() => dm.rollingDeploy(['s2'], { app: 'b' }));

      expect(dm.getAllDeployments()).toHaveLength(2);
    });

    it('should list only active (in-progress) deployments', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      await runWithTimers(() => dm.rollingDeploy(['s1'], { app: 'a' }));

      expect(dm.getActiveDeployments()).toHaveLength(0);
    });

    it('should register deployment with controller via addDeployment', async () => {
      const mockCtrl = createMockController();
      const dm = new DeploymentManager(mockCtrl as unknown as Controller);

      await runWithTimers(() => dm.rollingDeploy(['s1'], { app: 'myapp' }));

      expect(mockCtrl.addDeployment).toHaveBeenCalledOnce();
    });
  });
});
