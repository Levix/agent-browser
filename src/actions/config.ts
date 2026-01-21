/**
 * Configuration management for the Semantic Actions system
 *
 * This module handles:
 * - Loading configuration from multiple sources (files, environment variables)
 * - Merging configurations with proper priority
 * - Path resolution and normalization
 * - Default values and validation
 *
 * Priority order (highest to lowest):
 * 1. Environment variables
 * 2. Project-level config (.agent-browser/config.yaml)
 * 3. User-level config (~/.agent-browser/config.yaml)
 * 4. Built-in defaults
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// ============================================================================
// Configuration Schema
// ============================================================================

/**
 * Schema for actions configuration section
 */
const ActionsConfigSchema = z.object({
  /** Additional paths to load action definitions from */
  paths: z.array(z.string()).default([]),

  /** NPM packages containing action definitions (future feature) */
  packages: z.array(z.string()).default([]),

  /** Default timeout for all actions (milliseconds) */
  default_timeout: z.number().positive().default(30000),

  /** Maximum recursion depth when actions call other actions via 'run' step */
  max_depth: z.number().positive().int().default(10),

  /** Maximum number of steps in a single action execution */
  max_steps: z.number().positive().int().default(100),

  /** Enable debug mode for detailed logging */
  debug: z.boolean().default(false),

  /** Enable automatic component version detection */
  detect_version: z.boolean().default(true),
});

/**
 * Schema for the entire configuration file
 */
const ConfigFileSchema = z
  .object({
    actions: ActionsConfigSchema.optional(),
  })
  .passthrough(); // Allow other sections (e.g., browser config)

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Actions configuration
 */
export interface ActionsConfig {
  /** Additional paths to load action definitions from */
  paths: string[];

  /** NPM packages containing action definitions */
  packages: string[];

  /** Default timeout for all actions (milliseconds) */
  default_timeout: number;

  /** Maximum recursion depth */
  max_depth: number;

  /** Maximum number of steps */
  max_steps: number;

  /** Enable debug mode */
  debug: boolean;

  /** Enable automatic version detection */
  detect_version: boolean;
}

/**
 * Full configuration object
 */
export interface Config {
  actions: ActionsConfig;
}

/**
 * Configuration sources for debugging
 */
export interface ConfigSources {
  /** Built-in defaults */
  defaults: Partial<ActionsConfig>;

  /** User-level config */
  user: Partial<ActionsConfig> | null;

  /** Project-level config */
  project: Partial<ActionsConfig> | null;

  /** Environment variables */
  env: Partial<ActionsConfig>;

  /** Final merged config */
  merged: ActionsConfig;
}

// ============================================================================
// Environment Variables
// ============================================================================

/**
 * Environment variable names for configuration
 */
export const ENV_VARS = {
  /** Actions definition path (colon-separated on Unix, semicolon on Windows) */
  ACTIONS_PATH: 'AGENT_BROWSER_ACTIONS_PATH',

  /** Debug mode flag */
  ACTIONS_DEBUG: 'AGENT_BROWSER_ACTIONS_DEBUG',

  /** Default timeout (milliseconds) */
  ACTIONS_TIMEOUT: 'AGENT_BROWSER_ACTIONS_TIMEOUT',

  /** Maximum recursion depth */
  ACTIONS_MAX_DEPTH: 'AGENT_BROWSER_ACTIONS_MAX_DEPTH',

  /** Maximum steps */
  ACTIONS_MAX_STEPS: 'AGENT_BROWSER_ACTIONS_MAX_STEPS',

  /** Version detection flag */
  ACTIONS_DETECT_VERSION: 'AGENT_BROWSER_ACTIONS_DETECT_VERSION',
} as const;

/**
 * Read configuration from environment variables
 */
function readEnvConfig(): Partial<ActionsConfig> {
  const config: Partial<ActionsConfig> = {};

  // Read paths
  const pathsEnv = process.env[ENV_VARS.ACTIONS_PATH];
  if (pathsEnv) {
    const separator = process.platform === 'win32' ? ';' : ':';
    config.paths = pathsEnv.split(separator).filter(Boolean);
  }

  // Read debug flag
  const debugEnv = process.env[ENV_VARS.ACTIONS_DEBUG];
  if (debugEnv !== undefined) {
    config.debug = debugEnv === 'true' || debugEnv === '1';
  }

  // Read timeout
  const timeoutEnv = process.env[ENV_VARS.ACTIONS_TIMEOUT];
  if (timeoutEnv !== undefined) {
    const timeout = parseInt(timeoutEnv, 10);
    if (!isNaN(timeout) && timeout > 0) {
      config.default_timeout = timeout;
    }
  }

  // Read max depth
  const maxDepthEnv = process.env[ENV_VARS.ACTIONS_MAX_DEPTH];
  if (maxDepthEnv !== undefined) {
    const maxDepth = parseInt(maxDepthEnv, 10);
    if (!isNaN(maxDepth) && maxDepth > 0) {
      config.max_depth = maxDepth;
    }
  }

  // Read max steps
  const maxStepsEnv = process.env[ENV_VARS.ACTIONS_MAX_STEPS];
  if (maxStepsEnv !== undefined) {
    const maxSteps = parseInt(maxStepsEnv, 10);
    if (!isNaN(maxSteps) && maxSteps > 0) {
      config.max_steps = maxSteps;
    }
  }

  // Read version detection flag
  const detectVersionEnv = process.env[ENV_VARS.ACTIONS_DETECT_VERSION];
  if (detectVersionEnv !== undefined) {
    config.detect_version = detectVersionEnv === 'true' || detectVersionEnv === '1';
  }

  return config;
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Expand tilde (~) in a path to the user's home directory
 */
export function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Normalize a path to POSIX style (forward slashes)
 * Handles Windows paths and converts them to a consistent format
 */
export function normalizePath(filePath: string): string {
  // Expand tilde first
  let normalized = expandTilde(filePath);

  // Normalize path separators
  normalized = path.normalize(normalized);

  // Convert to POSIX style (forward slashes)
  if (process.platform === 'win32') {
    normalized = normalized.replace(/\\/g, '/');
  }

  return normalized;
}

/**
 * Resolve a path relative to a base path
 * If the path is already absolute, returns it normalized
 * Otherwise, resolves it relative to the base path
 */
export function resolvePath(filePath: string, basePath: string): string {
  // Expand tilde
  const expanded = expandTilde(filePath);

  // If already absolute, just normalize
  if (path.isAbsolute(expanded)) {
    return normalizePath(expanded);
  }

  // Resolve relative to base
  const resolved = path.resolve(basePath, expanded);
  return normalizePath(resolved);
}

/**
 * Resolve multiple paths relative to a base path
 */
export function resolvePaths(paths: string[], basePath: string): string[] {
  return paths.map((p) => resolvePath(p, basePath));
}

// ============================================================================
// Configuration File Loading
// ============================================================================

/**
 * Standard configuration file locations
 */
export const CONFIG_PATHS = {
  /** User-level config */
  USER: expandTilde('~/.agent-browser/config.yaml'),

  /** Project-level config (relative to cwd) */
  PROJECT: '.agent-browser/config.yaml',
} as const;

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load and parse a YAML configuration file
 * Returns null if the file doesn't exist
 * Throws an error if the file exists but is invalid
 */
async function loadConfigFile(filePath: string): Promise<Partial<ActionsConfig> | null> {
  try {
    const exists = await fileExists(filePath);
    if (!exists) {
      return null;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = parseYaml(content);

    // Validate against schema
    const validated = ConfigFileSchema.parse(parsed);

    // Extract actions config
    if (!validated.actions) {
      return null;
    }

    // Resolve paths relative to the config file's directory
    const configDir = path.dirname(filePath);
    const actionsConfig = validated.actions;

    if (actionsConfig.paths && actionsConfig.paths.length > 0) {
      actionsConfig.paths = resolvePaths(actionsConfig.paths, configDir);
    }

    return actionsConfig as Partial<ActionsConfig>;
  } catch (error) {
    throw new Error(
      `Failed to load configuration from ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Load configuration from all standard locations
 */
async function loadAllConfigs(): Promise<{
  user: Partial<ActionsConfig> | null;
  project: Partial<ActionsConfig> | null;
}> {
  const [user, project] = await Promise.all([
    loadConfigFile(CONFIG_PATHS.USER),
    loadConfigFile(CONFIG_PATHS.PROJECT),
  ]);

  return { user, project };
}

// ============================================================================
// Configuration Merging
// ============================================================================

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: ActionsConfig = {
  paths: [],
  packages: [],
  default_timeout: 30000,
  max_depth: 10,
  max_steps: 100,
  debug: false,
  detect_version: true,
};

/**
 * Merge multiple configuration objects with proper priority
 * Later configs override earlier ones
 * Arrays are concatenated and deduplicated
 */
function mergeConfigs(...configs: Partial<ActionsConfig>[]): ActionsConfig {
  const merged: ActionsConfig = { ...DEFAULT_CONFIG };

  for (const config of configs) {
    if (config.paths) {
      // Concatenate paths and deduplicate
      const allPaths = [...merged.paths, ...config.paths];
      merged.paths = Array.from(new Set(allPaths));
    }

    if (config.packages) {
      // Concatenate packages and deduplicate
      const allPackages = [...merged.packages, ...config.packages];
      merged.packages = Array.from(new Set(allPackages));
    }

    // Direct overrides for scalar values
    if (config.default_timeout !== undefined) {
      merged.default_timeout = config.default_timeout;
    }
    if (config.max_depth !== undefined) {
      merged.max_depth = config.max_depth;
    }
    if (config.max_steps !== undefined) {
      merged.max_steps = config.max_steps;
    }
    if (config.debug !== undefined) {
      merged.debug = config.debug;
    }
    if (config.detect_version !== undefined) {
      merged.detect_version = config.detect_version;
    }
  }

  return merged;
}

// ============================================================================
// Main API
// ============================================================================

let cachedConfig: Config | null = null;
let cachedSources: ConfigSources | null = null;

/**
 * Load and merge configuration from all sources
 * Results are cached for subsequent calls
 *
 * Priority order (highest to lowest):
 * 1. Environment variables
 * 2. Project-level config
 * 3. User-level config
 * 4. Built-in defaults
 */
export async function loadConfig(options: { reload?: boolean } = {}): Promise<Config> {
  // Return cached config unless reload is requested
  if (cachedConfig && !options.reload) {
    return cachedConfig;
  }

  // Load from all sources
  const { user, project } = await loadAllConfigs();
  const env = readEnvConfig();

  // Merge with priority: defaults < user < project < env
  const merged = mergeConfigs(DEFAULT_CONFIG, user || {}, project || {}, env);

  // Cache results
  cachedConfig = { actions: merged };
  cachedSources = {
    defaults: DEFAULT_CONFIG,
    user,
    project,
    env,
    merged,
  };

  return cachedConfig;
}

/**
 * Get the cached configuration
 * Loads configuration if not already cached
 */
export async function getConfig(): Promise<Config> {
  return loadConfig();
}

/**
 * Get configuration sources for debugging
 * Shows which values came from which source
 */
export async function getConfigSources(): Promise<ConfigSources> {
  // Ensure config is loaded
  await loadConfig();

  if (!cachedSources) {
    throw new Error('Configuration sources not available');
  }

  return cachedSources;
}

/**
 * Clear the configuration cache
 * Next call to loadConfig will reload from files
 */
export function clearConfigCache(): void {
  cachedConfig = null;
  cachedSources = null;
}

/**
 * Get the list of all action definition paths to load
 * Includes built-in paths and user-configured paths
 */
export async function getActionPaths(): Promise<string[]> {
  const config = await getConfig();
  const paths: string[] = [];

  // Built-in actions (relative to project root)
  const builtinPath = path.join(process.cwd(), 'actions');
  paths.push(builtinPath);

  // User-configured paths
  paths.push(...config.actions.paths);

  return paths;
}
