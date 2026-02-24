import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NOVA_PLUGIN_DIR } from '@novapm/shared';
import type { PluginStorage, PluginStorageFactory } from './types.js';

/**
 * File-based key-value storage implementation for plugins.
 * Each plugin gets its own namespaced JSON file under ~/.novapm/plugins/{plugin-name}/storage.json.
 * Uses atomic writes (write to temp file then rename) for data safety.
 */
export class FilePluginStorage implements PluginStorage {
  private readonly storagePath: string;
  private readonly storageDir: string;
  private cache: Map<string, unknown> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(pluginName: string) {
    const sanitizedName = pluginName.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.storageDir = join(NOVA_PLUGIN_DIR, sanitizedName);
    this.storagePath = join(this.storageDir, 'storage.json');
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const data = await this.loadData();
    const value = data.get(key);
    if (value === undefined) {
      return null;
    }
    return value as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    const data = await this.loadData();
    data.set(key, value);
    await this.persistData(data);
  }

  async delete(key: string): Promise<void> {
    const data = await this.loadData();
    data.delete(key);
    await this.persistData(data);
  }

  async list(prefix?: string): Promise<string[]> {
    const data = await this.loadData();
    const keys = Array.from(data.keys());
    if (prefix) {
      return keys.filter((key) => key.startsWith(prefix));
    }
    return keys;
  }

  /**
   * Load data from disk. Caches in memory for performance.
   */
  private async loadData(): Promise<Map<string, unknown>> {
    if (this.cache !== null) {
      return this.cache;
    }

    try {
      if (!existsSync(this.storagePath)) {
        this.cache = new Map();
        return this.cache;
      }

      const content = await readFile(this.storagePath, 'utf-8');
      const parsed: unknown = JSON.parse(content);

      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.cache = new Map(Object.entries(parsed as Record<string, unknown>));
      } else {
        this.cache = new Map();
      }
    } catch {
      // If file is corrupted or unreadable, start fresh
      this.cache = new Map();
    }

    return this.cache;
  }

  /**
   * Persist data to disk using atomic writes.
   * Writes to a temporary file first, then renames to the target path.
   * Serializes writes to prevent concurrent file access issues.
   * Only updates cache after successful write to prevent stale data.
   */
  private async persistData(data: Map<string, unknown>): Promise<void> {
    // Queue writes to ensure thread safety
    this.writeQueue = this.writeQueue.then(async () => {
      await this.atomicWrite(data);
      // Only update cache after successful write
      this.cache = data;
    });

    await this.writeQueue;
  }

  /**
   * Atomic write: write to temp file, then rename.
   */
  private async atomicWrite(data: Map<string, unknown>): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });

    const obj: Record<string, unknown> = {};
    for (const [key, value] of data) {
      obj[key] = value;
    }

    const content = JSON.stringify(obj, null, 2);
    const tmpPath = `${this.storagePath}.tmp.${Date.now()}`;

    try {
      await writeFile(tmpPath, content, 'utf-8');
      await rename(tmpPath, this.storagePath);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }
}

/**
 * Creates a PluginStorageFactory that produces FilePluginStorage instances.
 */
export function createPluginStorageFactory(): PluginStorageFactory {
  return (pluginName: string): PluginStorage => {
    return new FilePluginStorage(pluginName);
  };
}
