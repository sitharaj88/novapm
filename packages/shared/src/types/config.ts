export interface NovaConfig {
  apps: AppConfig[];
  servers?: ServerConfig;
  plugins?: PluginConfig[];
  ai?: AIConfig;
  dashboard?: DashboardConfig;
}

export interface AppConfig {
  name: string;
  script: string;
  cwd?: string;
  args?: string | string[];
  interpreter?: string;
  interpreterArgs?: string[];
  instances?: number | 'max' | 'auto';
  exec_mode?: 'fork' | 'cluster';
  port?: number;
  env?: Record<string, string>;
  env_production?: Record<string, string>;
  env_staging?: Record<string, string>;
  max_memory_restart?: string;
  autorestart?: boolean;
  max_restarts?: number;
  restart_delay?: number;
  exp_backoff_restart_delay?: number;
  watch?: boolean | string[];
  ignore_watch?: string[];
  kill_timeout?: number;
  listen_timeout?: number;
  health_check?: HealthCheckConfig;
  scaling?: ScalingConfig;
  deploy?: DeployConfig;
  logs?: LogConfig;
  cron_restart?: string;
  source_map_support?: boolean;
  node_args?: string | string[];
  merge_logs?: boolean;
}

export interface HealthCheckConfig {
  type: 'http' | 'tcp' | 'script';
  path?: string;
  host?: string;
  port?: number;
  script?: string;
  interval: string;
  timeout: string;
  retries: number;
  start_period?: string;
}

export interface ScalingConfig {
  min: number;
  max: number;
  ai_enabled?: boolean;
  cpu_threshold?: number;
  memory_threshold?: number;
  request_threshold?: number;
  cooldown?: string;
  scale_up_step?: number;
  scale_down_step?: number;
}

export interface DeployConfig {
  strategy: 'rolling' | 'canary' | 'blue-green';
  max_unavailable?: number;
  canary_weight?: number;
  health_check_timeout?: string;
}

export interface LogConfig {
  format: 'text' | 'json';
  out_file?: string;
  error_file?: string;
  rotate?: {
    size: string;
    keep: number;
    compress?: boolean;
  };
  timestamp?: boolean;
}

export interface ServerConfig {
  groups: Record<string, string[]>;
  auth?: {
    type: 'key' | 'token';
    key_path?: string;
    token?: string;
  };
}

export interface PluginConfig {
  name: string;
  options?: Record<string, unknown>;
}

export interface AIConfig {
  enabled: boolean;
  provider?: 'openai' | 'anthropic' | 'local';
  api_key?: string;
  model?: string;
  anomaly_detection?: boolean;
  auto_scaling?: boolean;
  natural_language?: boolean;
  log_analysis?: boolean;
}

export interface DashboardConfig {
  enabled?: boolean;
  port?: number;
  host?: string;
  auth?: {
    type: 'none' | 'basic' | 'jwt';
    username?: string;
    password?: string;
    secret?: string;
  };
}
