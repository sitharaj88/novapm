import { renameSync, statSync, unlinkSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { parseBytes } from '@novapm/shared';

export interface RotationConfig {
  maxSize: string;
  keep: number;
  compress?: boolean;
}

export class LogRotator {
  private config: RotationConfig;
  private maxSizeBytes: number;

  constructor(config: RotationConfig) {
    this.config = config;
    this.maxSizeBytes = parseBytes(config.maxSize);
  }

  async rotateIfNeeded(filePath: string): Promise<boolean> {
    try {
      const stats = statSync(filePath);
      if (stats.size >= this.maxSizeBytes) {
        await this.rotate(filePath);
        return true;
      }
    } catch {
      // File doesn't exist, nothing to rotate
    }
    return false;
  }

  private async rotate(filePath: string): Promise<void> {
    // Shift existing rotated files
    for (let i = this.config.keep - 1; i >= 1; i--) {
      const ext = this.config.compress ? '.gz' : '';
      const from = i === 1 ? `${filePath}.1${ext}` : `${filePath}.${i}${ext}`;
      const to = `${filePath}.${i + 1}${ext}`;

      try {
        renameSync(from, to);
      } catch {
        // File doesn't exist, skip
      }
    }

    // Delete oldest if exceeds keep limit
    try {
      const ext = this.config.compress ? '.gz' : '';
      unlinkSync(`${filePath}.${this.config.keep + 1}${ext}`);
    } catch {
      // File doesn't exist
    }

    // Rotate current file
    const rotatedPath = `${filePath}.1`;
    renameSync(filePath, rotatedPath);

    // Compress if enabled
    if (this.config.compress) {
      await this.compressFile(rotatedPath, `${rotatedPath}.gz`);
      unlinkSync(rotatedPath);
    }
  }

  private async compressFile(input: string, output: string): Promise<void> {
    const source = createReadStream(input);
    const destination = createWriteStream(output);
    const gzip = createGzip();
    await pipeline(source, gzip, destination);
  }
}
