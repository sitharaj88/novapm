import { describe, it, expect } from 'vitest';
import {
  appConfigSchema,
  novaConfigSchema,
  healthCheckSchema,
  scalingSchema,
  deploySchema,
  logConfigSchema,
  serverConfigSchema,
  pluginConfigSchema,
  aiConfigSchema,
  dashboardConfigSchema,
} from '../schemas/config.schema.js';

describe('healthCheckSchema', () => {
  it('should accept a valid HTTP health check', () => {
    const result = healthCheckSchema.safeParse({
      type: 'http',
      path: '/health',
      port: 3000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interval).toBe('30s');
      expect(result.data.timeout).toBe('5s');
      expect(result.data.retries).toBe(3);
    }
  });

  it('should accept a valid TCP health check', () => {
    const result = healthCheckSchema.safeParse({
      type: 'tcp',
      host: 'localhost',
      port: 5432,
      interval: '10s',
      timeout: '2s',
      retries: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('tcp');
      expect(result.data.retries).toBe(5);
    }
  });

  it('should accept a valid script health check', () => {
    const result = healthCheckSchema.safeParse({
      type: 'script',
      script: './health-check.sh',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an invalid health check type', () => {
    const result = healthCheckSchema.safeParse({
      type: 'grpc',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a negative port', () => {
    const result = healthCheckSchema.safeParse({
      type: 'tcp',
      port: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject zero port', () => {
    const result = healthCheckSchema.safeParse({
      type: 'tcp',
      port: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject a non-integer port', () => {
    const result = healthCheckSchema.safeParse({
      type: 'tcp',
      port: 3.5,
    });
    expect(result.success).toBe(false);
  });

  it('should reject retries less than 1', () => {
    const result = healthCheckSchema.safeParse({
      type: 'http',
      retries: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should apply default values for interval, timeout, and retries', () => {
    const result = healthCheckSchema.safeParse({ type: 'http' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interval).toBe('30s');
      expect(result.data.timeout).toBe('5s');
      expect(result.data.retries).toBe(3);
    }
  });

  it('should reject missing type field', () => {
    const result = healthCheckSchema.safeParse({
      path: '/health',
      port: 3000,
    });
    expect(result.success).toBe(false);
  });
});

describe('scalingSchema', () => {
  it('should accept a valid scaling config', () => {
    const result = scalingSchema.safeParse({
      min: 1,
      max: 10,
      cpu_threshold: 80,
      memory_threshold: 90,
    });
    expect(result.success).toBe(true);
  });

  it('should require min and max', () => {
    expect(scalingSchema.safeParse({ min: 1 }).success).toBe(false);
    expect(scalingSchema.safeParse({ max: 10 }).success).toBe(false);
    expect(scalingSchema.safeParse({}).success).toBe(false);
  });

  it('should reject min less than 1', () => {
    const result = scalingSchema.safeParse({ min: 0, max: 5 });
    expect(result.success).toBe(false);
  });

  it('should reject max less than 1', () => {
    const result = scalingSchema.safeParse({ min: 1, max: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject cpu_threshold above 100', () => {
    const result = scalingSchema.safeParse({
      min: 1,
      max: 5,
      cpu_threshold: 101,
    });
    expect(result.success).toBe(false);
  });

  it('should reject cpu_threshold below 0', () => {
    const result = scalingSchema.safeParse({
      min: 1,
      max: 5,
      cpu_threshold: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject memory_threshold above 100', () => {
    const result = scalingSchema.safeParse({
      min: 1,
      max: 5,
      memory_threshold: 150,
    });
    expect(result.success).toBe(false);
  });

  it('should accept boundary values for thresholds (0 and 100)', () => {
    const result = scalingSchema.safeParse({
      min: 1,
      max: 5,
      cpu_threshold: 0,
      memory_threshold: 100,
    });
    expect(result.success).toBe(true);
  });

  it('should reject negative request_threshold', () => {
    const result = scalingSchema.safeParse({
      min: 1,
      max: 5,
      request_threshold: -10,
    });
    expect(result.success).toBe(false);
  });

  it('should reject zero request_threshold', () => {
    const result = scalingSchema.safeParse({
      min: 1,
      max: 5,
      request_threshold: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer min', () => {
    const result = scalingSchema.safeParse({ min: 1.5, max: 5 });
    expect(result.success).toBe(false);
  });

  it('should accept all optional fields', () => {
    const result = scalingSchema.safeParse({
      min: 2,
      max: 20,
      ai_enabled: true,
      cpu_threshold: 75,
      memory_threshold: 85,
      request_threshold: 1000,
      cooldown: '5m',
      scale_up_step: 2,
      scale_down_step: 1,
    });
    expect(result.success).toBe(true);
  });
});

describe('deploySchema', () => {
  it('should accept a valid rolling deploy config', () => {
    const result = deploySchema.safeParse({
      strategy: 'rolling',
      max_unavailable: 1,
    });
    expect(result.success).toBe(true);
  });

  it('should accept a valid canary deploy config', () => {
    const result = deploySchema.safeParse({
      strategy: 'canary',
      canary_weight: 10,
    });
    expect(result.success).toBe(true);
  });

  it('should accept a valid blue-green deploy config', () => {
    const result = deploySchema.safeParse({
      strategy: 'blue-green',
      health_check_timeout: '30s',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an invalid deploy strategy', () => {
    const result = deploySchema.safeParse({
      strategy: 'recreate',
    });
    expect(result.success).toBe(false);
  });

  it('should require strategy field', () => {
    const result = deploySchema.safeParse({
      max_unavailable: 1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject canary_weight above 100', () => {
    const result = deploySchema.safeParse({
      strategy: 'canary',
      canary_weight: 101,
    });
    expect(result.success).toBe(false);
  });

  it('should reject canary_weight below 0', () => {
    const result = deploySchema.safeParse({
      strategy: 'canary',
      canary_weight: -5,
    });
    expect(result.success).toBe(false);
  });

  it('should accept canary_weight boundary values (0 and 100)', () => {
    expect(deploySchema.safeParse({ strategy: 'canary', canary_weight: 0 }).success).toBe(true);
    expect(deploySchema.safeParse({ strategy: 'canary', canary_weight: 100 }).success).toBe(true);
  });
});

describe('logConfigSchema', () => {
  it('should accept a valid text log config with defaults', () => {
    const result = logConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe('text');
    }
  });

  it('should accept a valid json log config', () => {
    const result = logConfigSchema.safeParse({
      format: 'json',
      out_file: '/var/log/app.log',
      error_file: '/var/log/app-error.log',
      timestamp: true,
    });
    expect(result.success).toBe(true);
  });

  it('should reject an invalid format', () => {
    const result = logConfigSchema.safeParse({ format: 'xml' });
    expect(result.success).toBe(false);
  });

  it('should accept a valid rotation config with defaults', () => {
    const result = logConfigSchema.safeParse({
      rotate: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rotate?.size).toBe('100M');
      expect(result.data.rotate?.keep).toBe(10);
    }
  });

  it('should accept a full rotation config', () => {
    const result = logConfigSchema.safeParse({
      rotate: {
        size: '50M',
        keep: 5,
        compress: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it('should reject non-positive keep value in rotation', () => {
    const result = logConfigSchema.safeParse({
      rotate: {
        size: '100M',
        keep: 0,
      },
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer keep value in rotation', () => {
    const result = logConfigSchema.safeParse({
      rotate: {
        size: '100M',
        keep: 3.5,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('appConfigSchema', () => {
  it('should accept a minimal valid app config', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
    });
    expect(result.success).toBe(true);
  });

  it('should accept a fully populated app config', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'dist/server.js',
      cwd: '/home/app',
      args: ['--port', '3000'],
      interpreter: 'node',
      interpreterArgs: ['--max-old-space-size=4096'],
      instances: 4,
      exec_mode: 'cluster',
      port: 3000,
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      env_staging: { NODE_ENV: 'staging' },
      max_memory_restart: '1G',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
      exp_backoff_restart_delay: 100,
      watch: ['src'],
      ignore_watch: ['node_modules'],
      kill_timeout: 3000,
      listen_timeout: 5000,
      health_check: {
        type: 'http',
        path: '/health',
        port: 3000,
      },
      scaling: {
        min: 1,
        max: 8,
      },
      deploy: {
        strategy: 'rolling',
      },
      logs: {
        format: 'json',
      },
      cron_restart: '0 0 * * *',
      source_map_support: true,
      node_args: '--inspect',
      merge_logs: true,
    });
    expect(result.success).toBe(true);
  });

  it('should require name field', () => {
    const result = appConfigSchema.safeParse({
      script: 'index.js',
    });
    expect(result.success).toBe(false);
  });

  it('should require script field', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty name', () => {
    const result = appConfigSchema.safeParse({
      name: '',
      script: 'index.js',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty script', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject name longer than 100 characters', () => {
    const result = appConfigSchema.safeParse({
      name: 'a'.repeat(101),
      script: 'index.js',
    });
    expect(result.success).toBe(false);
  });

  it('should accept name with exactly 100 characters', () => {
    const result = appConfigSchema.safeParse({
      name: 'a'.repeat(100),
      script: 'index.js',
    });
    expect(result.success).toBe(true);
  });

  it('should accept args as a string', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      args: '--port 3000',
    });
    expect(result.success).toBe(true);
  });

  it('should accept args as an array of strings', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      args: ['--port', '3000'],
    });
    expect(result.success).toBe(true);
  });

  it('should accept instances as a number', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      instances: 4,
    });
    expect(result.success).toBe(true);
  });

  it('should accept instances as "max"', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      instances: 'max',
    });
    expect(result.success).toBe(true);
  });

  it('should accept instances as "auto"', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      instances: 'auto',
    });
    expect(result.success).toBe(true);
  });

  it('should reject instances with invalid string value', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      instances: 'all',
    });
    expect(result.success).toBe(false);
  });

  it('should reject instances as zero', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      instances: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative instances', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      instances: -2,
    });
    expect(result.success).toBe(false);
  });

  it('should accept exec_mode as fork or cluster', () => {
    expect(appConfigSchema.safeParse({ name: 'a', script: 'b', exec_mode: 'fork' }).success).toBe(
      true,
    );
    expect(
      appConfigSchema.safeParse({ name: 'a', script: 'b', exec_mode: 'cluster' }).success,
    ).toBe(true);
  });

  it('should reject invalid exec_mode', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      exec_mode: 'worker',
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative max_restarts', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      max_restarts: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should accept zero max_restarts (disable restarts)', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      max_restarts: 0,
    });
    expect(result.success).toBe(true);
  });

  it('should reject zero kill_timeout', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      kill_timeout: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should accept watch as boolean', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      watch: true,
    });
    expect(result.success).toBe(true);
  });

  it('should accept watch as array of strings', () => {
    const result = appConfigSchema.safeParse({
      name: 'my-app',
      script: 'index.js',
      watch: ['src', 'config'],
    });
    expect(result.success).toBe(true);
  });

  it('should accept node_args as string or array', () => {
    expect(
      appConfigSchema.safeParse({
        name: 'a',
        script: 'b',
        node_args: '--inspect',
      }).success,
    ).toBe(true);
    expect(
      appConfigSchema.safeParse({
        name: 'a',
        script: 'b',
        node_args: ['--inspect', '--max-old-space-size=4096'],
      }).success,
    ).toBe(true);
  });

  it('should reject non-positive port', () => {
    expect(appConfigSchema.safeParse({ name: 'a', script: 'b', port: 0 }).success).toBe(false);
    expect(appConfigSchema.safeParse({ name: 'a', script: 'b', port: -1 }).success).toBe(false);
  });

  it('should reject non-integer port', () => {
    const result = appConfigSchema.safeParse({
      name: 'a',
      script: 'b',
      port: 3000.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('serverConfigSchema', () => {
  it('should accept a valid server config with groups', () => {
    const result = serverConfigSchema.safeParse({
      groups: {
        production: ['server1.example.com', 'server2.example.com'],
        staging: ['staging1.example.com'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('should require groups field', () => {
    const result = serverConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept auth with key type', () => {
    const result = serverConfigSchema.safeParse({
      groups: { prod: ['s1'] },
      auth: {
        type: 'key',
        key_path: '~/.ssh/id_rsa',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept auth with token type', () => {
    const result = serverConfigSchema.safeParse({
      groups: { prod: ['s1'] },
      auth: {
        type: 'token',
        token: 'my-secret-token',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid auth type', () => {
    const result = serverConfigSchema.safeParse({
      groups: { prod: ['s1'] },
      auth: {
        type: 'password',
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('pluginConfigSchema', () => {
  it('should accept a valid plugin config', () => {
    const result = pluginConfigSchema.safeParse({
      name: 'my-plugin',
      options: { key: 'value' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept a plugin config without options', () => {
    const result = pluginConfigSchema.safeParse({
      name: 'my-plugin',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty plugin name', () => {
    const result = pluginConfigSchema.safeParse({
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing name', () => {
    const result = pluginConfigSchema.safeParse({
      options: { key: 'value' },
    });
    expect(result.success).toBe(false);
  });

  it('should accept options with mixed value types', () => {
    const result = pluginConfigSchema.safeParse({
      name: 'my-plugin',
      options: {
        port: 3000,
        verbose: true,
        label: 'test',
        nested: { key: 'val' },
        list: [1, 2, 3],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('aiConfigSchema', () => {
  it('should accept a minimal AI config', () => {
    const result = aiConfigSchema.safeParse({
      enabled: false,
    });
    expect(result.success).toBe(true);
  });

  it('should accept a fully populated AI config', () => {
    const result = aiConfigSchema.safeParse({
      enabled: true,
      provider: 'openai',
      api_key: 'sk-test',
      model: 'gpt-4',
      anomaly_detection: true,
      auto_scaling: true,
      natural_language: true,
      log_analysis: true,
    });
    expect(result.success).toBe(true);
  });

  it('should require enabled field', () => {
    const result = aiConfigSchema.safeParse({
      provider: 'openai',
    });
    expect(result.success).toBe(false);
  });

  it('should accept valid providers', () => {
    for (const provider of ['openai', 'anthropic', 'local']) {
      const result = aiConfigSchema.safeParse({
        enabled: true,
        provider,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid provider', () => {
    const result = aiConfigSchema.safeParse({
      enabled: true,
      provider: 'google',
    });
    expect(result.success).toBe(false);
  });
});

describe('dashboardConfigSchema', () => {
  it('should accept an empty dashboard config', () => {
    const result = dashboardConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept a fully populated dashboard config', () => {
    const result = dashboardConfigSchema.safeParse({
      enabled: true,
      port: 9615,
      host: '0.0.0.0',
      auth: {
        type: 'jwt',
        secret: 'my-secret',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept all auth types', () => {
    for (const type of ['none', 'basic', 'jwt']) {
      const result = dashboardConfigSchema.safeParse({
        auth: { type },
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid auth type', () => {
    const result = dashboardConfigSchema.safeParse({
      auth: { type: 'oauth' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-positive port', () => {
    const result = dashboardConfigSchema.safeParse({ port: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer port', () => {
    const result = dashboardConfigSchema.safeParse({ port: 80.5 });
    expect(result.success).toBe(false);
  });
});

describe('novaConfigSchema', () => {
  it('should accept a minimal valid config', () => {
    const result = novaConfigSchema.safeParse({
      apps: [{ name: 'my-app', script: 'index.js' }],
    });
    expect(result.success).toBe(true);
  });

  it('should accept a config with multiple apps', () => {
    const result = novaConfigSchema.safeParse({
      apps: [
        { name: 'web', script: 'server.js', instances: 4, exec_mode: 'cluster' },
        { name: 'worker', script: 'worker.js' },
        { name: 'cron', script: 'cron.js', cron_restart: '0 0 * * *' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should accept a fully populated config', () => {
    const result = novaConfigSchema.safeParse({
      apps: [{ name: 'my-app', script: 'index.js' }],
      servers: {
        groups: { production: ['s1.example.com'] },
      },
      plugins: [{ name: 'slack-notifier' }],
      ai: { enabled: false },
      dashboard: { enabled: true, port: 9615 },
    });
    expect(result.success).toBe(true);
  });

  it('should require at least one app', () => {
    const result = novaConfigSchema.safeParse({
      apps: [],
    });
    expect(result.success).toBe(false);
  });

  it('should require apps field', () => {
    const result = novaConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject apps as a non-array', () => {
    const result = novaConfigSchema.safeParse({
      apps: { name: 'my-app', script: 'index.js' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject when an app in the array is invalid', () => {
    const result = novaConfigSchema.safeParse({
      apps: [
        { name: 'valid-app', script: 'index.js' },
        { name: '', script: 'index.js' }, // invalid: empty name
      ],
    });
    expect(result.success).toBe(false);
  });

  it('should allow optional top-level fields to be omitted', () => {
    const result = novaConfigSchema.safeParse({
      apps: [{ name: 'app', script: 'main.js' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.servers).toBeUndefined();
      expect(result.data.plugins).toBeUndefined();
      expect(result.data.ai).toBeUndefined();
      expect(result.data.dashboard).toBeUndefined();
    }
  });

  it('should reject unknown top-level fields when using strict parsing', () => {
    const result = novaConfigSchema.strict().safeParse({
      apps: [{ name: 'app', script: 'main.js' }],
      unknownField: 'should fail',
    });
    expect(result.success).toBe(false);
  });
});
