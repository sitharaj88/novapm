export default {
  apps: [
    {
      name: 'api-gateway',
      script: './services/gateway.js',
      instances: 'max',
      exec_mode: 'cluster',
      port: 3000,
      autorestart: true,
      max_restarts: 16,
      restart_delay: 1000,
      max_memory_restart: '512M',
      watch: false,
      env: {
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
        rotate: { size: '100M', keep: 10, compress: true },
      },
    },
    {
      name: 'auth-service',
      script: './services/auth.js',
      instances: 2,
      exec_mode: 'cluster',
      port: 3001,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
    },
    {
      name: 'user-service',
      script: './services/user.js',
      instances: 2,
      exec_mode: 'cluster',
      port: 3002,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3002',
      },
    },
    {
      name: 'worker-queue',
      script: './services/worker.js',
      instances: 4,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'cron-scheduler',
      script: './services/cron.js',
      instances: 1,
      exec_mode: 'fork',
      cron_restart: '0 0 * * *',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
  dashboard: {
    enabled: true,
    port: 9615,
  },
  ai: {
    enabled: true,
    anomaly_detection: true,
    auto_scaling: true,
  },
  plugins: [
    { name: '@novapm/plugin-slack', options: { webhookUrl: process.env.SLACK_WEBHOOK } },
    { name: '@novapm/plugin-prometheus' },
  ],
};
