import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePluginTemplate } from '../scaffold.js';

// ---------------------------------------------------------------------------
// Mock filesystem
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { writeFile, mkdir } from 'node:fs/promises';

const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generatePluginTemplate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockedWriteFile.mockResolvedValue(undefined);
    mockedMkdir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ----- Directory creation -----
  describe('directory creation', () => {
    it('should create the plugin directory with src subdirectory', async () => {
      await generatePluginTemplate('my-plugin', '/output');

      expect(mockedMkdir).toHaveBeenCalledWith('/output/my-plugin/src', { recursive: true });
    });

    it('should create nested output directories', async () => {
      await generatePluginTemplate('test', '/deep/nested/output');

      expect(mockedMkdir).toHaveBeenCalledWith('/deep/nested/output/test/src', { recursive: true });
    });
  });

  // ----- File output structure -----
  describe('file output structure', () => {
    it('should generate exactly three files', async () => {
      await generatePluginTemplate('my-plugin', '/output');

      expect(mockedWriteFile).toHaveBeenCalledTimes(3);
    });

    it('should generate package.json', async () => {
      await generatePluginTemplate('my-plugin', '/output');

      const packageJsonCall = mockedWriteFile.mock.calls.find((call) =>
        (call[0] as string).endsWith('package.json'),
      );
      expect(packageJsonCall).toBeDefined();
      expect(packageJsonCall![0]).toBe('/output/my-plugin/package.json');
    });

    it('should generate tsconfig.json', async () => {
      await generatePluginTemplate('my-plugin', '/output');

      const tsconfigCall = mockedWriteFile.mock.calls.find((call) =>
        (call[0] as string).endsWith('tsconfig.json'),
      );
      expect(tsconfigCall).toBeDefined();
      expect(tsconfigCall![0]).toBe('/output/my-plugin/tsconfig.json');
    });

    it('should generate src/index.ts', async () => {
      await generatePluginTemplate('my-plugin', '/output');

      const indexCall = mockedWriteFile.mock.calls.find((call) =>
        (call[0] as string).endsWith('index.ts'),
      );
      expect(indexCall).toBeDefined();
      expect(indexCall![0]).toBe('/output/my-plugin/src/index.ts');
    });

    it('should write all files with utf-8 encoding', async () => {
      await generatePluginTemplate('my-plugin', '/output');

      for (const call of mockedWriteFile.mock.calls) {
        expect(call[2]).toBe('utf-8');
      }
    });
  });

  // ----- package.json content -----
  describe('package.json content', () => {
    async function getGeneratedPackageJson(name: string): Promise<Record<string, unknown>> {
      await generatePluginTemplate(name, '/output');

      const call = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).endsWith('package.json'),
      );
      return JSON.parse(call![1] as string) as Record<string, unknown>;
    }

    it('should set the correct package name', async () => {
      const pkg = await getGeneratedPackageJson('my-plugin');
      expect(pkg.name).toBe('novapm-plugin-my-plugin');
    });

    it('should set version to 1.0.0', async () => {
      const pkg = await getGeneratedPackageJson('my-plugin');
      expect(pkg.version).toBe('1.0.0');
    });

    it('should include the plugin name in the description', async () => {
      const pkg = await getGeneratedPackageJson('my-plugin');
      expect(pkg.description).toContain('my-plugin');
    });

    it('should set type to module', async () => {
      const pkg = await getGeneratedPackageJson('my-plugin');
      expect(pkg.type).toBe('module');
    });

    it('should set main to ./dist/index.js', async () => {
      const pkg = await getGeneratedPackageJson('my-plugin');
      expect(pkg.main).toBe('./dist/index.js');
    });

    it('should include @novapm/plugin-sdk as a dependency', async () => {
      const pkg = await getGeneratedPackageJson('my-plugin');
      const deps = pkg.dependencies as Record<string, string>;
      expect(deps['@novapm/plugin-sdk']).toBe('workspace:*');
    });

    it('should include typescript as a dev dependency', async () => {
      const pkg = await getGeneratedPackageJson('my-plugin');
      const devDeps = pkg.devDependencies as Record<string, string>;
      expect(devDeps.typescript).toBeDefined();
    });

    it('should include build, dev, and clean scripts', async () => {
      const pkg = await getGeneratedPackageJson('my-plugin');
      const scripts = pkg.scripts as Record<string, string>;
      expect(scripts.build).toBe('tsc');
      expect(scripts.dev).toBe('tsc --watch');
      expect(scripts.clean).toBe('rm -rf dist');
    });

    it('should include exports configuration', async () => {
      const pkg = await getGeneratedPackageJson('my-plugin');
      const exports = pkg.exports as Record<string, Record<string, string>>;
      expect(exports['.']).toBeDefined();
      expect(exports['.']!.import).toBe('./dist/index.js');
      expect(exports['.']!.types).toBe('./dist/index.d.ts');
    });
  });

  // ----- tsconfig.json content -----
  describe('tsconfig.json content', () => {
    async function getGeneratedTsConfig(): Promise<Record<string, unknown>> {
      await generatePluginTemplate('my-plugin', '/output');

      const call = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).endsWith('tsconfig.json'),
      );
      return JSON.parse(call![1] as string) as Record<string, unknown>;
    }

    it('should extend the base tsconfig', async () => {
      const config = await getGeneratedTsConfig();
      expect(config.extends).toBe('../../tsconfig.base.json');
    });

    it('should set outDir and rootDir', async () => {
      const config = await getGeneratedTsConfig();
      const compilerOptions = config.compilerOptions as Record<string, string>;
      expect(compilerOptions.outDir).toBe('./dist');
      expect(compilerOptions.rootDir).toBe('./src');
    });

    it('should include src files', async () => {
      const config = await getGeneratedTsConfig();
      expect(config.include).toEqual(['src/**/*.ts']);
    });

    it('should exclude node_modules, dist, and test files', async () => {
      const config = await getGeneratedTsConfig();
      const exclude = config.exclude as string[];
      expect(exclude).toContain('node_modules');
      expect(exclude).toContain('dist');
      expect(exclude).toContain('**/*.test.ts');
    });
  });

  // ----- Plugin source (src/index.ts) content -----
  describe('plugin source content', () => {
    async function getGeneratedSource(name: string): Promise<string> {
      await generatePluginTemplate(name, '/output');

      const call = mockedWriteFile.mock.calls.find((c) => (c[0] as string).endsWith('index.ts'));
      return call![1] as string;
    }

    it('should import NovaPMPlugin and PluginContext types', async () => {
      const source = await getGeneratedSource('my-plugin');
      expect(source).toContain(
        "import type { NovaPMPlugin, PluginContext } from '@novapm/plugin-sdk'",
      );
    });

    it('should import ProcessEvent and ProcessMetrics types', async () => {
      const source = await getGeneratedSource('my-plugin');
      expect(source).toContain(
        "import type { ProcessEvent, ProcessMetrics } from '@novapm/shared'",
      );
    });

    it('should create a class that implements NovaPMPlugin', async () => {
      const source = await getGeneratedSource('my-plugin');
      expect(source).toContain('implements NovaPMPlugin');
    });

    it('should set the plugin name correctly', async () => {
      const source = await getGeneratedSource('my-plugin');
      expect(source).toContain("readonly name = 'my-plugin'");
    });

    it('should set the plugin version', async () => {
      const source = await getGeneratedSource('my-plugin');
      expect(source).toContain("readonly version = '1.0.0'");
    });

    it('should include an onInit hook', async () => {
      const source = await getGeneratedSource('my-plugin');
      expect(source).toContain('async onInit(context: PluginContext)');
    });

    it('should include an onDestroy hook', async () => {
      const source = await getGeneratedSource('my-plugin');
      expect(source).toContain('async onDestroy()');
    });

    it('should include an onProcessCrash hook', async () => {
      const source = await getGeneratedSource('my-plugin');
      expect(source).toContain('async onProcessCrash(event: ProcessEvent)');
    });

    it('should include an onMetricsCollected hook', async () => {
      const source = await getGeneratedSource('my-plugin');
      expect(source).toContain('async onMetricsCollected(metrics: ProcessMetrics[])');
    });

    it('should export default a plugin instance', async () => {
      const source = await getGeneratedSource('my-plugin');
      expect(source).toContain('export default new');
    });
  });

  // ----- Plugin name sanitization -----
  describe('plugin name sanitization', () => {
    it('should sanitize names with special characters for file content', async () => {
      await generatePluginTemplate('my@special!plugin', '/output');

      // The directory should use the raw name
      expect(mockedMkdir).toHaveBeenCalledWith('/output/my@special!plugin/src', {
        recursive: true,
      });

      // But the package.json name should be sanitized
      const pkgCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).endsWith('package.json'),
      );
      const pkg = JSON.parse(pkgCall![1] as string) as Record<string, string>;
      expect(pkg.name).toBe('novapm-plugin-my-special-plugin');
    });

    it('should handle names with dots', async () => {
      await generatePluginTemplate('my.plugin', '/output');

      const pkgCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).endsWith('package.json'),
      );
      const pkg = JSON.parse(pkgCall![1] as string) as Record<string, string>;
      expect(pkg.name).toBe('novapm-plugin-my-plugin');
    });

    it('should preserve hyphens and alphanumeric chars', async () => {
      await generatePluginTemplate('valid-name-123', '/output');

      const pkgCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).endsWith('package.json'),
      );
      const pkg = JSON.parse(pkgCall![1] as string) as Record<string, string>;
      expect(pkg.name).toBe('novapm-plugin-valid-name-123');
    });
  });

  // ----- camelCase conversion for class name -----
  describe('camelCase class name generation', () => {
    it('should capitalize the first letter for the class name', async () => {
      await generatePluginTemplate('my-plugin', '/output');

      const sourceCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).endsWith('index.ts'),
      );
      const source = sourceCall![1] as string;
      expect(source).toContain('class MyPluginPlugin');
    });

    it('should handle single-word names', async () => {
      await generatePluginTemplate('simple', '/output');

      const sourceCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).endsWith('index.ts'),
      );
      const source = sourceCall![1] as string;
      expect(source).toContain('class SimplePlugin');
    });

    it('should handle multi-part hyphenated names', async () => {
      await generatePluginTemplate('my-cool-plugin', '/output');

      const sourceCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).endsWith('index.ts'),
      );
      const source = sourceCall![1] as string;
      expect(source).toContain('class MyCoolPluginPlugin');
    });
  });

  // ----- Error handling -----
  describe('error handling', () => {
    it('should propagate mkdir errors', async () => {
      mockedMkdir.mockRejectedValue(new Error('EACCES'));

      await expect(generatePluginTemplate('fail-plugin', '/read-only')).rejects.toThrow('EACCES');
    });

    it('should propagate writeFile errors', async () => {
      mockedWriteFile.mockRejectedValue(new Error('ENOSPC'));

      await expect(generatePluginTemplate('fail-plugin', '/output')).rejects.toThrow('ENOSPC');
    });
  });
});
