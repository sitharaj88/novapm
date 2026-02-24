import { readFile, access, constants } from 'node:fs/promises';
import type { NovaPMPlugin, PluginContext } from '@novapm/plugin-sdk';
import type { ProcessEvent, SystemMetrics } from '@novapm/shared';

/**
 * Configuration for the Docker plugin.
 */
interface DockerConfig {
  socketPath?: string;
}

/**
 * Container metadata detected from the Docker environment.
 */
interface ContainerInfo {
  isDocker: boolean;
  containerId: string | null;
  memoryLimitBytes: number | null;
  cpuQuota: number | null;
  cpuPeriod: number | null;
  effectiveCpuLimit: number | null;
}

/**
 * Docker container awareness plugin for NovaPM.
 *
 * Detects if running inside a Docker container, reads container resource
 * limits from cgroup, and enriches process and system information with
 * container metadata.
 */
class DockerPlugin implements NovaPMPlugin {
  readonly name = 'plugin-docker';
  readonly version = '1.0.0';
  readonly description = 'Docker container awareness for NovaPM';
  readonly author = 'NovaPM Team';

  private context: PluginContext | null = null;
  private config: DockerConfig = {};
  private containerInfo: ContainerInfo = {
    isDocker: false,
    containerId: null,
    memoryLimitBytes: null,
    cpuQuota: null,
    cpuPeriod: null,
    effectiveCpuLimit: null,
  };

  async onInit(context: PluginContext): Promise<void> {
    this.context = context;

    const rawConfig = context.config as Record<string, unknown>;
    this.config = {
      socketPath: (rawConfig.socketPath as string | undefined) ?? '/var/run/docker.sock',
    };

    // Detect Docker environment
    await this.detectDocker();

    if (this.containerInfo.isDocker) {
      context.logger.info(
        {
          containerId: this.containerInfo.containerId,
          memoryLimit: this.containerInfo.memoryLimitBytes,
          cpuLimit: this.containerInfo.effectiveCpuLimit,
        },
        'Running inside Docker container',
      );

      // Store container metadata for other plugins to use
      await context.storage.set('containerInfo', this.containerInfo);
    } else {
      context.logger.info('Not running inside a Docker container');
    }
  }

  async onDestroy(): Promise<void> {
    this.context?.logger.info('Docker plugin destroyed');
  }

  async onProcessStart(event: ProcessEvent): Promise<void> {
    if (!this.containerInfo.isDocker) return;

    this.context?.logger.debug(
      {
        processName: event.processName,
        containerId: this.containerInfo.containerId,
      },
      'Process started inside Docker container',
    );

    // Store container-aware process metadata
    await this.context?.storage.set(`process:${event.processId}:container`, {
      containerId: this.containerInfo.containerId,
      memoryLimitBytes: this.containerInfo.memoryLimitBytes,
      effectiveCpuLimit: this.containerInfo.effectiveCpuLimit,
      startedAt: event.timestamp.toISOString(),
    });
  }

  async onSystemMetrics(metrics: SystemMetrics): Promise<void> {
    if (!this.containerInfo.isDocker || !this.context) return;

    // When running in Docker, effective resources may differ from host values.
    // Store the container-adjusted metrics alongside.
    const containerMetrics: Record<string, unknown> = {
      hostname: metrics.hostname,
      reportedMemoryTotal: metrics.memoryTotal,
      reportedMemoryUsed: metrics.memoryUsed,
      reportedCpuUsage: metrics.cpuUsage,
      containerMemoryLimit: this.containerInfo.memoryLimitBytes,
      containerCpuLimit: this.containerInfo.effectiveCpuLimit,
      timestamp: metrics.timestamp.toISOString(),
    };

    // If we know the memory limit, calculate container-relative usage
    if (this.containerInfo.memoryLimitBytes !== null) {
      const containerMemoryUsagePercent =
        (metrics.memoryUsed / this.containerInfo.memoryLimitBytes) * 100;
      containerMetrics.containerMemoryUsagePercent = Math.min(containerMemoryUsagePercent, 100);
    }

    await this.context.storage.set('latestContainerMetrics', containerMetrics);
  }

  /**
   * Detect if we are running inside a Docker container.
   * Uses multiple detection strategies:
   * 1. Check for /.dockerenv file
   * 2. Check /proc/1/cgroup for docker references
   * 3. Check /proc/self/mountinfo for docker references
   */
  private async detectDocker(): Promise<void> {
    // Strategy 1: Check for /.dockerenv
    const hasDockerEnv = await this.fileExists('/.dockerenv');
    if (hasDockerEnv) {
      this.containerInfo.isDocker = true;
    }

    // Strategy 2: Check cgroup for docker references
    if (!this.containerInfo.isDocker) {
      try {
        const cgroupContent = await readFile('/proc/1/cgroup', 'utf-8');
        if (cgroupContent.includes('docker') || cgroupContent.includes('containerd')) {
          this.containerInfo.isDocker = true;
        }
      } catch {
        // Not on Linux or file not accessible
      }
    }

    // Strategy 3: Check /proc/self/mountinfo
    if (!this.containerInfo.isDocker) {
      try {
        const mountInfo = await readFile('/proc/self/mountinfo', 'utf-8');
        if (mountInfo.includes('docker') || mountInfo.includes('containerd')) {
          this.containerInfo.isDocker = true;
        }
      } catch {
        // Not on Linux or file not accessible
      }
    }

    if (this.containerInfo.isDocker) {
      await this.readContainerId();
      await this.readResourceLimits();
    }
  }

  /**
   * Read the container ID from /proc/self/cgroup or hostname.
   */
  private async readContainerId(): Promise<void> {
    // Try to get container ID from cgroup
    try {
      const cgroupContent = await readFile('/proc/self/cgroup', 'utf-8');
      const lines = cgroupContent.split('\n');
      for (const line of lines) {
        // Match Docker container IDs (64-char hex strings)
        const match = /[a-f0-9]{64}/.exec(line);
        if (match) {
          this.containerInfo.containerId = match[0];
          return;
        }
      }
    } catch {
      // Ignore errors
    }

    // Try /proc/self/mountinfo for container ID
    try {
      const mountInfo = await readFile('/proc/self/mountinfo', 'utf-8');
      const match = /[a-f0-9]{64}/.exec(mountInfo);
      if (match) {
        this.containerInfo.containerId = match[0];
        return;
      }
    } catch {
      // Ignore errors
    }

    // Fallback: use hostname (Docker sets hostname to container short ID by default)
    const { hostname } = await import('node:os');
    const hn = hostname();
    if (/^[a-f0-9]{12}$/.test(hn)) {
      this.containerInfo.containerId = hn;
    }
  }

  /**
   * Read container resource limits from cgroup v1 and v2.
   */
  private async readResourceLimits(): Promise<void> {
    await this.readMemoryLimit();
    await this.readCpuLimit();
  }

  /**
   * Read memory limit from cgroup.
   */
  private async readMemoryLimit(): Promise<void> {
    // cgroup v2
    try {
      const content = await readFile('/sys/fs/cgroup/memory.max', 'utf-8');
      const trimmed = content.trim();
      if (trimmed !== 'max') {
        this.containerInfo.memoryLimitBytes = parseInt(trimmed, 10);
        return;
      }
    } catch {
      // Try cgroup v1
    }

    // cgroup v1
    try {
      const content = await readFile(
        '/sys/fs/cgroup/memory/memory.limit_in_bytes',
        'utf-8',
      );
      const limit = parseInt(content.trim(), 10);
      // Very large values indicate no limit is set
      if (limit < 9_000_000_000_000_000_000) {
        this.containerInfo.memoryLimitBytes = limit;
      }
    } catch {
      // No memory limit readable
    }
  }

  /**
   * Read CPU limit from cgroup.
   */
  private async readCpuLimit(): Promise<void> {
    // cgroup v2
    try {
      const content = await readFile('/sys/fs/cgroup/cpu.max', 'utf-8');
      const parts = content.trim().split(' ');
      if (parts.length === 2 && parts[0] !== 'max') {
        this.containerInfo.cpuQuota = parseInt(parts[0], 10);
        this.containerInfo.cpuPeriod = parseInt(parts[1], 10);
        if (this.containerInfo.cpuPeriod > 0) {
          this.containerInfo.effectiveCpuLimit =
            this.containerInfo.cpuQuota / this.containerInfo.cpuPeriod;
        }
        return;
      }
    } catch {
      // Try cgroup v1
    }

    // cgroup v1
    try {
      const quotaContent = await readFile(
        '/sys/fs/cgroup/cpu/cpu.cfs_quota_us',
        'utf-8',
      );
      const periodContent = await readFile(
        '/sys/fs/cgroup/cpu/cpu.cfs_period_us',
        'utf-8',
      );

      const quota = parseInt(quotaContent.trim(), 10);
      const period = parseInt(periodContent.trim(), 10);

      if (quota > 0 && period > 0) {
        this.containerInfo.cpuQuota = quota;
        this.containerInfo.cpuPeriod = period;
        this.containerInfo.effectiveCpuLimit = quota / period;
      }
    } catch {
      // No CPU limit readable
    }
  }

  /**
   * Check if a file exists and is accessible.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export default new DockerPlugin();
