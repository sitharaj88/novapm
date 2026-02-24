// Database
export { getDatabase, closeDatabase } from './db/Database.js';
export { ProcessRepository } from './db/repositories/ProcessRepository.js';
export { MetricsRepository } from './db/repositories/MetricsRepository.js';
export { EventRepository } from './db/repositories/EventRepository.js';

// Events
export { EventBus, getEventBus } from './events/EventBus.js';

// Process management
export { ProcessContainer } from './process/ProcessContainer.js';
export { ProcessManager } from './process/ProcessManager.js';
export { gracefulShutdown } from './process/GracefulShutdown.js';

// Logging
export { LogAggregator } from './logs/LogAggregator.js';
export { LogRotator } from './logs/LogRotator.js';

// Metrics
export { MetricsCollector } from './metrics/MetricsCollector.js';
export { SystemMetricsCollector } from './metrics/SystemMetricsCollector.js';

// Health
export { HealthMonitor } from './health/HealthMonitor.js';

// IPC
export { IPCServer } from './ipc/IPCServer.js';
export { IPCClient } from './ipc/IPCClient.js';
export {
  createRequest,
  createResponse,
  createErrorResponse,
  serializeMessage,
  deserializeMessage,
} from './ipc/protocol.js';

// HTTP API
export { HTTPServer } from './api/HTTPServer.js';

// Daemon
export { NovaDaemon } from './daemon/Daemon.js';
export {
  isDaemonRunning,
  getDaemonPid,
  spawnDaemon,
  writePidFile,
  removePidFile,
} from './daemon/daemonize.js';
