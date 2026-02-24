// Types
export type {
  NovaProcess,
  ProcessStatus,
  ProcessMetrics,
  ProcessEvent,
  ProcessEventType,
  LogEntry,
  NovaConfig,
  AppConfig,
  HealthCheckConfig,
  ScalingConfig,
  DeployConfig,
  LogConfig,
  ServerConfig,
  PluginConfig,
  AIConfig,
  DashboardConfig,
  SystemMetrics,
  NetworkInterface,
  DiskUsage,
  TimeSeriesPoint,
  EventBusMessage,
  IPCMethod,
  IPCRequest,
  IPCResponse,
  IPCError,
  IPCErrorCode,
} from './types/index.js';

export { IPC_ERROR_CODES } from './types/index.js';

// Constants
export {
  NOVA_HOME,
  NOVA_PID_FILE,
  NOVA_SOCK_FILE,
  NOVA_LOG_DIR,
  NOVA_DB_FILE,
  NOVA_PLUGIN_DIR,
  NOVA_DAEMON_LOG,
  NOVA_DAEMON_ERROR_LOG,
  NOVA_CONFIG_FILES,
  DEFAULT_KILL_TIMEOUT,
  DEFAULT_LISTEN_TIMEOUT,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_RESTART_DELAY,
  DEFAULT_EXP_BACKOFF_MAX,
  DEFAULT_DASHBOARD_PORT,
  DEFAULT_AGENT_PORT,
  DEFAULT_METRICS_INTERVAL,
  DEFAULT_HEALTH_CHECK_INTERVAL,
  DEFAULT_HEALTH_CHECK_TIMEOUT,
  DEFAULT_HEALTH_CHECK_RETRIES,
  IPC_PROTOCOL_VERSION,
  NOVA_VERSION,
  DEFAULT_INTERPRETER,
  DEFAULT_EXEC_MODE,
  DEFAULT_INSTANCES,
  LOG_ROTATION_SIZE,
  LOG_ROTATION_KEEP,
} from './constants.js';

// Schemas
export {
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
} from './schemas/config.schema.js';

export type { ValidatedAppConfig, ValidatedNovaConfig } from './schemas/config.schema.js';

export {
  ipcRequestSchema,
  ipcResponseSchema,
  ipcMethodSchema,
  ipcErrorSchema,
} from './schemas/ipc.schema.js';

// Utilities
export {
  parseDuration,
  formatDuration,
  parseBytes,
  formatBytes,
  formatCpu,
  formatUptime,
} from './utils/parser.js';

export { createLogger, getLogger, setDefaultLogger } from './utils/logger.js';
export type { LogLevel, CreateLoggerOptions } from './utils/logger.js';

export {
  NovaError,
  ProcessNotFoundError,
  ProcessAlreadyExistsError,
  ProcessNotRunningError,
  DaemonNotRunningError,
  DaemonAlreadyRunningError,
  ConfigValidationError,
  IPCConnectionError,
  IPCTimeoutError,
} from './utils/errors.js';
