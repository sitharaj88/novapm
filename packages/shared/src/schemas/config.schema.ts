import { z } from 'zod';

export const healthCheckSchema = z.object({
  type: z.enum(['http', 'tcp', 'script']),
  path: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  script: z.string().optional(),
  interval: z.string().default('30s'),
  timeout: z.string().default('5s'),
  retries: z.number().int().min(1).default(3),
  start_period: z.string().optional(),
});

export const scalingSchema = z.object({
  min: z.number().int().min(1),
  max: z.number().int().min(1),
  ai_enabled: z.boolean().optional(),
  cpu_threshold: z.number().min(0).max(100).optional(),
  memory_threshold: z.number().min(0).max(100).optional(),
  request_threshold: z.number().positive().optional(),
  cooldown: z.string().optional(),
  scale_up_step: z.number().int().positive().optional(),
  scale_down_step: z.number().int().positive().optional(),
});

export const deploySchema = z.object({
  strategy: z.enum(['rolling', 'canary', 'blue-green']),
  max_unavailable: z.number().int().positive().optional(),
  canary_weight: z.number().min(0).max(100).optional(),
  health_check_timeout: z.string().optional(),
});

export const logConfigSchema = z.object({
  format: z.enum(['text', 'json']).default('text'),
  out_file: z.string().optional(),
  error_file: z.string().optional(),
  rotate: z
    .object({
      size: z.string().default('100M'),
      keep: z.number().int().positive().default(10),
      compress: z.boolean().optional(),
    })
    .optional(),
  timestamp: z.boolean().optional(),
});

export const appConfigSchema = z.object({
  name: z.string().min(1).max(100),
  script: z.string().min(1),
  cwd: z.string().optional(),
  args: z.union([z.string(), z.array(z.string())]).optional(),
  interpreter: z.string().optional(),
  interpreterArgs: z.union([z.string(), z.array(z.string())]).optional(),
  instances: z.union([z.number().int().positive(), z.literal('max'), z.literal('auto')]).optional(),
  exec_mode: z.enum(['fork', 'cluster']).optional(),
  port: z.number().int().positive().optional(),
  env: z.record(z.string()).optional(),
  env_production: z.record(z.string()).optional(),
  env_staging: z.record(z.string()).optional(),
  max_memory_restart: z.string().optional(),
  autorestart: z.boolean().optional(),
  max_restarts: z.number().int().min(0).optional(),
  restart_delay: z.number().int().min(0).optional(),
  exp_backoff_restart_delay: z.number().int().min(0).optional(),
  watch: z.union([z.boolean(), z.array(z.string())]).optional(),
  ignore_watch: z.array(z.string()).optional(),
  kill_timeout: z.number().int().positive().optional(),
  listen_timeout: z.number().int().positive().optional(),
  health_check: healthCheckSchema.optional(),
  scaling: scalingSchema.optional(),
  deploy: deploySchema.optional(),
  logs: logConfigSchema.optional(),
  cron_restart: z.string().optional(),
  source_map_support: z.boolean().optional(),
  node_args: z.union([z.string(), z.array(z.string())]).optional(),
  merge_logs: z.boolean().optional(),
});

export const serverConfigSchema = z.object({
  groups: z.record(z.array(z.string())),
  auth: z
    .object({
      type: z.enum(['key', 'token']),
      key_path: z.string().optional(),
      token: z.string().optional(),
    })
    .optional(),
});

export const pluginConfigSchema = z.object({
  name: z.string().min(1),
  options: z.record(z.unknown()).optional(),
});

export const aiConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['openai', 'anthropic', 'local']).optional(),
  api_key: z.string().optional(),
  model: z.string().optional(),
  anomaly_detection: z.boolean().optional(),
  auto_scaling: z.boolean().optional(),
  natural_language: z.boolean().optional(),
  log_analysis: z.boolean().optional(),
});

export const dashboardConfigSchema = z.object({
  enabled: z.boolean().optional(),
  port: z.number().int().positive().optional(),
  host: z.string().optional(),
  auth: z
    .object({
      type: z.enum(['none', 'basic', 'jwt']),
      username: z.string().optional(),
      password: z.string().optional(),
      secret: z.string().optional(),
    })
    .optional(),
});

export const novaConfigSchema = z.object({
  apps: z.array(appConfigSchema).min(1),
  servers: serverConfigSchema.optional(),
  plugins: z.array(pluginConfigSchema).optional(),
  ai: aiConfigSchema.optional(),
  dashboard: dashboardConfigSchema.optional(),
});

export type ValidatedAppConfig = z.infer<typeof appConfigSchema>;
export type ValidatedNovaConfig = z.infer<typeof novaConfigSchema>;
