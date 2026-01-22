/**
 * Action Registry - Merge and Index Management
 *
 * This module provides the ActionRegistry class which manages:
 * - Merging action definitions from multiple sources
 * - Building and maintaining action indexes
 * - Searching and querying actions
 *
 * Merge Rules:
 * - Later-loaded definitions override earlier ones
 * - Same-named actions are replaced (last wins)
 * - Same-named selectors are replaced (last wins)
 * - Source paths are tracked for debugging
 */

import type {
  ActionRegistry,
  NamespaceDefinition,
  ActionDefinition,
  SelectorDefinition,
} from './types.js';
import { loadActions, type LoaderConfig, type LoadResult } from './loader.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Search options for action queries
 */
export interface SearchOptions {
  /** Search in action names */
  searchNames?: boolean;

  /** Search in descriptions */
  searchDescriptions?: boolean;

  /** Search in parameter names and descriptions */
  searchParams?: boolean;

  /** Case-sensitive search */
  caseSensitive?: boolean;

  /** Filter by namespace */
  namespace?: string;

  /** Maximum number of results */
  limit?: number;
}

/**
 * Action search result
 */
export interface SearchResult {
  /** Matched action */
  action: ActionDefinition;

  /** Match score (higher is better) */
  score: number;

  /** Match highlights */
  matches: string[];
}

// ============================================================================
// Registry Class
// ============================================================================

/**
 * Main registry class for managing action definitions
 */
export class Registry {
  private registry: ActionRegistry;
  private config?: LoaderConfig;

  constructor(config?: LoaderConfig) {
    this.config = config;
    this.registry = {
      namespaces: new Map(),
      index: new Map(),
    };
  }

  // ==========================================================================
  // Loading and Merging
  // ==========================================================================

  /**
   * Load and merge action definitions from all configured sources
   *
   * Merge rules:
   * - Later-loaded files override earlier ones
   * - Same namespace: merge actions and selectors
   * - Same action name: replace entire action
   * - Same selector name: replace selector
   */
  async load(): Promise<LoadResult> {
    const result = await loadActions(this.config);

    // Clear existing registry
    this.registry.namespaces.clear();
    this.registry.index.clear();

    // Merge loaded namespaces
    for (const [name, namespace] of result.namespaces) {
      this.mergeNamespace(namespace);
    }

    // Build action index
    this.buildIndex();

    return result;
  }

  /**
   * Merge a namespace into the registry
   *
   * Rules:
   * - If namespace doesn't exist: add it directly
   * - If namespace exists: merge actions and selectors
   *   - Later actions override earlier ones
   *   - Later selectors override earlier ones
   *   - Update sourcePath to track most recent source
   */
  private mergeNamespace(namespace: NamespaceDefinition): void {
    const existing = this.registry.namespaces.get(namespace.namespace);

    if (!existing) {
      // New namespace - add directly
      this.registry.namespaces.set(namespace.namespace, namespace);
      return;
    }

    // Merge selectors (later wins)
    const mergedSelectors = {
      ...existing.selectors,
      ...namespace.selectors,
    };

    // Merge actions (later wins)
    const mergedActions = {
      ...existing.actions,
      ...namespace.actions,
    };

    // Update namespace with merged data
    // Use newer version and description if available
    const merged: NamespaceDefinition = {
      namespace: namespace.namespace,
      version: namespace.version || existing.version,
      description: namespace.description || existing.description,
      compatibility: namespace.compatibility || existing.compatibility,
      selectors: mergedSelectors,
      actions: mergedActions,
      sourcePath: namespace.sourcePath, // Track most recent source
    };

    this.registry.namespaces.set(namespace.namespace, merged);
  }

  /**
   * Build action index for fast lookups
   * Index structure: namespace:component:action -> ActionDefinition
   */
  private buildIndex(): void {
    this.registry.index.clear();

    for (const namespace of this.registry.namespaces.values()) {
      for (const action of Object.values(namespace.actions)) {
        this.registry.index.set(action.fullName, action);
      }
    }
  }

  /**
   * Reload actions (convenience method)
   */
  async reload(): Promise<LoadResult> {
    return this.load();
  }

  /**
   * Register a namespace directly (useful for testing)
   */
  registerNamespace(namespace: NamespaceDefinition): void {
    this.mergeNamespace(namespace);
    this.buildIndex();
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  /**
   * Get all namespaces
   */
  getNamespaces(): Map<string, NamespaceDefinition> {
    return new Map(this.registry.namespaces);
  }

  /**
   * Get a specific namespace by name
   */
  getNamespace(name: string): NamespaceDefinition | undefined {
    return this.registry.namespaces.get(name);
  }

  /**
   * Get all actions across all namespaces
   */
  getAllActions(): ActionDefinition[] {
    return Array.from(this.registry.index.values());
  }

  /**
   * Get actions in a specific namespace
   */
  getActionsByNamespace(namespace: string): ActionDefinition[] {
    const ns = this.registry.namespaces.get(namespace);
    if (!ns) {
      return [];
    }

    return Object.values(ns.actions);
  }

  /**
   * Get an action by fully qualified name
   * @param fullName - Format: "namespace:component:action" or "namespace:action"
   */
  getAction(fullName: string): ActionDefinition | undefined {
    return this.registry.index.get(fullName);
  }

  /**
   * Get selectors for a namespace
   */
  getSelectors(namespace: string): Record<string, SelectorDefinition> {
    const ns = this.registry.namespaces.get(namespace);
    return ns?.selectors || {};
  }

  /**
   * Get a specific selector
   */
  getSelector(namespace: string, selectorName: string): SelectorDefinition | undefined {
    const ns = this.registry.namespaces.get(namespace);
    return ns?.selectors[selectorName];
  }

  /**
   * Check if an action exists
   */
  hasAction(fullName: string): boolean {
    return this.registry.index.has(fullName);
  }

  /**
   * Check if a namespace exists
   */
  hasNamespace(namespace: string): boolean {
    return this.registry.namespaces.has(namespace);
  }

  /**
   * Get statistics about the registry
   */
  getStats(): {
    namespaceCount: number;
    actionCount: number;
    selectorCount: number;
  } {
    let selectorCount = 0;
    for (const ns of this.registry.namespaces.values()) {
      selectorCount += Object.keys(ns.selectors).length;
    }

    return {
      namespaceCount: this.registry.namespaces.size,
      actionCount: this.registry.index.size,
      selectorCount,
    };
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  /**
   * Search for actions by keyword
   *
   * Searches in:
   * - Action names (if searchNames is true)
   * - Action descriptions (if searchDescriptions is true)
   * - Parameter names and descriptions (if searchParams is true)
   *
   * Returns results sorted by relevance score
   */
  search(keyword: string, options: SearchOptions = {}): SearchResult[] {
    const {
      searchNames = true,
      searchDescriptions = true,
      searchParams = true,
      caseSensitive = false,
      namespace,
      limit,
    } = options;

    const searchTerm = caseSensitive ? keyword : keyword.toLowerCase();
    const results: SearchResult[] = [];

    // Get actions to search
    const actions = namespace ? this.getActionsByNamespace(namespace) : this.getAllActions();

    for (const action of actions) {
      const matches: string[] = [];
      let score = 0;

      // Helper to check and normalize text
      const normalize = (text: string) => (caseSensitive ? text : text.toLowerCase());

      // Search in action name
      if (searchNames) {
        const name = normalize(action.name);
        const fullName = normalize(action.fullName);

        if (name.includes(searchTerm)) {
          score += 10;
          matches.push(`name: ${action.name}`);
        } else if (fullName.includes(searchTerm)) {
          score += 8;
          matches.push(`fullName: ${action.fullName}`);
        }
      }

      // Search in description
      if (searchDescriptions && action.description) {
        const description = normalize(action.description);
        if (description.includes(searchTerm)) {
          score += 5;
          matches.push(`description: ${action.description}`);
        }
      }

      // Search in parameters
      if (searchParams) {
        for (const [paramName, param] of Object.entries(action.params)) {
          const name = normalize(paramName);
          const desc = param.description ? normalize(param.description) : '';

          if (name.includes(searchTerm)) {
            score += 3;
            matches.push(`param: ${paramName}`);
          } else if (desc.includes(searchTerm)) {
            score += 2;
            matches.push(`param.description: ${paramName}`);
          }
        }
      }

      // Add to results if matched
      if (score > 0) {
        results.push({
          action,
          score,
          matches,
        });
      }
    }

    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    // Apply limit if specified
    if (limit && limit > 0) {
      return results.slice(0, limit);
    }

    return results;
  }

  // ==========================================================================
  // Debugging
  // ==========================================================================

  /**
   * Get debug information about the registry
   */
  getDebugInfo(): {
    namespaces: Array<{
      name: string;
      version: string;
      actionCount: number;
      selectorCount: number;
      sourcePath: string;
    }>;
    actions: Array<{
      fullName: string;
      namespace: string;
      sourcePath: string;
      deprecated: boolean;
    }>;
  } {
    const namespaces = Array.from(this.registry.namespaces.values()).map((ns) => ({
      name: ns.namespace,
      version: ns.version,
      actionCount: Object.keys(ns.actions).length,
      selectorCount: Object.keys(ns.selectors).length,
      sourcePath: ns.sourcePath,
    }));

    const actions = Array.from(this.registry.index.values()).map((action) => ({
      fullName: action.fullName,
      namespace: action.namespace,
      sourcePath: action.sourcePath,
      deprecated: action.deprecated || false,
    }));

    return {
      namespaces,
      actions,
    };
  }

  /**
   * Get raw registry (for testing/debugging)
   */
  getRawRegistry(): ActionRegistry {
    return this.registry;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new registry instance
 */
export function createRegistry(config?: LoaderConfig): Registry {
  return new Registry(config);
}

/**
 * Create and load a registry in one step
 */
export async function createAndLoadRegistry(config?: LoaderConfig): Promise<{
  registry: Registry;
  result: LoadResult;
}> {
  const registry = createRegistry(config);
  const result = await registry.load();

  return { registry, result };
}
