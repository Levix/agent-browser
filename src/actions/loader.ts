/**
 * Action definition loader
 *
 * This module handles loading action definitions from multiple sources:
 * - Built-in actions (actions/ directory)
 * - User-level actions (~/.agent-browser/actions/)
 * - Project-level actions (.agent-browser/actions/)
 * - Environment variable paths (AGENT_BROWSER_ACTIONS_PATH)
 * - Custom paths from configuration
 *
 * Supports:
 * - Directory scanning (*.yaml, *.yml)
 * - Single file loading
 * - Configuration inheritance via _config.yaml
 * - Proper error reporting with source context
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'node:url';
import type {
  NamespaceDefinition,
  SelectorDefinition,
  ActionCompatibility,
  ActionStep,
} from './types.js';
import { NamespaceFileSchema, type NamespaceFile, validateActionFile } from './validator.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for action loading
 */
export interface LoaderConfig {
  /** Additional paths to load actions from */
  paths?: string[];

  /** Enable debug logging */
  debug?: boolean;

  /** Base path for resolving relative paths (defaults to cwd) */
  basePath?: string;

  /** Use default paths (builtin, user, project). Defaults to true. Set to false for testing. */
  useDefaultPaths?: boolean;
}

/**
 * Result of loading action definitions
 */
export interface LoadResult {
  /** Successfully loaded namespaces */
  namespaces: Map<string, NamespaceDefinition>;

  /** Errors encountered during loading */
  errors: LoadError[];

  /** Warnings (e.g., deprecated actions) */
  warnings: LoadWarning[];
}

/**
 * Error encountered during loading
 */
export interface LoadError {
  /** Error type */
  type: 'file_not_found' | 'parse_error' | 'validation_error' | 'io_error';

  /** Source file path */
  path: string;

  /** Error message */
  message: string;

  /** Detailed error information */
  details?: unknown;
}

/**
 * Warning encountered during loading
 */
export interface LoadWarning {
  /** Warning type */
  type: 'duplicate_namespace' | 'deprecated_action' | 'override';

  /** Source file path */
  path: string;

  /** Warning message */
  message: string;
}

/**
 * Configuration inheritance structure (_config.yaml)
 */
interface ConfigFile {
  /** Parent configuration to extend */
  extends?: string | string[];

  /** Selector overrides */
  selectors?: Record<string, SelectorDefinition>;

  /** Other properties to merge */
  [key: string]: unknown;
}

// ============================================================================
// Constants
// ============================================================================

const YAML_EXTENSIONS = ['.yaml', '.yml'];
const CONFIG_FILENAME = '_config.yaml';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Built-in actions path (relative to this file: src/actions -> ../../actions)
const BUILTIN_ACTIONS_PATH = path.resolve(__dirname, '../../actions');

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the list of paths to scan for action definitions
 * Paths are returned in precedence order (later paths override earlier ones)
 */
export function getActionPaths(config?: LoaderConfig): string[] {
  const paths: string[] = [];
  const basePath = config?.basePath || process.cwd();
  const useDefaultPaths = config?.useDefaultPaths !== false; // Default to true

  // Only add default paths if enabled
  if (useDefaultPaths) {
    // 1. Built-in actions (lowest priority)
    paths.push(BUILTIN_ACTIONS_PATH);

    // 2. User-level actions (~/.agent-browser/actions/)
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (homeDir) {
      const userActionsPath = path.join(homeDir, '.agent-browser', 'actions');
      paths.push(userActionsPath);
    }

    // 3. Project-level actions (.agent-browser/actions/)
    const projectActionsPath = path.join(basePath, '.agent-browser', 'actions');
    paths.push(projectActionsPath);

    // 4. Environment variable paths
    const envPaths = process.env.AGENT_BROWSER_ACTIONS_PATH;
    if (envPaths) {
      const parsed = envPaths
        .split(path.delimiter)
        .map((p) => (path.isAbsolute(p) ? p : path.resolve(basePath, p)));
      paths.push(...parsed);
    }
  }

  // 5. Custom paths from config (highest priority)
  if (config?.paths) {
    const resolved = config.paths.map((p) => (path.isAbsolute(p) ? p : path.resolve(basePath, p)));
    paths.push(...resolved);
  }

  return paths;
}

/**
 * Normalize path separators to forward slashes (POSIX style)
 */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Expand tilde (~) in path to home directory
 */
export function expandTilde(filePath: string): string {
  if (!filePath.startsWith('~')) {
    return filePath;
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) {
    return filePath;
  }

  return path.join(homeDir, filePath.slice(1));
}

// ============================================================================
// File Discovery
// ============================================================================

/**
 * Check if a path exists
 */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory
 */
async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file is a YAML file based on extension
 */
function isYamlFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return YAML_EXTENSIONS.includes(ext);
}

/**
 * Scan a directory for YAML files
 */
async function scanDirectory(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isFile() && isYamlFile(entry.name)) {
        files.push(fullPath);
      } else if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subFiles = await scanDirectory(fullPath);
        files.push(...subFiles);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read - not an error, just skip
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
      // Log other errors if debug is enabled
      // This will be handled by the caller
    }
  }

  return files;
}

/**
 * Discover all YAML files from the given paths
 * Supports both files and directories
 */
export async function discoverFiles(paths: string[]): Promise<string[]> {
  const allFiles: string[] = [];

  for (const targetPath of paths) {
    const exists = await pathExists(targetPath);
    if (!exists) {
      continue;
    }

    const isDir = await isDirectory(targetPath);
    if (isDir) {
      const files = await scanDirectory(targetPath);
      allFiles.push(...files);
    } else if (isYamlFile(targetPath)) {
      allFiles.push(targetPath);
    }
  }

  return allFiles;
}

// ============================================================================
// File Loading & Parsing
// ============================================================================

/**
 * Read and parse a YAML file
 */
async function readYamlFile(filePath: string): Promise<unknown> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseYaml(content);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse YAML: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Load and validate a namespace file
 */
async function loadNamespaceFile(filePath: string): Promise<NamespaceFile | LoadError> {
  try {
    // Read file content
    const content = await fs.readFile(filePath, 'utf-8');

    // Validate with comprehensive validator
    const validationResult = validateActionFile(content, filePath);

    if (!validationResult.success) {
      return {
        type: 'validation_error',
        path: filePath,
        message:
          validationResult.errors && validationResult.errors.length > 0
            ? validationResult.errors[0].message
            : 'Validation failed',
        details: validationResult.errors,
      };
    }

    // Parse YAML and validate against schema
    const data = parseYaml(content);
    const result = NamespaceFileSchema.safeParse(data);

    if (!result.success) {
      return {
        type: 'validation_error',
        path: filePath,
        message: 'Schema validation failed',
        details: result.error.errors,
      };
    }

    return result.data;
  } catch (error) {
    if (error instanceof Error) {
      if ('code' in error && error.code === 'ENOENT') {
        return {
          type: 'file_not_found',
          path: filePath,
          message: `File not found: ${filePath}`,
        };
      }

      return {
        type: 'parse_error',
        path: filePath,
        message: error.message,
        details: error,
      };
    }

    return {
      type: 'io_error',
      path: filePath,
      message: 'Unknown error occurred',
      details: error,
    };
  }
}

/**
 * Load configuration file (_config.yaml) if it exists
 */
async function loadConfigFile(dirPath: string): Promise<ConfigFile | null> {
  const configPath = path.join(dirPath, CONFIG_FILENAME);
  const exists = await pathExists(configPath);

  if (!exists) {
    return null;
  }

  try {
    const data = await readYamlFile(configPath);
    return data as ConfigFile;
  } catch {
    // Ignore invalid config files
    return null;
  }
}

// ============================================================================
// Configuration Inheritance
// ============================================================================

/**
 * Resolve configuration inheritance chain
 * Returns configs in order from parent to child (apply in this order)
 */
async function resolveConfigChain(
  configFile: ConfigFile,
  dirPath: string,
  visited = new Set<string>()
): Promise<ConfigFile[]> {
  const chain: ConfigFile[] = [];

  if (!configFile.extends) {
    return [configFile];
  }

  const parents = Array.isArray(configFile.extends) ? configFile.extends : [configFile.extends];

  for (const parentRef of parents) {
    const parentPath = path.resolve(dirPath, parentRef);

    // Prevent circular references
    const normalizedPath = normalizePath(parentPath);
    if (visited.has(normalizedPath)) {
      continue;
    }
    visited.add(normalizedPath);

    const parentDir = path.dirname(parentPath);
    const parentConfig = await loadConfigFile(parentDir);

    if (parentConfig) {
      const parentChain = await resolveConfigChain(parentConfig, parentDir, visited);
      chain.push(...parentChain);
    }
  }

  chain.push(configFile);
  return chain;
}

/**
 * Apply configuration inheritance and overrides
 */
async function applyConfigToNamespace(
  namespace: NamespaceFile,
  dirPath: string
): Promise<NamespaceFile> {
  const configFile = await loadConfigFile(dirPath);

  if (!configFile) {
    return namespace;
  }

  // Resolve inheritance chain
  const chain = await resolveConfigChain(configFile, dirPath);

  // Apply overrides in order (parent to child)
  let result = { ...namespace };

  for (const config of chain) {
    if (config.selectors) {
      result.selectors = {
        ...result.selectors,
        ...config.selectors,
      };
    }

    // Future: apply other overrides (params, steps, etc.)
  }

  return result;
}

// ============================================================================
// Namespace Conversion
// ============================================================================

/**
 * Convert validated NamespaceFile to NamespaceDefinition
 */
function convertToNamespaceDefinition(
  file: NamespaceFile,
  sourcePath: string
): NamespaceDefinition {
  const actions: Record<string, any> = {};

  // Convert each action
  for (const [actionName, actionDef] of Object.entries(file.actions)) {
    const fullName = `${file.namespace}:${actionName}`;

    actions[actionName] = {
      name: actionName,
      namespace: file.namespace,
      fullName,
      description: actionDef.description,
      since: actionDef.since,
      deprecated: actionDef.deprecated,
      deprecatedMessage: actionDef.deprecated_message,
      aliasOf: actionDef.alias_of,
      params: actionDef.params || {},
      steps: actionDef.steps,
      returns: actionDef.returns,
      verify: actionDef.verify,
      sourcePath,
    };
  }

  // Convert compatibility from snake_case to camelCase
  const compatibility: ActionCompatibility | undefined = file.compatibility
    ? {
        minVersion: file.compatibility.min_version,
        maxVersion: file.compatibility.max_version,
        versionOverrides: file.compatibility.version_overrides
          ? Object.fromEntries(
              Object.entries(file.compatibility.version_overrides).map(([version, override]) => [
                version,
                {
                  selectors: override.selectors,
                  steps: override.steps as Record<string, Partial<ActionStep>> | undefined,
                },
              ])
            )
          : undefined,
      }
    : undefined;

  // Convert selectors to ensure proper typing
  const selectors: Record<string, SelectorDefinition> = {};
  for (const [name, selector] of Object.entries(file.selectors || {})) {
    if (typeof selector === 'string') {
      selectors[name] = selector;
    } else if ('primary' in selector && 'fallback' in selector) {
      selectors[name] = {
        primary: selector.primary,
        fallback: selector.fallback,
      };
    }
  }

  return {
    namespace: file.namespace,
    version: file.version,
    description: file.description,
    compatibility,
    selectors,
    actions,
    sourcePath,
  };
}

// ============================================================================
// Main Loader
// ============================================================================

/**
 * Load all action definitions from configured paths
 */
export async function loadActions(config?: LoaderConfig): Promise<LoadResult> {
  const namespaces = new Map<string, NamespaceDefinition>();
  const errors: LoadError[] = [];
  const warnings: LoadWarning[] = [];

  // Get paths to scan
  const paths = getActionPaths(config);

  if (config?.debug) {
    console.log('[Loader] Scanning paths:', paths);
  }

  // Discover all YAML files
  const files = await discoverFiles(paths);

  if (config?.debug) {
    console.log(`[Loader] Found ${files.length} YAML files`);
  }

  // Load each file
  for (const filePath of files) {
    // Skip config files
    if (path.basename(filePath) === CONFIG_FILENAME) {
      continue;
    }

    if (config?.debug) {
      console.log(`[Loader] Loading: ${filePath}`);
    }

    const result = await loadNamespaceFile(filePath);

    // Handle errors
    if ('type' in result) {
      errors.push(result);
      continue;
    }

    // Apply configuration inheritance
    const dirPath = path.dirname(filePath);
    const withConfig = await applyConfigToNamespace(result, dirPath);

    // Convert to internal format
    const namespace = convertToNamespaceDefinition(withConfig, filePath);

    // Check for duplicate namespace
    if (namespaces.has(namespace.namespace)) {
      const existing = namespaces.get(namespace.namespace)!;
      warnings.push({
        type: 'override',
        path: filePath,
        message: `Namespace '${namespace.namespace}' was already loaded from '${existing.sourcePath}', overriding with this file`,
      });
    }

    // Store namespace (later files override earlier ones)
    namespaces.set(namespace.namespace, namespace);

    // Check for deprecated actions
    for (const action of Object.values(namespace.actions)) {
      if (action.deprecated) {
        warnings.push({
          type: 'deprecated_action',
          path: filePath,
          message: `Action '${action.fullName}' is deprecated${action.deprecatedMessage ? `: ${action.deprecatedMessage}` : ''}`,
        });
      }
    }
  }

  if (config?.debug) {
    console.log(
      `[Loader] Loaded ${namespaces.size} namespaces with ${errors.length} errors and ${warnings.length} warnings`
    );
  }

  return {
    namespaces,
    errors,
    warnings,
  };
}

/**
 * Load a single action definition file
 */
export async function loadActionFile(filePath: string): Promise<NamespaceDefinition | LoadError> {
  const result = await loadNamespaceFile(filePath);

  if ('type' in result) {
    return result;
  }

  // Apply configuration inheritance
  const dirPath = path.dirname(filePath);
  const withConfig = await applyConfigToNamespace(result, dirPath);

  // Convert to internal format
  return convertToNamespaceDefinition(withConfig, filePath);
}

/**
 * Reload actions with the same configuration
 * Useful for hot-reloading during development
 */
export async function reloadActions(config?: LoaderConfig): Promise<LoadResult> {
  // Simply call loadActions again - it will rescan all paths
  return loadActions(config);
}
