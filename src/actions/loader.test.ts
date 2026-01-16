/**
 * Tests for action loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadActions,
  loadActionFile,
  getActionPaths,
  discoverFiles,
  normalizePath,
  expandTilde,
  type LoaderConfig,
} from './loader.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const validNamespaceYaml = `
schema_version: 1
namespace: test
version: 1.0.0
description: Test namespace

selectors:
  button: "button.primary"

actions:
  test_action:
    description: A test action
    params:
      name:
        type: string
        description: Name parameter
        required: true
    steps:
      - action: click
        args:
          selector: \${selectors.button}
`;

const invalidNamespaceYaml = `
schema_version: 1
namespace: invalid namespace with spaces
version: not-semver
actions:
  no_steps:
    description: Missing steps
`;

const configYaml = `
selectors:
  button: "button.override"
`;

const extendsConfigYaml = `
extends: ../parent/_config.yaml

selectors:
  input: "input.custom"
`;

// ============================================================================
// Test Utilities
// ============================================================================

async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'action-loader-test-'));
}

async function createFile(dirPath: string, filename: string, content: string): Promise<string> {
  const filePath = path.join(dirPath, filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

async function cleanup(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('loader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanup(tempDir);
  });

  // ==========================================================================
  // Path Resolution
  // ==========================================================================

  describe('getActionPaths', () => {
    it('should include built-in actions path', () => {
      const paths = getActionPaths();
      expect(paths.some((p) => p.includes('actions'))).toBe(true);
    });

    it('should include user-level actions path when HOME is set', () => {
      const paths = getActionPaths();
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      if (homeDir) {
        expect(paths.some((p) => p.includes('.agent-browser'))).toBe(true);
      }
    });

    it('should include project-level actions path', () => {
      const paths = getActionPaths({ basePath: '/project' });
      // Use normalizePath for Windows compatibility
      const normalized = paths.map((p) => normalizePath(p));
      expect(normalized.some((p) => p.includes('/project/.agent-browser/actions'))).toBe(true);
    });

    it('should include custom paths from config', () => {
      const config: LoaderConfig = {
        paths: ['/custom/path', './relative/path'],
        basePath: '/base',
      };
      const paths = getActionPaths(config);
      const normalized = paths.map((p) => normalizePath(p));
      expect(paths).toContain('/custom/path');
      expect(normalized.some((p) => p.includes('/base/relative/path'))).toBe(true);
    });

    it('should parse environment variable paths', () => {
      const originalEnv = process.env.AGENT_BROWSER_ACTIONS_PATH;

      process.env.AGENT_BROWSER_ACTIONS_PATH = `/path1${path.delimiter}/path2`;
      const paths = getActionPaths();

      expect(paths).toContain('/path1');
      expect(paths).toContain('/path2');

      process.env.AGENT_BROWSER_ACTIONS_PATH = originalEnv;
    });
  });

  describe('normalizePath', () => {
    it('should convert backslashes to forward slashes', () => {
      expect(normalizePath('C:\\Users\\test\\file.txt')).toBe('C:/Users/test/file.txt');
      expect(normalizePath('path\\to\\file')).toBe('path/to/file');
    });

    it('should leave forward slashes unchanged', () => {
      expect(normalizePath('/path/to/file')).toBe('/path/to/file');
    });
  });

  describe('expandTilde', () => {
    it('should expand tilde to home directory', () => {
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      if (homeDir) {
        expect(expandTilde('~/test')).toBe(path.join(homeDir, 'test'));
      }
    });

    it('should leave non-tilde paths unchanged', () => {
      expect(expandTilde('/absolute/path')).toBe('/absolute/path');
      expect(expandTilde('relative/path')).toBe('relative/path');
    });
  });

  // ==========================================================================
  // File Discovery
  // ==========================================================================

  describe('discoverFiles', () => {
    it('should find YAML files in directory', async () => {
      await createFile(tempDir, 'test1.yaml', validNamespaceYaml);
      await createFile(tempDir, 'test2.yml', validNamespaceYaml);
      await createFile(tempDir, 'not-yaml.txt', 'text');

      const files = await discoverFiles([tempDir]);

      expect(files).toHaveLength(2);
      expect(files.some((f) => f.endsWith('test1.yaml'))).toBe(true);
      expect(files.some((f) => f.endsWith('test2.yml'))).toBe(true);
      expect(files.some((f) => f.endsWith('not-yaml.txt'))).toBe(false);
    });

    it('should recursively scan subdirectories', async () => {
      await createFile(tempDir, 'root.yaml', validNamespaceYaml);
      await createFile(tempDir, 'sub/nested.yaml', validNamespaceYaml);
      await createFile(tempDir, 'sub/deep/file.yml', validNamespaceYaml);

      const files = await discoverFiles([tempDir]);

      expect(files).toHaveLength(3);
      expect(files.some((f) => f.endsWith('root.yaml'))).toBe(true);
      expect(files.some((f) => f.endsWith('nested.yaml'))).toBe(true);
      expect(files.some((f) => f.endsWith('file.yml'))).toBe(true);
    });

    it('should handle single file paths', async () => {
      const filePath = await createFile(tempDir, 'single.yaml', validNamespaceYaml);

      const files = await discoverFiles([filePath]);

      expect(files).toHaveLength(1);
      expect(files[0]).toBe(filePath);
    });

    it('should skip non-existent paths', async () => {
      const files = await discoverFiles(['/non/existent/path']);
      expect(files).toHaveLength(0);
    });

    it('should handle multiple paths', async () => {
      const dir1 = await createTempDir();
      const dir2 = await createTempDir();

      try {
        await createFile(dir1, 'file1.yaml', validNamespaceYaml);
        await createFile(dir2, 'file2.yaml', validNamespaceYaml);

        const files = await discoverFiles([dir1, dir2]);

        expect(files).toHaveLength(2);
        expect(files.some((f) => f.includes('file1.yaml'))).toBe(true);
        expect(files.some((f) => f.includes('file2.yaml'))).toBe(true);
      } finally {
        await cleanup(dir1);
        await cleanup(dir2);
      }
    });
  });

  // ==========================================================================
  // File Loading
  // ==========================================================================

  describe('loadActionFile', () => {
    it('should load valid namespace file', async () => {
      const filePath = await createFile(tempDir, 'test.yaml', validNamespaceYaml);

      const result = await loadActionFile(filePath);

      expect('type' in result).toBe(false);
      if (!('type' in result)) {
        expect(result.namespace).toBe('test');
        expect(result.version).toBe('1.0.0');
        expect(result.actions.test_action).toBeDefined();
        expect(result.actions.test_action.fullName).toBe('test:test_action');
      }
    });

    it('should return error for invalid namespace file', async () => {
      const filePath = await createFile(tempDir, 'invalid.yaml', invalidNamespaceYaml);

      const result = await loadActionFile(filePath);

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('validation_error');
      }
    });

    it('should return error for non-existent file', async () => {
      const result = await loadActionFile('/non/existent/file.yaml');

      expect('type' in result).toBe(true);
      if ('type' in result) {
        expect(result.type).toBe('file_not_found');
      }
    });

    it('should return error for malformed YAML', async () => {
      const filePath = await createFile(tempDir, 'bad.yaml', 'invalid: yaml: [');

      const result = await loadActionFile(filePath);

      expect('type' in result).toBe(true);
      if ('type' in result) {
        // Malformed YAML should return validation_error (from validateActionFile)
        expect(result.type).toBe('validation_error');
      }
    });

    it('should preserve source path', async () => {
      const filePath = await createFile(tempDir, 'test.yaml', validNamespaceYaml);

      const result = await loadActionFile(filePath);

      if (!('type' in result)) {
        expect(result.sourcePath).toBe(filePath);
        expect(result.actions.test_action.sourcePath).toBe(filePath);
      }
    });
  });

  // ==========================================================================
  // Configuration Inheritance
  // ==========================================================================

  describe('configuration inheritance', () => {
    it('should apply selector overrides from _config.yaml', async () => {
      await createFile(tempDir, '_config.yaml', configYaml);
      const filePath = await createFile(tempDir, 'test.yaml', validNamespaceYaml);

      const result = await loadActionFile(filePath);

      if (!('type' in result)) {
        expect(result.selectors.button).toBe('button.override');
      }
    });

    it('should resolve extends chain', async () => {
      const parentDir = path.join(tempDir, 'parent');
      await createFile(parentDir, '_config.yaml', configYaml);

      const childDir = path.join(tempDir, 'child');
      await createFile(childDir, '_config.yaml', extendsConfigYaml);
      const filePath = await createFile(childDir, 'test.yaml', validNamespaceYaml);

      const result = await loadActionFile(filePath);

      if (!('type' in result)) {
        expect(result.selectors.button).toBe('button.override');
        expect(result.selectors.input).toBe('input.custom');
      }
    });

    it('should handle missing parent config gracefully', async () => {
      await createFile(tempDir, '_config.yaml', extendsConfigYaml);
      const filePath = await createFile(tempDir, 'test.yaml', validNamespaceYaml);

      const result = await loadActionFile(filePath);

      expect('type' in result).toBe(false);
      if (!('type' in result)) {
        expect(result.selectors.input).toBe('input.custom');
      }
    });
  });

  // ==========================================================================
  // Batch Loading
  // ==========================================================================

  describe('loadActions', () => {
    it('should load multiple namespace files', async () => {
      await createFile(tempDir, 'ns1.yaml', validNamespaceYaml.replace('test', 'ns1'));
      await createFile(tempDir, 'ns2.yaml', validNamespaceYaml.replace('test', 'ns2'));

      const result = await loadActions({ paths: [tempDir] });

      expect(result.namespaces.size).toBe(2);
      expect(result.namespaces.has('ns1')).toBe(true);
      expect(result.namespaces.has('ns2')).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect errors for invalid files', async () => {
      await createFile(tempDir, 'valid.yaml', validNamespaceYaml);
      await createFile(tempDir, 'invalid.yaml', invalidNamespaceYaml);

      const result = await loadActions({ paths: [tempDir] });

      expect(result.namespaces.size).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should override namespaces from later paths', async () => {
      const dir1 = await createTempDir();
      const dir2 = await createTempDir();

      try {
        await createFile(dir1, 'test.yaml', validNamespaceYaml);
        const v2 = validNamespaceYaml.replace('Test namespace', 'Version 2');
        await createFile(dir2, 'test.yaml', v2);

        const result = await loadActions({ paths: [dir1, dir2] });

        expect(result.namespaces.size).toBe(1);
        expect(result.namespaces.get('test')?.description).toBe('Version 2');
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0].type).toBe('override');
      } finally {
        await cleanup(dir1);
        await cleanup(dir2);
      }
    });

    it('should warn about deprecated actions', async () => {
      const deprecated = validNamespaceYaml.replace(
        'A test action',
        'A test action\n    deprecated: true\n    deprecated_message: Use new_action instead'
      );
      await createFile(tempDir, 'test.yaml', deprecated);

      const result = await loadActions({ paths: [tempDir] });

      expect(result.warnings.some((w) => w.type === 'deprecated_action')).toBe(true);
    });

    it('should skip _config.yaml files', async () => {
      await createFile(tempDir, '_config.yaml', configYaml);
      await createFile(tempDir, 'test.yaml', validNamespaceYaml);

      const result = await loadActions({ paths: [tempDir] });

      expect(result.namespaces.size).toBe(1);
      expect(result.namespaces.has('_config')).toBe(false);
    });

    it('should handle empty directories', async () => {
      const result = await loadActions({ paths: [tempDir] });

      expect(result.namespaces.size).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Debug Mode
  // ==========================================================================

  describe('debug mode', () => {
    it('should log when debug is enabled', async () => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
      };

      try {
        await createFile(tempDir, 'test.yaml', validNamespaceYaml);
        await loadActions({ paths: [tempDir], debug: true });

        expect(logs.some((log) => log.includes('[Loader]'))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });
  });
});
