/**
 * Tests for configuration management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// Mock os module before importing config
vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

import {
  expandTilde,
  normalizePath,
  resolvePath,
  resolvePaths,
  loadConfig,
  getConfig,
  clearConfigCache,
  getConfigSources,
  getActionPaths,
  ENV_VARS,
  CONFIG_PATHS,
  type Config,
} from './config.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_HOME = '/home/testuser';
const TEST_CWD = '/project';

// Mock config file contents
const USER_CONFIG = `
actions:
  paths:
    - ~/user-actions
    - /opt/shared
  default_timeout: 45000
  debug: false
`;

const PROJECT_CONFIG = `
actions:
  paths:
    - ./project-actions
  default_timeout: 60000
  max_depth: 15
  debug: true
`;

// ============================================================================
// Path Resolution Tests
// ============================================================================

describe('Path Resolution', () => {
  describe('expandTilde', () => {
    it('should expand ~ at the start', () => {
      const result = expandTilde('~/actions');
      // On Windows, path separators may be backslashes
      expect(result).toContain('home');
      expect(result).toContain('testuser');
      expect(result).toContain('actions');
    });

    it('should expand ~ alone', () => {
      const result = expandTilde('~');
      expect(result).toContain('home');
      expect(result).toContain('testuser');
    });

    it('should not expand ~ in the middle', () => {
      expect(expandTilde('/path/~/actions')).toBe('/path/~/actions');
    });

    it('should return unchanged if no tilde', () => {
      expect(expandTilde('/absolute/path')).toBe('/absolute/path');
      expect(expandTilde('./relative/path')).toBe('./relative/path');
    });
  });

  describe('normalizePath', () => {
    it('should normalize separators', () => {
      const result = normalizePath('/path/to/../actions');
      expect(result).toBe('/path/actions');
    });

    it('should expand tilde and normalize', () => {
      const result = normalizePath('~/actions/../files');
      expect(result).toBe('/home/testuser/files');
    });

    it('should handle Windows paths on Windows', () => {
      if (process.platform === 'win32') {
        const result = normalizePath('C:\\Users\\test\\actions');
        expect(result).toContain('Users/test/actions');
      }
    });
  });

  describe('resolvePath', () => {
    it('should resolve relative paths', () => {
      const result = resolvePath('./actions', '/project');
      // On Windows, this will be 'D:/project/actions', so just check it ends correctly
      expect(result).toMatch(/\/project\/actions$/);
      expect(result).toContain('project/actions');
    });

    it('should resolve parent directory references', () => {
      const result = resolvePath('../actions', '/project/subdir');
      expect(result).toMatch(/\/project\/actions$/);
      expect(result).toContain('project/actions');
    });

    it('should keep absolute paths unchanged (after normalization)', () => {
      const result = resolvePath('/absolute/path', '/project');
      // Absolute paths are preserved (may have drive letter on Windows)
      expect(result).toContain('/absolute/path');
    });

    it('should expand tilde before resolving', () => {
      const result = resolvePath('~/actions', '/project');
      expect(result).toBe('/home/testuser/actions');
    });
  });

  describe('resolvePaths', () => {
    it('should resolve multiple paths', () => {
      const result = resolvePaths(['./a', '../b', '/c', '~/d'], '/project/sub');
      // Check each path contains the expected parts
      expect(result[0]).toContain('project/sub/a');
      expect(result[1]).toContain('project/b');
      expect(result[2]).toContain('/c');
      expect(result[3]).toBe('/home/testuser/d');
    });

    it('should handle empty array', () => {
      expect(resolvePaths([], '/base')).toEqual([]);
    });
  });
});

// ============================================================================
// Environment Variable Tests
// ============================================================================

describe('Environment Variables', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all action-related env vars
    delete process.env[ENV_VARS.ACTIONS_PATH];
    delete process.env[ENV_VARS.ACTIONS_DEBUG];
    delete process.env[ENV_VARS.ACTIONS_TIMEOUT];
    delete process.env[ENV_VARS.ACTIONS_MAX_DEPTH];
    delete process.env[ENV_VARS.ACTIONS_MAX_STEPS];
    delete process.env[ENV_VARS.ACTIONS_DETECT_VERSION];
    clearConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('should read paths from environment', async () => {
    const separator = process.platform === 'win32' ? ';' : ':';
    process.env[ENV_VARS.ACTIONS_PATH] = `/path1${separator}/path2${separator}/path3`;

    // Mock file operations to avoid actual file access
    mockFileSystem({});

    const config = await loadConfig({ reload: true });
    expect(config.actions.paths).toContain('/path1');
    expect(config.actions.paths).toContain('/path2');
    expect(config.actions.paths).toContain('/path3');
  });

  it('should read debug flag from environment', async () => {
    process.env[ENV_VARS.ACTIONS_DEBUG] = 'true';
    mockFileSystem({});

    const config = await loadConfig({ reload: true });
    expect(config.actions.debug).toBe(true);
  });

  it('should read timeout from environment', async () => {
    process.env[ENV_VARS.ACTIONS_TIMEOUT] = '60000';
    mockFileSystem({});

    const config = await loadConfig({ reload: true });
    expect(config.actions.default_timeout).toBe(60000);
  });

  it('should read max_depth from environment', async () => {
    process.env[ENV_VARS.ACTIONS_MAX_DEPTH] = '20';
    mockFileSystem({});

    const config = await loadConfig({ reload: true });
    expect(config.actions.max_depth).toBe(20);
  });

  it('should read max_steps from environment', async () => {
    process.env[ENV_VARS.ACTIONS_MAX_STEPS] = '200';
    mockFileSystem({});

    const config = await loadConfig({ reload: true });
    expect(config.actions.max_steps).toBe(200);
  });

  it('should read detect_version from environment', async () => {
    process.env[ENV_VARS.ACTIONS_DETECT_VERSION] = 'false';
    mockFileSystem({});

    const config = await loadConfig({ reload: true });
    expect(config.actions.detect_version).toBe(false);
  });

  it('should handle "1" as true for boolean flags', async () => {
    process.env[ENV_VARS.ACTIONS_DEBUG] = '1';
    mockFileSystem({});

    const config = await loadConfig({ reload: true });
    expect(config.actions.debug).toBe(true);
  });

  it('should ignore invalid numeric values', async () => {
    process.env[ENV_VARS.ACTIONS_TIMEOUT] = 'invalid';
    process.env[ENV_VARS.ACTIONS_MAX_DEPTH] = 'NaN';
    mockFileSystem({});

    const config = await loadConfig({ reload: true });
    expect(config.actions.default_timeout).toBe(30000); // default
    expect(config.actions.max_depth).toBe(10); // default
  });

  it('should ignore negative numeric values', async () => {
    process.env[ENV_VARS.ACTIONS_TIMEOUT] = '-1000';
    mockFileSystem({});

    const config = await loadConfig({ reload: true });
    expect(config.actions.default_timeout).toBe(30000); // default
  });
});

// ============================================================================
// Configuration Loading Tests
// ============================================================================

describe('Configuration Loading', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all action-related env vars
    delete process.env[ENV_VARS.ACTIONS_PATH];
    delete process.env[ENV_VARS.ACTIONS_DEBUG];
    delete process.env[ENV_VARS.ACTIONS_TIMEOUT];
    delete process.env[ENV_VARS.ACTIONS_MAX_DEPTH];
    delete process.env[ENV_VARS.ACTIONS_MAX_STEPS];
    delete process.env[ENV_VARS.ACTIONS_DETECT_VERSION];
    clearConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('should use defaults when no config files exist', async () => {
    mockFileSystem({});

    const config = await loadConfig();
    expect(config.actions.default_timeout).toBe(30000);
    expect(config.actions.max_depth).toBe(10);
    expect(config.actions.max_steps).toBe(100);
    expect(config.actions.debug).toBe(false);
    expect(config.actions.detect_version).toBe(true);
    expect(config.actions.paths).toEqual([]);
  });

  it('should load user-level config', async () => {
    mockFileSystem({
      [CONFIG_PATHS.USER]: USER_CONFIG,
    });

    const config = await loadConfig();
    expect(config.actions.default_timeout).toBe(45000);
    expect(config.actions.debug).toBe(false);
    expect(config.actions.paths).toContain('/home/testuser/user-actions');
    expect(config.actions.paths).toContain('/opt/shared');
  });

  it('should load project-level config', async () => {
    mockFileSystem({
      [CONFIG_PATHS.PROJECT]: PROJECT_CONFIG,
    });

    const config = await loadConfig();
    expect(config.actions.default_timeout).toBe(60000);
    expect(config.actions.max_depth).toBe(15);
    expect(config.actions.debug).toBe(true);
  });

  it('should merge user and project configs with correct priority', async () => {
    mockFileSystem({
      [CONFIG_PATHS.USER]: USER_CONFIG,
      [CONFIG_PATHS.PROJECT]: PROJECT_CONFIG,
    });

    const config = await loadConfig();

    // Project overrides user
    expect(config.actions.default_timeout).toBe(60000); // from project
    expect(config.actions.debug).toBe(true); // from project

    // Project adds to user (max_depth)
    expect(config.actions.max_depth).toBe(15); // from project

    // Paths are concatenated
    expect(config.actions.paths.length).toBeGreaterThan(2);
  });

  it('should give environment variables highest priority', async () => {
    process.env[ENV_VARS.ACTIONS_DEBUG] = 'false';
    process.env[ENV_VARS.ACTIONS_TIMEOUT] = '90000';

    mockFileSystem({
      [CONFIG_PATHS.USER]: USER_CONFIG,
      [CONFIG_PATHS.PROJECT]: PROJECT_CONFIG,
    });

    const config = await loadConfig({ reload: true });

    // Environment overrides everything
    expect(config.actions.debug).toBe(false); // from env, not project (true)
    expect(config.actions.default_timeout).toBe(90000); // from env, not project (60000)
  });

  it('should cache configuration', async () => {
    mockFileSystem({
      [CONFIG_PATHS.USER]: USER_CONFIG,
    });

    const config1 = await loadConfig();
    const config2 = await getConfig();

    expect(config1).toBe(config2); // Same reference
  });

  it('should reload when requested', async () => {
    // First load with 45000 timeout
    mockFileSystem({
      [CONFIG_PATHS.USER]: USER_CONFIG,
    });

    const config1 = await loadConfig();
    expect(config1.actions.default_timeout).toBe(45000);

    // Update mock to return different content
    mockFileSystem({
      [CONFIG_PATHS.USER]: USER_CONFIG.replace('45000', '50000'),
    });

    const config2 = await loadConfig({ reload: true });
    expect(config2.actions.default_timeout).toBe(50000);
  });

  it('should handle invalid YAML gracefully', async () => {
    mockFileSystem({
      [CONFIG_PATHS.USER]: '{ invalid: yaml: content:',
    });

    await expect(loadConfig()).rejects.toThrow(/Failed to load configuration/);
  });

  it('should resolve relative paths in config files', async () => {
    mockFileSystem({
      [CONFIG_PATHS.PROJECT]: `
actions:
  paths:
    - ./relative
    - ../parent
`,
    });

    const config = await loadConfig();
    const projectDir = path.dirname(CONFIG_PATHS.PROJECT);

    // Config resolves paths to absolute, so we need to resolve to absolute as well
    const expectedRelative = path.resolve(normalizePath(path.join(projectDir, 'relative')));
    const expectedParent = path.resolve(
      normalizePath(path.join(path.dirname(projectDir), 'parent'))
    );

    // Normalize the actual paths too for comparison (convert backslashes to forward slashes)
    const normalizedPaths = config.actions.paths.map((p) => normalizePath(p));
    const normalizedExpectedRelative = normalizePath(expectedRelative);
    const normalizedExpectedParent = normalizePath(expectedParent);

    expect(normalizedPaths).toContain(normalizedExpectedRelative);
    expect(normalizedPaths).toContain(normalizedExpectedParent);
  });
});

// ============================================================================
// Configuration Sources Tests
// ============================================================================

describe('Configuration Sources', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all action-related env vars
    delete process.env[ENV_VARS.ACTIONS_PATH];
    delete process.env[ENV_VARS.ACTIONS_DEBUG];
    delete process.env[ENV_VARS.ACTIONS_TIMEOUT];
    delete process.env[ENV_VARS.ACTIONS_MAX_DEPTH];
    delete process.env[ENV_VARS.ACTIONS_MAX_STEPS];
    delete process.env[ENV_VARS.ACTIONS_DETECT_VERSION];
    clearConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('should track configuration sources', async () => {
    process.env[ENV_VARS.ACTIONS_DEBUG] = 'true';

    mockFileSystem({
      [CONFIG_PATHS.USER]: USER_CONFIG,
      [CONFIG_PATHS.PROJECT]: PROJECT_CONFIG,
    });

    await loadConfig({ reload: true });
    const sources = await getConfigSources();

    expect(sources.defaults).toBeDefined();
    expect(sources.user).toBeDefined();
    expect(sources.project).toBeDefined();
    expect(sources.env).toBeDefined();
    expect(sources.merged).toBeDefined();

    expect(sources.user?.default_timeout).toBe(45000);
    expect(sources.project?.default_timeout).toBe(60000);
    expect(sources.env.debug).toBe(true);
    expect(sources.merged.default_timeout).toBe(60000); // project wins
    expect(sources.merged.debug).toBe(true); // env wins
  });
});

// ============================================================================
// Action Paths Tests
// ============================================================================

describe('Action Paths', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should include built-in actions path', async () => {
    mockFileSystem({});

    const paths = await getActionPaths();
    expect(paths).toContain(path.join(process.cwd(), 'actions'));
  });

  it('should include configured paths', async () => {
    mockFileSystem({
      [CONFIG_PATHS.USER]: `
actions:
  paths:
    - /custom/path1
    - /custom/path2
`,
    });

    const paths = await getActionPaths();
    expect(paths).toContain('/custom/path1');
    expect(paths).toContain('/custom/path2');
  });
});

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Mock the file system for testing
 * Maps file paths to their contents
 */
function mockFileSystem(files: Record<string, string>) {
  // Mock fs.access to check if file exists
  vi.spyOn(fs, 'access').mockImplementation(async (filePath: any) => {
    const pathStr = String(filePath);
    if (!(pathStr in files)) {
      throw new Error('ENOENT');
    }
  });

  // Mock fs.readFile to return file contents
  vi.spyOn(fs, 'readFile').mockImplementation(async (filePath: any, encoding: any) => {
    const pathStr = String(filePath);
    if (!(pathStr in files)) {
      throw new Error('ENOENT');
    }
    return files[pathStr];
  });
}
