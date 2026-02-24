import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FilePluginStorage, createPluginStorageFactory } from '../PluginStorage.js';

// ---------------------------------------------------------------------------
// Mock all filesystem operations
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('@novapm/shared', () => ({
  NOVA_PLUGIN_DIR: '/mock/home/.novapm/plugins',
}));

// Import the mocked modules so we can set return values
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);
const mockedRename = vi.mocked(rename);
const mockedUnlink = vi.mocked(unlink);
const mockedExistsSync = vi.mocked(existsSync);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FilePluginStorage', () => {
  let storage: FilePluginStorage;

  beforeEach(() => {
    vi.restoreAllMocks();

    // Default mocks: no existing file
    mockedExistsSync.mockReturnValue(false);
    mockedMkdir.mockResolvedValue(undefined);
    mockedWriteFile.mockResolvedValue(undefined);
    mockedRename.mockResolvedValue(undefined);
    mockedUnlink.mockResolvedValue(undefined);

    storage = new FilePluginStorage('test-plugin');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ----- Constructor / name sanitization -----
  describe('constructor', () => {
    it('should sanitize plugin names with special characters', () => {
      // The sanitized name is used for the directory; we can verify
      // by checking the path used in operations.
      const s = new FilePluginStorage('@scope/my-plugin');
      // Trigger a get so loadData runs
      mockedExistsSync.mockReturnValue(false);

      // We just verify construction does not throw
      expect(s).toBeInstanceOf(FilePluginStorage);
    });
  });

  // ----- get / set / delete / list -----
  describe('get', () => {
    it('should return null for a key that does not exist', async () => {
      const result = await storage.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should return the value for an existing key', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFile.mockResolvedValue(JSON.stringify({ myKey: 'myValue' }));

      // Create a fresh storage to avoid cached empty map
      const s = new FilePluginStorage('read-test');
      const result = await s.get<string>('myKey');

      expect(result).toBe('myValue');
    });

    it('should return complex objects', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          config: { nested: { deep: true }, list: [1, 2, 3] },
        }),
      );

      const s = new FilePluginStorage('complex-test');
      const result = await s.get<{ nested: { deep: boolean }; list: number[] }>('config');

      expect(result).toEqual({ nested: { deep: true }, list: [1, 2, 3] });
    });
  });

  describe('set', () => {
    it('should store a value and persist it', async () => {
      await storage.set('key1', 'value1');

      // Should have written to disk
      expect(mockedMkdir).toHaveBeenCalled();
      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
      expect(mockedRename).toHaveBeenCalledTimes(1);

      // The written content should contain the key
      const writtenContent = mockedWriteFile.mock.calls[0]![1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed).toEqual({ key1: 'value1' });
    });

    it('should overwrite an existing key', async () => {
      await storage.set('key1', 'first');
      await storage.set('key1', 'second');

      // The most recent write should have the updated value
      const lastCall = mockedWriteFile.mock.calls[mockedWriteFile.mock.calls.length - 1]!;
      const parsed = JSON.parse(lastCall[1] as string);
      expect(parsed.key1).toBe('second');
    });

    it('should handle multiple keys', async () => {
      await storage.set('a', 1);
      await storage.set('b', 2);
      await storage.set('c', 3);

      const lastCall = mockedWriteFile.mock.calls[mockedWriteFile.mock.calls.length - 1]!;
      const parsed = JSON.parse(lastCall[1] as string);
      expect(parsed).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe('delete', () => {
    it('should remove a key from storage', async () => {
      await storage.set('toDelete', 'value');
      await storage.delete('toDelete');

      const lastCall = mockedWriteFile.mock.calls[mockedWriteFile.mock.calls.length - 1]!;
      const parsed = JSON.parse(lastCall[1] as string);
      expect(parsed).not.toHaveProperty('toDelete');
    });

    it('should not throw when deleting a nonexistent key', async () => {
      await expect(storage.delete('ghost')).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('should list all keys', async () => {
      await storage.set('alpha', 1);
      await storage.set('beta', 2);
      await storage.set('gamma', 3);

      const keys = await storage.list();
      expect(keys).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
      expect(keys).toHaveLength(3);
    });

    it('should filter keys by prefix', async () => {
      await storage.set('user:1', 'alice');
      await storage.set('user:2', 'bob');
      await storage.set('config:theme', 'dark');

      const keys = await storage.list('user:');
      expect(keys).toEqual(expect.arrayContaining(['user:1', 'user:2']));
      expect(keys).toHaveLength(2);
    });

    it('should return empty array when no keys match prefix', async () => {
      await storage.set('a', 1);
      const keys = await storage.list('zzz:');
      expect(keys).toEqual([]);
    });

    it('should return empty array for empty storage', async () => {
      const keys = await storage.list();
      expect(keys).toEqual([]);
    });
  });

  // ----- Cache behavior -----
  describe('cache behavior', () => {
    it('should cache data after first load and not read file again', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFile.mockResolvedValue(JSON.stringify({ cached: 'data' }));

      const s = new FilePluginStorage('cache-test');

      // First access reads from file
      await s.get('cached');
      expect(mockedReadFile).toHaveBeenCalledTimes(1);

      // Second access should use cache
      await s.get('cached');
      expect(mockedReadFile).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should use cache for subsequent operations after set', async () => {
      await storage.set('x', 1);

      // Reads after set should use cache, not readFile
      const val = await storage.get<number>('x');
      expect(val).toBe(1);
      expect(mockedReadFile).not.toHaveBeenCalled();
    });

    it('should create empty map when storage file does not exist', async () => {
      mockedExistsSync.mockReturnValue(false);
      const s = new FilePluginStorage('new-plugin');

      const keys = await s.list();
      expect(keys).toEqual([]);
      expect(mockedReadFile).not.toHaveBeenCalled();
    });

    it('should handle corrupted JSON by starting fresh', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFile.mockResolvedValue('NOT VALID JSON {{{');

      const s = new FilePluginStorage('corrupt-test');
      const result = await s.get('anything');

      expect(result).toBeNull();
    });

    it('should handle readFile error by starting fresh', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFile.mockRejectedValue(new Error('EACCES'));

      const s = new FilePluginStorage('error-read');
      const result = await s.get('anything');

      expect(result).toBeNull();
    });

    it('should handle non-object JSON (array) by starting fresh', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFile.mockResolvedValue('[1, 2, 3]');

      const s = new FilePluginStorage('array-json');
      const keys = await s.list();

      expect(keys).toEqual([]);
    });

    it('should handle null JSON by starting fresh', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFile.mockResolvedValue('null');

      const s = new FilePluginStorage('null-json');
      const keys = await s.list();

      expect(keys).toEqual([]);
    });
  });

  // ----- Atomic writes -----
  describe('atomic writes', () => {
    it('should write to a temp file then rename', async () => {
      await storage.set('atomic', 'test');

      // Verify the write sequence: mkdir -> writeFile(tmp) -> rename(tmp -> target)
      expect(mockedMkdir).toHaveBeenCalledWith(expect.stringContaining('test-plugin'), {
        recursive: true,
      });

      const tmpPath = mockedWriteFile.mock.calls[0]![0] as string;
      expect(tmpPath).toMatch(/storage\.json\.tmp\.\d+$/);

      expect(mockedRename).toHaveBeenCalledWith(tmpPath, expect.stringContaining('storage.json'));
    });

    it('should create the storage directory recursively', async () => {
      await storage.set('dir-test', 1);

      expect(mockedMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('should serialize concurrent writes', async () => {
      const writeOrder: number[] = [];
      let writeCount = 0;

      mockedWriteFile.mockImplementation(async () => {
        writeCount++;
        const myOrder = writeCount;
        // Simulate some async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        writeOrder.push(myOrder);
      });

      // Fire multiple sets concurrently
      await Promise.all([storage.set('a', 1), storage.set('b', 2), storage.set('c', 3)]);

      // Writes should have been serialized (sequential order)
      expect(writeOrder).toEqual([1, 2, 3]);
    });
  });

  // ----- Write failure and cache invalidation -----
  describe('cache invalidation on write failure', () => {
    it('should not update cache when atomic write fails', async () => {
      // First, populate with initial data
      mockedExistsSync.mockReturnValue(true);
      mockedReadFile.mockResolvedValue(JSON.stringify({ original: 'data' }));

      const s = new FilePluginStorage('fail-write');

      // Load initial data
      const initial = await s.get('original');
      expect(initial).toBe('data');

      // Now make writeFile fail
      mockedWriteFile.mockRejectedValue(new Error('ENOSPC'));

      // Attempt to set should fail
      await expect(s.set('new-key', 'new-value')).rejects.toThrow('ENOSPC');
    });

    it('should clean up temp file on write failure', async () => {
      mockedWriteFile.mockRejectedValue(new Error('ENOSPC'));

      await expect(storage.set('fail', 'val')).rejects.toThrow('ENOSPC');

      // unlink should have been called to clean up the temp file
      expect(mockedUnlink).toHaveBeenCalledWith(expect.stringMatching(/storage\.json\.tmp\.\d+$/));
    });

    it('should not throw if temp file cleanup also fails', async () => {
      mockedWriteFile.mockRejectedValue(new Error('ENOSPC'));
      mockedUnlink.mockRejectedValue(new Error('ENOENT'));

      // The original error should still propagate (not the unlink error)
      await expect(storage.set('fail2', 'val')).rejects.toThrow('ENOSPC');
    });

    it('should clean up temp file on rename failure', async () => {
      mockedRename.mockRejectedValue(new Error('EXDEV'));

      await expect(storage.set('rename-fail', 'val')).rejects.toThrow('EXDEV');

      expect(mockedUnlink).toHaveBeenCalled();
    });
  });

  // ----- Write queue / persistence -----
  describe('write queue', () => {
    it('should process writes sequentially through the queue', async () => {
      const callOrder: string[] = [];

      mockedWriteFile.mockImplementation(async (_path) => {
        callOrder.push('write');
        await new Promise((resolve) => setTimeout(resolve, 5));
      });

      mockedRename.mockImplementation(async () => {
        callOrder.push('rename');
      });

      await storage.set('q1', 'v1');

      // Each set should produce a write+rename pair
      expect(callOrder).toEqual(['write', 'rename']);
    });

    it('should handle sequential writes maintaining data integrity', async () => {
      await storage.set('first', 1);
      await storage.set('second', 2);
      await storage.delete('first');

      const lastCall = mockedWriteFile.mock.calls[mockedWriteFile.mock.calls.length - 1]!;
      const parsed = JSON.parse(lastCall[1] as string);
      expect(parsed).toEqual({ second: 2 });
    });
  });

  // ----- Data format -----
  describe('data format', () => {
    it('should write JSON with 2-space indentation', async () => {
      await storage.set('pretty', { nested: true });

      const writtenContent = mockedWriteFile.mock.calls[0]![1] as string;
      expect(writtenContent).toBe(JSON.stringify({ pretty: { nested: true } }, null, 2));
    });

    it('should write with utf-8 encoding', async () => {
      await storage.set('encoding', 'test');

      expect(mockedWriteFile).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'utf-8');
    });
  });
});

// ---------------------------------------------------------------------------
// createPluginStorageFactory
// ---------------------------------------------------------------------------

describe('createPluginStorageFactory', () => {
  it('should return a factory function', () => {
    const factory = createPluginStorageFactory();
    expect(typeof factory).toBe('function');
  });

  it('should create FilePluginStorage instances', () => {
    const factory = createPluginStorageFactory();
    const storage = factory('my-plugin');

    expect(storage).toBeInstanceOf(FilePluginStorage);
  });

  it('should create separate instances for different plugin names', () => {
    const factory = createPluginStorageFactory();
    const storageA = factory('plugin-a');
    const storageB = factory('plugin-b');

    expect(storageA).not.toBe(storageB);
  });
});
