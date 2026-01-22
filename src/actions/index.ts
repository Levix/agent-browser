/**
 * Action Service - Main Entry Point
 *
 * This module provides the main service interface for the action system:
 * - Action list/describe/run/validate/search/reload operations
 * - Integration with browser manager and executor
 * - Command handling for daemon protocol
 *
 * @module actions/index
 */

import type { Page } from 'playwright-core';
import type { BrowserManager } from '../browser.js';
import type {
  ActionListData,
  ActionDescribeData,
  ActionRunData,
  ActionValidateData,
  ActionSearchData,
  ActionReloadData,
  ActionDryRunData,
  ActionDebugData,
} from '../types.js';
import type { ActionDefinition, ActionParam } from './types.js';
import { Registry, type SearchOptions } from './registry.js';
import { ActionExecutor, type ExecutorConfig } from './executor.js';
import { loadActions } from './loader.js';
import * as fs from 'fs';
import * as path from 'path';

// Export error handling and debugging utilities
export * from './errors.js';
export * from './debug.js';

// ============================================================================
// Global Registry Instance
// ============================================================================

let globalRegistry: Registry | null = null;

/**
 * Get or create the global registry instance
 */
function getRegistry(): Registry {
  if (!globalRegistry) {
    globalRegistry = new Registry();
    // Load default actions on first access
    loadDefaultActions().catch((err) => {
      console.error('Failed to load default actions:', err);
    });
  }
  return globalRegistry;
}

/**
 * Load default actions from built-in paths
 */
async function loadDefaultActions(): Promise<void> {
  const registry = getRegistry();

  // Default paths to load from (in priority order)
  const defaultPaths: string[] = [];

  // 1. Built-in actions (shipped with package)
  const builtinPath = path.join(__dirname, '../../actions');
  if (fs.existsSync(builtinPath)) {
    defaultPaths.push(builtinPath);
  }

  // 2. User global config (~/.agent-browser/actions/)
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    const userActionsPath = path.join(homeDir, '.agent-browser', 'actions');
    if (fs.existsSync(userActionsPath)) {
      defaultPaths.push(userActionsPath);
    }
  }

  // 3. Project-local actions (./.agent-browser/actions/)
  const projectActionsPath = path.join(process.cwd(), '.agent-browser', 'actions');
  if (fs.existsSync(projectActionsPath)) {
    defaultPaths.push(projectActionsPath);
  }

  // 4. Environment variable paths
  const envPaths = process.env.AGENT_BROWSER_ACTIONS_PATH;
  if (envPaths) {
    defaultPaths.push(...envPaths.split(path.delimiter).filter((p) => fs.existsSync(p)));
  }

  // Load from all paths
  if (defaultPaths.length > 0) {
    const result = await loadActions({ paths: defaultPaths });

    // Merge loaded namespaces into registry
    for (const [name, namespace] of result.namespaces) {
      // The Registry.load() method already handles merging
    }

    await registry.load();
  }
}

/**
 * Reset the global registry (for testing)
 */
export function resetRegistry(): void {
  globalRegistry = null;
}

// ============================================================================
// Service API
// ============================================================================

/**
 * List all available actions
 *
 * @param namespace - Optional namespace to filter by
 * @returns Action list data
 */
export async function listActions(namespace?: string): Promise<ActionListData> {
  const registry = getRegistry();
  const allActions = namespace
    ? registry.getActionsByNamespace(namespace)
    : registry.getAllActions();

  // Get unique namespaces
  const namespaces = new Set<string>();
  const actions: ActionListData['actions'] = [];

  for (const action of allActions) {
    namespaces.add(action.namespace);

    // Filter by namespace if specified
    if (namespace && action.namespace !== namespace) {
      continue;
    }

    actions.push({
      namespace: action.namespace,
      name: action.name,
      description: action.description,
      fullName: action.fullName,
    });
  }

  return {
    namespaces: Array.from(namespaces).sort(),
    actions: actions.sort((a, b) => a.fullName.localeCompare(b.fullName)),
  };
}

/**
 * Describe a specific action
 *
 * @param name - Action name (can be full name with namespace or just action name)
 * @returns Action description data
 */
export async function describeAction(name: string): Promise<ActionDescribeData> {
  const registry = getRegistry();
  const action = registry.getAction(name);

  if (!action) {
    throw new Error(`Action not found: ${name}`);
  }

  return {
    namespace: action.namespace,
    name: action.name,
    version: action.since || '1.0.0',
    description: action.description,
    params: Object.entries(action.params || {}).map(([name, p]: [string, ActionParam]) => ({
      name,
      type: p.type,
      required: p.required ?? false,
      default: p.default,
      description: p.description,
    })),
    selectors: {}, // Selectors are at namespace level, not action level
    steps: action.steps,
    compatibility: action.compatibility
      ? {
          min_version: action.compatibility.minVersion,
          max_version: action.compatibility.maxVersion,
        }
      : undefined,
    sourcePath: action.sourcePath || 'unknown',
  };
}

/**
 * Run an action
 *
 * @param name - Action name
 * @param params - Action parameters
 * @param page - Playwright page instance
 * @param options - Execution options
 * @returns Action execution result
 */
export async function runAction(
  name: string,
  params: Record<string, unknown> | undefined,
  page: Page,
  options?: ExecutorConfig
): Promise<ActionRunData> {
  const registry = getRegistry();
  const action = registry.getAction(name);

  if (!action) {
    throw new Error(`Action not found: ${name}`);
  }

  const startTime = Date.now();
  const executor = new ActionExecutor(options);
  executor.setPage(page);
  executor.setRegistry(registry['registry']); // Access internal registry

  try {
    const result = await executor.execute(action, params || {});
    const executionTime = Date.now() - startTime;

    return {
      success: result.success,
      result: result.data,
      error: result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            step: result.error.step,
            details: result.error.details,
          }
        : undefined,
      executionTime,
      steps: result.trace?.map((t: any) => ({
        action: t.action,
        status: t.success ? 'success' : 'failed',
        duration: t.endTime - t.startTime,
        output: t.output,
      })),
    };
  } catch (err) {
    const executionTime = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    return {
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message,
        details: { error: err },
      },
      executionTime,
    };
  }
}

/**
 * Validate an action definition file
 *
 * @param filePath - Path to YAML file to validate
 * @returns Validation result
 */
export async function validateAction(filePath: string): Promise<ActionValidateData> {
  try {
    // Load and parse the file
    const result = await loadActions({
      paths: [filePath],
    });

    // Check for errors
    if (result.errors.length > 0) {
      return {
        valid: false,
        errors: result.errors.map((e: any) => ({
          path: e.path || filePath,
          message: e.message,
          code: 'VALIDATION_ERROR',
        })),
        warnings: result.warnings.map((w: any) => ({
          path: w.path || filePath,
          message: w.message,
        })),
      };
    }

    return {
      valid: true,
      warnings:
        result.warnings.length > 0
          ? result.warnings.map((w: any) => ({
              path: w.path || filePath,
              message: w.message,
            }))
          : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [
        {
          path: filePath,
          message,
          code: 'LOAD_ERROR',
        },
      ],
    };
  }
}

/**
 * Search for actions by keyword
 *
 * @param keyword - Search keyword
 * @param options - Search options
 * @returns Search results
 */
export async function searchActions(
  keyword: string,
  options?: SearchOptions
): Promise<ActionSearchData> {
  const registry = getRegistry();
  const matches = registry.search(keyword, options);

  return {
    matches: matches.map((m: any) => ({
      namespace: m.action.namespace,
      name: m.action.name,
      fullName: m.action.fullName,
      description: m.action.description,
      score: m.score,
    })),
    total: matches.length,
  };
}

/**
 * Reload all action definitions
 *
 * @returns Reload result
 */
export async function reloadActions(): Promise<ActionReloadData> {
  // Clear the global registry
  globalRegistry = null;

  // Create a new registry and load defaults
  const registry = getRegistry();
  await loadDefaultActions();

  const allActions = registry.getAllActions();
  const namespaces = new Set<string>();

  for (const action of allActions) {
    namespaces.add(action.namespace);
  }

  return {
    loaded: allActions.length,
    namespaces: Array.from(namespaces).sort(),
    actions: allActions.length,
  };
}

/**
 * Perform a dry run of an action
 *
 * @param name - Action name
 * @param params - Action parameters
 * @returns Dry run result
 */
export async function dryRun(
  name: string,
  params: Record<string, unknown> | undefined
): Promise<ActionDryRunData> {
  const registry = getRegistry();
  const action = registry.getAction(name);

  if (!action) {
    throw new Error(`Action not found: ${name}`);
  }

  try {
    // Simple dry run - just list the steps
    const plan = action.steps.map((s: any, idx: number) => ({
      step: idx + 1,
      action: s.action,
      args: s.args || {},
      condition: s.when,
    }));

    // Collect expected variables from steps
    const expectedVariables: string[] = [];
    const paramsNames = Object.keys(action.params || {});
    expectedVariables.push(...paramsNames.map((p) => `params.${p}`));

    return {
      valid: true,
      plan,
      expectedVariables,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      plan: [],
      expectedVariables: [],
      warnings: [message],
    };
  }
}

/**
 * Debug an action execution
 *
 * @param name - Action name
 * @param params - Action parameters
 * @param page - Playwright page instance
 * @returns Debug trace data
 */
export async function debugAction(
  name: string,
  params: Record<string, unknown> | undefined,
  page: Page
): Promise<ActionDebugData> {
  const registry = getRegistry();
  const action = registry.getAction(name);

  if (!action) {
    throw new Error(`Action not found: ${name}`);
  }

  const startTime = Date.now();
  const executor = new ActionExecutor({ debugMode: true });
  executor.setPage(page);
  executor.setRegistry(registry['registry']); // Access internal registry

  try {
    const result = await executor.execute(action, params || {});
    const executionTime = Date.now() - startTime;

    return {
      success: result.success,
      result: result.data,
      trace:
        result.trace?.map((t: any, idx: number) => ({
          step: idx + 1,
          action: t.action,
          args: t.args || {},
          status: t.success ? 'success' : 'failed',
          duration: t.endTime - t.startTime,
          context: {}, // Context not exposed in trace
          error: t.error,
        })) || [],
      finalContext: {}, // Final context not exposed in result
      executionTime,
    };
  } catch (err) {
    const executionTime = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    return {
      success: false,
      trace: [],
      finalContext: {},
      executionTime,
    };
  }
}

// ============================================================================
// Browser Integration
// ============================================================================

/**
 * Execute an action command with browser context
 *
 * @param name - Action name
 * @param params - Action parameters
 * @param browser - Browser manager instance
 * @returns Action execution result
 */
export async function executeActionCommand(
  name: string,
  params: Record<string, unknown> | undefined,
  browser: BrowserManager
): Promise<ActionRunData> {
  const page = browser.getPage();
  if (!page) {
    throw new Error('No active page. Please launch browser first.');
  }

  return runAction(name, params, page);
}
