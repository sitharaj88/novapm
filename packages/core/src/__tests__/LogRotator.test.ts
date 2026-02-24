import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock node:fs ---
const mockStatSync = vi.fn();
const mockRenameSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockCreateReadStream = vi.fn();
const mockCreateWriteStream = vi.fn();

vi.mock('node:fs', () => ({
  statSync: (...args: unknown[]) => mockStatSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
  createWriteStream: (...args: unknown[]) => mockCreateWriteStream(...args),
}));

// --- Mock node:zlib ---
const mockGzip = { pipe: vi.fn() };
vi.mock('node:zlib', () => ({
  createGzip: vi.fn(() => mockGzip),
}));

// --- Mock node:stream/promises ---
vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn(() => Promise.resolve()),
}));

// --- Mock @novapm/shared ---
vi.mock('@novapm/shared', () => ({
  parseBytes: vi.fn((value: string) => {
    // Simple parser for test purposes
    const units: Record<string, number> = {
      B: 1,
      K: 1024,
      KB: 1024,
      M: 1024 * 1024,
      MB: 1024 * 1024,
      G: 1024 * 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };
    const match = value.match(/^(\d+)\s*(B|KB?|MB?|GB?)$/i);
    if (!match) return 0;
    const num = parseInt(match[1], 10);
    const unit = match[2].toUpperCase();
    return num * (units[unit] || 1);
  }),
}));

import { LogRotator } from '../logs/LogRotator.js';
import type { RotationConfig } from '../logs/LogRotator.js';
import { pipeline } from 'node:stream/promises';

describe('LogRotator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createRotator(overrides: Partial<RotationConfig> = {}): LogRotator {
    return new LogRotator({
      maxSize: '10MB',
      keep: 5,
      compress: false,
      ...overrides,
    });
  }

  describe('constructor', () => {
    it('should parse the maxSize string to bytes', () => {
      const rotator = createRotator({ maxSize: '100MB' });
      // We can verify this indirectly - the rotator should be created without error
      expect(rotator).toBeDefined();
    });
  });

  describe('rotateIfNeeded', () => {
    it('should return false if file is smaller than maxSize', async () => {
      mockStatSync.mockReturnValue({ size: 1024 }); // 1KB, well under 10MB

      const rotator = createRotator({ maxSize: '10MB' });
      const result = await rotator.rotateIfNeeded('/logs/app-out.log');

      expect(result).toBe(false);
      expect(mockRenameSync).not.toHaveBeenCalled();
    });

    it('should return true and rotate if file exceeds maxSize', async () => {
      mockStatSync.mockReturnValue({ size: 20 * 1024 * 1024 }); // 20MB, over 10MB

      const rotator = createRotator({ maxSize: '10MB', keep: 3 });
      const result = await rotator.rotateIfNeeded('/logs/app-out.log');

      expect(result).toBe(true);
    });

    it('should return true when file size exactly equals maxSize', async () => {
      mockStatSync.mockReturnValue({ size: 10 * 1024 * 1024 }); // Exactly 10MB

      const rotator = createRotator({ maxSize: '10MB' });
      const result = await rotator.rotateIfNeeded('/logs/app-out.log');

      expect(result).toBe(true);
    });

    it('should return false if the file does not exist (statSync throws)', async () => {
      mockStatSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const rotator = createRotator();
      const result = await rotator.rotateIfNeeded('/logs/nonexistent.log');

      expect(result).toBe(false);
      expect(mockRenameSync).not.toHaveBeenCalled();
    });
  });

  describe('rotation mechanics (without compression)', () => {
    beforeEach(() => {
      // File exceeds max size -> triggers rotation
      mockStatSync.mockReturnValue({ size: 20 * 1024 * 1024 });
    });

    it('should shift existing rotated files by incrementing their index', async () => {
      const rotator = createRotator({ maxSize: '10MB', keep: 3, compress: false });

      await rotator.rotateIfNeeded('/logs/app.log');

      // Should try to rename .2 -> .3, then .1 -> .2
      const renameCalls = mockRenameSync.mock.calls;

      // The loop goes from keep-1 down to 1, so:
      // i=2: rename /logs/app.log.2 -> /logs/app.log.3
      // i=1: rename /logs/app.log.1 -> /logs/app.log.2
      // Then the current file: /logs/app.log -> /logs/app.log.1
      const shiftCalls = renameCalls.filter((call) => call[0] !== '/logs/app.log');
      expect(shiftCalls).toContainEqual(['/logs/app.log.2', '/logs/app.log.3']);
      expect(shiftCalls).toContainEqual(['/logs/app.log.1', '/logs/app.log.2']);
    });

    it('should rename the current file to .1', async () => {
      const rotator = createRotator({ maxSize: '10MB', keep: 3, compress: false });

      await rotator.rotateIfNeeded('/logs/app.log');

      // The last rename should be current -> .1
      expect(mockRenameSync).toHaveBeenCalledWith('/logs/app.log', '/logs/app.log.1');
    });

    it('should delete the oldest file beyond keep limit', async () => {
      const rotator = createRotator({ maxSize: '10MB', keep: 3, compress: false });

      await rotator.rotateIfNeeded('/logs/app.log');

      // Should try to unlink .4 (keep+1) without .gz extension
      expect(mockUnlinkSync).toHaveBeenCalledWith('/logs/app.log.4');
    });

    it('should not throw if oldest file does not exist for deletion', async () => {
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const rotator = createRotator({ maxSize: '10MB', keep: 3, compress: false });

      await expect(rotator.rotateIfNeeded('/logs/app.log')).resolves.toBe(true);
    });

    it('should not throw if shift rename fails (file does not exist)', async () => {
      // Make the shift renames fail but allow the final rename
      let callCount = 0;
      mockRenameSync.mockImplementation((_from: string, _to: string) => {
        callCount++;
        // Last call is the actual rotation (current -> .1); let it succeed
        // Earlier calls are shift operations; they may fail
        if (callCount <= 2) {
          throw new Error('ENOENT');
        }
      });

      const rotator = createRotator({ maxSize: '10MB', keep: 3, compress: false });

      await expect(rotator.rotateIfNeeded('/logs/app.log')).resolves.toBe(true);
    });
  });

  describe('rotation mechanics (with compression)', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ size: 20 * 1024 * 1024 });
      mockCreateReadStream.mockReturnValue({ pipe: vi.fn() });
      mockCreateWriteStream.mockReturnValue({ on: vi.fn() });
    });

    it('should shift files with .gz extension when compression is enabled', async () => {
      const rotator = createRotator({ maxSize: '10MB', keep: 3, compress: true });

      await rotator.rotateIfNeeded('/logs/app.log');

      // i=2: rename .2.gz -> .3.gz
      // i=1: rename .1.gz -> .2.gz
      const renameCalls = mockRenameSync.mock.calls;
      const shiftCalls = renameCalls.filter((call) => call[0] !== '/logs/app.log');
      expect(shiftCalls).toContainEqual(['/logs/app.log.2.gz', '/logs/app.log.3.gz']);
      expect(shiftCalls).toContainEqual(['/logs/app.log.1.gz', '/logs/app.log.2.gz']);
    });

    it('should compress the rotated file with gzip', async () => {
      const rotator = createRotator({ maxSize: '10MB', keep: 3, compress: true });

      await rotator.rotateIfNeeded('/logs/app.log');

      // Should call pipeline for compression
      expect(pipeline).toHaveBeenCalled();
      // Should create read stream from the rotated file
      expect(mockCreateReadStream).toHaveBeenCalledWith('/logs/app.log.1');
      // Should create write stream for the .gz output
      expect(mockCreateWriteStream).toHaveBeenCalledWith('/logs/app.log.1.gz');
    });

    it('should delete the uncompressed rotated file after compression', async () => {
      const rotator = createRotator({ maxSize: '10MB', keep: 3, compress: true });

      await rotator.rotateIfNeeded('/logs/app.log');

      // unlinkSync should be called for the rotated .1 file (after compression)
      // and also attempted for the overflow file .4.gz
      expect(mockUnlinkSync).toHaveBeenCalledWith('/logs/app.log.1');
    });

    it('should delete oldest file with .gz extension when compressed', async () => {
      const rotator = createRotator({ maxSize: '10MB', keep: 3, compress: true });

      await rotator.rotateIfNeeded('/logs/app.log');

      expect(mockUnlinkSync).toHaveBeenCalledWith('/logs/app.log.4.gz');
    });
  });

  describe('keep limit edge cases', () => {
    beforeEach(() => {
      mockStatSync.mockReturnValue({ size: 20 * 1024 * 1024 });
    });

    it('should handle keep=1 (only one rotated file)', async () => {
      const rotator = createRotator({ maxSize: '10MB', keep: 1, compress: false });

      await rotator.rotateIfNeeded('/logs/app.log');

      // With keep=1, loop runs from i=0 down to 1, which means the loop body never executes
      // Then rename current -> .1, and delete .2
      expect(mockRenameSync).toHaveBeenCalledWith('/logs/app.log', '/logs/app.log.1');
      expect(mockUnlinkSync).toHaveBeenCalledWith('/logs/app.log.2');
    });

    it('should handle keep=2 properly', async () => {
      const rotator = createRotator({ maxSize: '10MB', keep: 2, compress: false });

      await rotator.rotateIfNeeded('/logs/app.log');

      // Loop: i=1, rename .1 -> .2
      // Then rename current -> .1
      // Delete .3
      expect(mockRenameSync).toHaveBeenCalledWith('/logs/app.log.1', '/logs/app.log.2');
      expect(mockRenameSync).toHaveBeenCalledWith('/logs/app.log', '/logs/app.log.1');
      expect(mockUnlinkSync).toHaveBeenCalledWith('/logs/app.log.3');
    });
  });

  describe('different maxSize values', () => {
    it('should respect small maxSize like 1KB', async () => {
      mockStatSync.mockReturnValue({ size: 2048 }); // 2KB

      const rotator = createRotator({ maxSize: '1K', keep: 3 });
      const result = await rotator.rotateIfNeeded('/logs/app.log');

      expect(result).toBe(true);
    });

    it('should not rotate when file is under a large maxSize', async () => {
      mockStatSync.mockReturnValue({ size: 500 * 1024 * 1024 }); // 500MB

      const rotator = createRotator({ maxSize: '1G', keep: 3 });
      const result = await rotator.rotateIfNeeded('/logs/app.log');

      expect(result).toBe(false);
    });
  });
});
