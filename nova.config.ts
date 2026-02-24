import type { NovaConfig } from '@novapm/shared';

const config: NovaConfig = {
  apps: [
    {
      name: 'api-server',
      script: './examples/basic/app.js',
      instances: 2,
      exec_mode: 'cluster',
      port: 3000,
      autorestart: true,
      max_restarts: 16,
      restart_delay: 1000,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        PORT: '3000',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      health_check: {
        type: 'http',
        path: '/health',
        port: 3000,
        interval: '30s',
        timeout: '5s',
        retries: 3,
      },
      logs: {
        format: 'json',
        rotate: {
          size: '100M',
          keep: 10,
          compress: true,
        },
      },
    },
  ],
  dashboard: {
    enabled: true,
    port: 9615,
  },
  ai: {
    enabled: false,
    anomaly_detection: true,
    auto_scaling: false,
  },
};

export default config;
