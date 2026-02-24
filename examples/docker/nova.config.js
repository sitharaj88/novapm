/**
 * NovaPM configuration optimised for running inside a Docker container.
 *
 * Key decisions:
 *  - exec_mode is "cluster" so NovaPM can manage worker processes and perform
 *    zero-downtime reloads.
 *  - instances is set to the number of available CPUs (via "max"). Inside a
 *    container this respects the cgroup CPU limit.
 *  - watch is disabled; in production containers the filesystem is immutable.
 *  - Health checks are configured so NovaPM can restart unhealthy workers
 *    independently from the container orchestrator's own health checks.
 */
export default {
  apps: [
    {
      name: 'docker-app',
      script: './app.js',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      max_restarts: 15,
      restart_delay: 1000,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '512M',
      kill_timeout: 5000,
      listen_timeout: 10000,
      merge_logs: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      health_check: {
        type: 'http',
        path: '/health',
        port: 3000,
        interval: '15s',
        timeout: '5s',
        retries: 3,
        start_period: '10s',
      },
      logs: {
        // JSON logs are easier to ingest with centralised logging (ELK, Loki, etc.)
        format: 'json',
        rotate: {
          size: '50M',
          keep: 5,
          compress: true,
        },
        timestamp: true,
      },
    },
  ],
  dashboard: {
    enabled: true,
    port: 9615,
  },
  plugins: [
    {
      // Docker-awareness plugin: exposes container metadata (container ID,
      // image, resource limits) to the NovaPM dashboard and log entries.
      name: '@novapm/plugin-docker',
      options: {
        // Attach container labels as tags visible in the dashboard
        labels: true,
        // Expose cgroup memory / CPU limits as metrics
        cgroupMetrics: true,
      },
    },
  ],
};
