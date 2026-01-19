/**
 * Version detection and compatibility management
 *
 * This module provides:
 * - Component version detection from web pages
 * - Compatibility checking between actions and component versions
 * - Version-specific selector overrides application
 *
 * @module actions/version
 */

import * as semver from 'semver';
import type { Page } from 'playwright';
import type {
  ActionDefinition,
  NamespaceDefinition,
  ActionCompatibility,
  VersionOverride,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Version detection strategy configuration
 */
export interface VersionDetectionConfig {
  /** Namespace to detect version for */
  namespace: string;

  /** JavaScript expression to evaluate for version (e.g., "window.__ERESH_VERSION__") */
  versionScript?: string;

  /** CSS selector to query for version (in meta tag or data attribute) */
  versionSelector?: string;

  /** Meta tag name containing version (e.g., "eresh:version") */
  versionMeta?: string;

  /** Custom detection function */
  customDetector?: (page: Page) => Promise<string | null>;
}

/**
 * Result of version detection
 */
export interface VersionDetectionResult {
  /** Detected version (normalized to semver) */
  version: string | null;

  /** Detection method used */
  method: 'script' | 'selector' | 'meta' | 'custom' | 'fallback' | 'none';

  /** Raw detected value before normalization */
  raw?: string;
}

// ============================================================================
// Version Detection
// ============================================================================

/**
 * Detect component version from a web page
 *
 * Tries multiple strategies in order:
 * 1. Custom detector (if provided)
 * 2. JavaScript evaluation (versionScript)
 * 3. Element query (versionSelector)
 * 4. Meta tag query (versionMeta)
 *
 * @param page Playwright page instance
 * @param config Detection configuration
 * @returns Detected version or null
 */
export async function detectVersion(
  page: Page,
  config: VersionDetectionConfig
): Promise<VersionDetectionResult> {
  // Try custom detector first
  if (config.customDetector) {
    try {
      const version = await config.customDetector(page);
      if (version) {
        const normalized = normalizeVersion(version);
        return {
          version: normalized,
          method: 'custom',
          raw: version,
        };
      }
    } catch (error) {
      // Fall through to other methods
      console.warn(`Custom detector failed for ${config.namespace}:`, error);
    }
  }

  // Try versionScript (e.g., window.__ERESH_VERSION__)
  if (config.versionScript) {
    try {
      const raw = await page.evaluate((script) => {
        try {
          // eslint-disable-next-line no-eval
          return eval(script);
        } catch {
          return null;
        }
      }, config.versionScript);

      if (raw && typeof raw === 'string') {
        const normalized = normalizeVersion(raw);
        return {
          version: normalized,
          method: 'script',
          raw,
        };
      }
    } catch (error) {
      console.warn(`Script evaluation failed for ${config.namespace}:`, error);
    }
  }

  // Try versionSelector (query element and get text/attribute)
  if (config.versionSelector) {
    try {
      // Use string template to avoid TypeScript checking browser APIs in Node context
      const selectorScript = `
        (function(selector) {
          const element = document.querySelector(selector);
          if (!element) return null;
          
          // Try data-version attribute first
          const dataVersion = element.getAttribute('data-version');
          if (dataVersion) return dataVersion;
          
          // Try version attribute
          const version = element.getAttribute('version');
          if (version) return version;
          
          // Try text content
          const text = element.textContent?.trim();
          if (text) return text;
          
          return null;
        })(${JSON.stringify(config.versionSelector)})
      `;
      const raw = await page.evaluate(selectorScript);

      if (raw && typeof raw === 'string') {
        const normalized = normalizeVersion(raw);
        return {
          version: normalized,
          method: 'selector',
          raw,
        };
      }
    } catch (error) {
      console.warn(`Selector query failed for ${config.namespace}:`, error);
    }
  }

  // Try versionMeta (query meta tag)
  if (config.versionMeta) {
    try {
      // Use string template to avoid TypeScript checking browser APIs in Node context
      const metaScript = `
        (function(metaName) {
          // Try by name attribute
          let meta = document.querySelector('meta[name="' + metaName + '"]');
          if (meta) return meta.getAttribute('content');
          
          // Try by property attribute (for OpenGraph style)
          meta = document.querySelector('meta[property="' + metaName + '"]');
          if (meta) return meta.getAttribute('content');
          
          return null;
        })(${JSON.stringify(config.versionMeta)})
      `;
      const raw = await page.evaluate(metaScript);

      if (raw && typeof raw === 'string') {
        const normalized = normalizeVersion(raw);
        return {
          version: normalized,
          method: 'meta',
          raw,
        };
      }
    } catch (error) {
      console.warn(`Meta query failed for ${config.namespace}:`, error);
    }
  }

  // No version detected
  return {
    version: null,
    method: 'none',
  };
}

/**
 * Normalize version string to semver format
 *
 * Handles various version formats:
 * - "4.2.1" -> "4.2.1"
 * - "v4.2.1" -> "4.2.1"
 * - "4.2" -> "4.2.0"
 * - "4" -> "4.0.0"
 *
 * @param raw Raw version string
 * @returns Normalized semver string or null
 */
export function normalizeVersion(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;

  // Remove common prefixes
  const cleaned = raw.trim().replace(/^v/i, '');

  // Try to coerce to semver
  const coerced = semver.coerce(cleaned);
  if (coerced) {
    return coerced.version;
  }

  return null;
}

// ============================================================================
// Compatibility Checking
// ============================================================================

/**
 * Check if a version is compatible with the specified constraints
 *
 * @param version Version to check
 * @param compatibility Compatibility constraints
 * @returns True if compatible
 */
export function isVersionCompatible(version: string, compatibility?: ActionCompatibility): boolean {
  if (!compatibility) return true;
  if (!version) return true; // If no version detected, assume compatible

  const normalized = normalizeVersion(version);
  if (!normalized) return true; // If version can't be normalized, assume compatible

  // Check minimum version
  if (compatibility.minVersion) {
    const min = normalizeVersion(compatibility.minVersion);
    if (min && semver.lt(normalized, min)) {
      return false;
    }
  }

  // Check maximum version
  if (compatibility.maxVersion) {
    const max = normalizeVersion(compatibility.maxVersion);
    if (max && semver.gt(normalized, max)) {
      return false;
    }
  }

  return true;
}

/**
 * Match version against a pattern
 *
 * Supports:
 * - Exact match: "4.2.1"
 * - Major version: "4.x"
 * - Semver range: ">=4.2.0", "~4.2.0", "^4.2.0"
 *
 * @param version Version to check
 * @param pattern Pattern to match
 * @returns True if matches
 */
export function matchVersion(version: string, pattern: string): boolean {
  const normalized = normalizeVersion(version);
  if (!normalized) return false;

  // Handle "x" wildcard (e.g., "4.x")
  if (pattern.includes('x') || pattern.includes('X')) {
    const parts = pattern.toLowerCase().split('.');
    const versionParts = normalized.split('.');

    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'x') continue;
      if (parts[i] !== versionParts[i]) return false;
    }

    return true;
  }

  // Try semver range matching
  try {
    return semver.satisfies(normalized, pattern);
  } catch {
    // If pattern is invalid, try exact match
    const patternNormalized = normalizeVersion(pattern);
    return patternNormalized === normalized;
  }
}

// ============================================================================
// Version Overrides
// ============================================================================

/**
 * Apply version-specific overrides to an action definition
 *
 * Creates a new action definition with selectors overridden based on
 * the detected component version.
 *
 * @param action Original action definition
 * @param namespace Namespace definition (contains version overrides)
 * @param detectedVersion Detected component version
 * @returns Action with applied overrides (or original if no overrides)
 */
export function applyVersionOverrides(
  action: ActionDefinition,
  namespace: NamespaceDefinition,
  detectedVersion: string | null
): ActionDefinition {
  if (!detectedVersion) return action;
  if (!namespace.compatibility?.versionOverrides) return action;

  // Collect all matching overrides
  const matchingOverrides: VersionOverride[] = [];
  for (const [pattern, override] of Object.entries(namespace.compatibility.versionOverrides)) {
    if (matchVersion(detectedVersion, pattern)) {
      matchingOverrides.push(override);
    }
  }

  if (matchingOverrides.length === 0) return action;

  // Merge all matching selector overrides
  const mergedSelectors: Record<string, string> = {};
  for (const override of matchingOverrides) {
    if (override.selectors) {
      Object.assign(mergedSelectors, override.selectors);
    }
  }

  if (Object.keys(mergedSelectors).length === 0) return action;

  // Clone action and apply selector overrides
  const overriddenAction: ActionDefinition = {
    ...action,
    steps: action.steps.map((step) => {
      // Check if this step has a selector argument
      if (!step.args?.selector) return step;

      const selector = step.args.selector as string;

      // Check if this selector is an alias reference
      const selectorAlias = extractSelectorAlias(selector);
      if (!selectorAlias) return step;

      const overrideSelector = mergedSelectors[selectorAlias];
      if (!overrideSelector) return step;

      // Replace the selector in args
      return {
        ...step,
        args: {
          ...step.args,
          selector: overrideSelector,
        },
      };
    }),
  };

  return overriddenAction;
}

/**
 * Extract selector alias from a selector string
 *
 * If selector starts with "$", it's an alias (e.g., "$dialog.closeBtn")
 * Otherwise, it's a literal selector
 *
 * @param selector Selector string
 * @returns Alias name or null
 */
function extractSelectorAlias(selector: string): string | null {
  if (!selector.startsWith('$')) return null;

  // Remove leading "$" and extract alias name
  // Support nested references like "$dialog.closeBtn" -> "dialog.closeBtn"
  return selector.substring(1);
}

// ============================================================================
// Pluggable Detection Strategies
// ============================================================================

/**
 * Registry for custom version detection strategies
 */
const detectionStrategies = new Map<string, VersionDetectionConfig>();

/**
 * Register a custom version detection strategy for a namespace
 *
 * @param namespace Namespace identifier
 * @param config Detection configuration
 */
export function registerDetectionStrategy(
  namespace: string,
  config: Omit<VersionDetectionConfig, 'namespace'>
): void {
  detectionStrategies.set(namespace, {
    namespace,
    ...config,
  });
}

/**
 * Get detection configuration for a namespace
 *
 * Returns registered strategy or a default one based on common conventions
 *
 * @param namespace Namespace identifier
 * @returns Detection configuration
 */
export function getDetectionConfig(namespace: string): VersionDetectionConfig {
  // Return registered strategy if exists
  const registered = detectionStrategies.get(namespace);
  if (registered) return registered;

  // Return default strategy based on namespace
  return {
    namespace,
    versionScript: `window.__${namespace.toUpperCase()}_VERSION__`,
    versionMeta: `${namespace}:version`,
    versionSelector: `[data-${namespace}-version]`,
  };
}

/**
 * Detect version for a namespace using registered or default strategy
 *
 * Convenience wrapper around detectVersion() that automatically
 * retrieves the appropriate detection configuration.
 *
 * @param page Playwright page instance
 * @param namespace Namespace identifier
 * @returns Detection result
 */
export async function detectComponentVersion(
  page: Page,
  namespace: string
): Promise<VersionDetectionResult> {
  const config = getDetectionConfig(namespace);
  return detectVersion(page, config);
}

// ============================================================================
// High-Level Integration Functions
// ============================================================================

/**
 * Get compatible action definition with version-specific overrides applied
 *
 * This is a convenience function that combines:
 * 1. Version detection from the page
 * 2. Compatibility checking
 * 3. Version override application
 *
 * @param page Playwright page instance
 * @param action Action definition to check
 * @param namespace Namespace definition
 * @returns Compatible action with overrides, or null if incompatible
 */
export async function getCompatibleAction(
  page: Page,
  action: ActionDefinition,
  namespace: NamespaceDefinition
): Promise<ActionDefinition | null> {
  // Detect version from page
  const detection = await detectComponentVersion(page, namespace.namespace);
  const detectedVersion = detection.version;

  // Check if action is compatible with detected version
  if (detectedVersion && action.compatibility) {
    const compatible = isVersionCompatible(detectedVersion, action.compatibility);
    if (!compatible) {
      return null;
    }
  }

  // Apply version-specific overrides
  const actionWithOverrides = applyVersionOverrides(action, namespace, detectedVersion);

  return actionWithOverrides;
}

/**
 * Check if namespace is compatible with detected page version
 *
 * @param page Playwright page instance
 * @param namespace Namespace definition
 * @returns True if compatible or no constraints specified
 */
export async function isNamespaceCompatible(
  page: Page,
  namespace: NamespaceDefinition
): Promise<boolean> {
  if (!namespace.compatibility) return true;

  const detection = await detectComponentVersion(page, namespace.namespace);
  if (!detection.version) return true; // Assume compatible if can't detect

  return isVersionCompatible(detection.version, namespace.compatibility);
}

/**
 * Select the best matching action from multiple candidates based on version
 *
 * Useful when you have multiple versions of the same action for different
 * component versions. Returns the first compatible action with the highest
 * version specificity.
 *
 * @param page Playwright page instance
 * @param actions Array of action candidates
 * @param namespace Namespace definition
 * @returns Best matching action or null if none compatible
 */
export async function selectBestAction(
  page: Page,
  actions: ActionDefinition[],
  namespace: NamespaceDefinition
): Promise<ActionDefinition | null> {
  const detection = await detectComponentVersion(page, namespace.namespace);
  const detectedVersion = detection.version;

  if (!detectedVersion) {
    // No version detected, return first action without constraints
    return actions.find((a) => !a.compatibility) || actions[0] || null;
  }

  // Filter compatible actions
  const compatibleActions = actions.filter((action) => {
    if (!action.compatibility) return true;
    return isVersionCompatible(detectedVersion, action.compatibility);
  });

  if (compatibleActions.length === 0) return null;

  // Sort by specificity (more constraints = more specific)
  const scored = compatibleActions.map((action) => {
    let specificity = 0;
    if (action.compatibility?.minVersion) specificity++;
    if (action.compatibility?.maxVersion) specificity++;
    if (action.compatibility?.versionOverrides) {
      specificity += Object.keys(action.compatibility.versionOverrides).length;
    }
    return { action, specificity };
  });

  scored.sort((a, b) => b.specificity - a.specificity);

  // Apply overrides to the best match
  return applyVersionOverrides(scored[0].action, namespace, detectedVersion);
}

// ============================================================================
// Exports
// ============================================================================

// All types are already exported at their definition sites
