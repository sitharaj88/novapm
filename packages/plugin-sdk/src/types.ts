import type {
  NovaProcess,
  ProcessMetrics,
  ProcessEvent,
  SystemMetrics,
  LogEntry,
  NovaConfig,
} from '@novapm/shared';
import type { Logger } from 'pino';

/**
 * The main plugin interface that all NovaPM plugins must implement.
 * Plugins can hook into various lifecycle events of the process manager.
 */
export interface NovaPMPlugin {
  /** Unique name identifying this plugin */
  name: string;
  /** Semantic version string */
  version: string;
  /** Optional human-readable description */
  description?: string;
  /** Optional author information */
  author?: string;

  // Lifecycle hooks
  onInit?(context: PluginContext): Promise<void>;
  onDestroy?(): Promise<void>;

  // Process hooks
  onProcessStart?(event: ProcessEvent): Promise<void>;
  onProcessStop?(event: ProcessEvent): Promise<void>;
  onProcessRestart?(event: ProcessEvent): Promise<void>;
  onProcessCrash?(event: ProcessEvent): Promise<void>;
  onProcessExit?(event: ProcessEvent): Promise<void>;

  // Metrics hooks
  onMetricsCollected?(metrics: ProcessMetrics[]): Promise<void>;
  onSystemMetrics?(metrics: SystemMetrics): Promise<void>;

  // Log hooks
  onLogEntry?(entry: LogEntry): Promise<void>;

  // Health check hooks
  onHealthCheckFail?(event: ProcessEvent): Promise<void>;
  onHealthCheckRestore?(event: ProcessEvent): Promise<void>;

  // Config hooks
  onConfigChange?(config: NovaConfig): Promise<void>;

  // Extension points
  routes?(): RouteDefinition[];
  widgets?(): WidgetDefinition[];
}

/**
 * Context provided to plugins during initialization.
 * Gives access to configuration, logging, the NovaPM API, and persistent storage.
 */
export interface PluginContext {
  /** Plugin-specific configuration from the NovaPM config file */
  config: Record<string, unknown>;
  /** Scoped pino logger instance for this plugin */
  logger: Logger;
  /** API for interacting with NovaPM processes and system */
  api: PluginAPI;
  /** Persistent key-value storage scoped to this plugin */
  storage: PluginStorage;
}

/**
 * API provided to plugins for interacting with NovaPM's process management.
 */
export interface PluginAPI {
  /** Get all managed processes */
  getProcesses(): NovaProcess[];
  /** Get a specific process by ID */
  getProcess(id: number): NovaProcess | null;
  /** Restart a process by ID */
  restartProcess(id: number): Promise<void>;
  /** Stop a process by ID */
  stopProcess(id: number): Promise<void>;
  /** Scale a process to the specified number of instances */
  scaleProcess(id: number, instances: number): Promise<void>;
  /** Get current metrics for a process */
  getMetrics(processId: number): ProcessMetrics | null;
  /** Get current system metrics */
  getSystemMetrics(): SystemMetrics | null;
  /** Get recent log entries for a process */
  getRecentLogs(processId: number, lines?: number): LogEntry[];
  /** Emit a custom event */
  emit(event: string, data: unknown): void;
  /** Listen for a custom event */
  on(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Persistent key-value storage interface scoped to each plugin.
 */
export interface PluginStorage {
  /** Retrieve a value by key */
  get<T = unknown>(key: string): Promise<T | null>;
  /** Store a value by key */
  set(key: string, value: unknown): Promise<void>;
  /** Delete a value by key */
  delete(key: string): Promise<void>;
  /** List all keys, optionally filtered by prefix */
  list(prefix?: string): Promise<string[]>;
}

/**
 * Factory function type for creating plugin-scoped storage instances.
 */
export type PluginStorageFactory = (pluginName: string) => PluginStorage;

/**
 * Defines an HTTP route that a plugin can register.
 */
export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: (request: unknown, reply: unknown) => Promise<unknown>;
}

/**
 * Defines a dashboard widget that a plugin can provide.
 */
export interface WidgetDefinition {
  id: string;
  title: string;
  component: string;
  width?: 'small' | 'medium' | 'large' | 'full';
  position?: number;
}

/**
 * Plugin manifest describing a plugin package.
 */
export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  novapm: {
    minVersion?: string;
    hooks?: string[];
  };
}

/**
 * Internal representation of a loaded plugin with its runtime state.
 */
export interface LoadedPlugin {
  plugin: NovaPMPlugin;
  context: PluginContext;
  status: 'active' | 'disabled' | 'errored';
  errorCount: number;
}

/**
 * Configuration for loading a plugin.
 */
export interface PluginLoadConfig {
  name: string;
  path?: string;
  options?: Record<string, unknown>;
}
