/**
 * Selector fallback and retry mechanism
 *
 * This module provides:
 * - Primary/fallback selector chain support
 * - Automatic retry with selector degradation on failure
 * - Integration with version-specific selector overrides
 * - Detailed error reporting and fallback tracing
 *
 * @module actions/selectors
 */

import type { Page, Locator } from 'playwright';
import type { SelectorDefinition, SelectorWithFallback } from './types.js';
import { ActionErrorCode } from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Selector execution options
 */
export interface SelectorExecutionOptions {
  /** Timeout for each selector attempt (milliseconds, default: 5000) */
  timeout?: number;

  /** Whether to throw error if all selectors fail (default: true) */
  throwOnFailure?: boolean;

  /** Debug mode - log each attempt */
  debugMode?: boolean;

  /** Maximum number of fallback attempts (default: unlimited) */
  maxFallbacks?: number;
}

/**
 * Result of selector execution
 */
export interface SelectorExecutionResult {
  /** Whether a selector succeeded */
  success: boolean;

  /** The locator that succeeded (if any) */
  locator?: Locator;

  /** Selector string that succeeded */
  selector?: string;

  /** Index of selector that succeeded (0 = primary, 1+ = fallback) */
  selectorIndex?: number;

  /** All attempted selectors */
  attempted: string[];

  /** Errors for each attempted selector */
  errors: Array<{ selector: string; error: string }>;

  /** Total execution time (milliseconds) */
  executionTime: number;
}

/**
 * Error thrown when all selectors fail
 */
export class SelectorFallbackError extends Error {
  code: ActionErrorCode = ActionErrorCode.ELEMENT_NOT_FOUND;
  attempted: string[];
  errors: Array<{ selector: string; error: string }>;
  executionTime: number;

  constructor(
    message: string,
    attempted: string[],
    errors: Array<{ selector: string; error: string }>,
    executionTime: number
  ) {
    super(message);
    this.name = 'SelectorFallbackError';
    this.attempted = attempted;
    this.errors = errors;
    this.executionTime = executionTime;
  }
}

// ============================================================================
// Selector Normalization
// ============================================================================

/**
 * Normalize selector definition to a fallback chain
 *
 * @param definition - Selector definition (string or object with fallback)
 * @returns Array of selectors [primary, ...fallbacks]
 */
export function normalizeSelectorDefinition(definition: SelectorDefinition): string[] {
  if (typeof definition === 'string') {
    return [definition];
  }

  const chain: string[] = [definition.primary];
  if (definition.fallback && definition.fallback.length > 0) {
    chain.push(...definition.fallback);
  }

  return chain;
}

/**
 * Check if a selector definition has fallbacks
 *
 * @param definition - Selector definition
 * @returns True if fallbacks exist
 */
export function hasFallbacks(definition: SelectorDefinition): boolean {
  if (typeof definition === 'string') {
    return false;
  }
  return definition.fallback && definition.fallback.length > 0;
}

// ============================================================================
// Selector Execution with Fallback
// ============================================================================

/**
 * Execute a selector with automatic fallback on failure
 *
 * Tries the primary selector first, then attempts each fallback selector
 * in order until one succeeds or all fail.
 *
 * @param page - Playwright page instance
 * @param definition - Selector definition (string or with fallback chain)
 * @param options - Execution options
 * @returns Execution result with locator if successful
 *
 * @example
 * ```typescript
 * const result = await executeWithFallback(page, {
 *   primary: '[data-testid="submit"]',
 *   fallback: ['button.submit', 'button:has-text("Submit")']
 * });
 *
 * if (result.success) {
 *   await result.locator!.click();
 * }
 * ```
 */
export async function executeWithFallback(
  page: Page,
  definition: SelectorDefinition,
  options: SelectorExecutionOptions = {}
): Promise<SelectorExecutionResult> {
  const startTime = Date.now();
  const { timeout = 5000, throwOnFailure = true, debugMode = false, maxFallbacks } = options;

  const selectors = normalizeSelectorDefinition(definition);
  const attempted: string[] = [];
  const errors: Array<{ selector: string; error: string }> = [];

  // Determine how many selectors to try
  const maxAttempts =
    maxFallbacks !== undefined
      ? Math.min(selectors.length, maxFallbacks + 1) // +1 for primary
      : selectors.length;

  for (let i = 0; i < maxAttempts; i++) {
    const selector = selectors[i];
    attempted.push(selector);

    if (debugMode) {
      console.log(`[Selector] Attempting ${i === 0 ? 'primary' : `fallback #${i}`}: ${selector}`);
    }

    try {
      const locator = page.locator(selector);

      // Wait for element to exist and be visible
      await locator.waitFor({ state: 'visible', timeout });

      const executionTime = Date.now() - startTime;

      if (debugMode) {
        console.log(
          `[Selector] Success after ${executionTime}ms (${i === 0 ? 'primary' : `fallback #${i}`})`
        );
      }

      return {
        success: true,
        locator,
        selector,
        selectorIndex: i,
        attempted,
        errors,
        executionTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ selector, error: errorMessage });

      if (debugMode) {
        console.log(`[Selector] Failed: ${errorMessage}`);
      }

      // Continue to next fallback
    }
  }

  // All selectors failed
  const executionTime = Date.now() - startTime;

  if (throwOnFailure) {
    const message = `All selectors failed after ${attempted.length} attempt(s) in ${executionTime}ms`;
    throw new SelectorFallbackError(message, attempted, errors, executionTime);
  }

  return {
    success: false,
    attempted,
    errors,
    executionTime,
  };
}

/**
 * Execute a selector and return locator directly or null on failure
 *
 * This is a convenience wrapper that returns null instead of throwing
 * or returning a complex result object.
 *
 * @param page - Playwright page instance
 * @param definition - Selector definition
 * @param options - Execution options (throwOnFailure is always false)
 * @returns Locator if found, null otherwise
 *
 * @example
 * ```typescript
 * const button = await findWithFallback(page, {
 *   primary: '[data-testid="submit"]',
 *   fallback: ['button.submit']
 * });
 *
 * if (button) {
 *   await button.click();
 * }
 * ```
 */
export async function findWithFallback(
  page: Page,
  definition: SelectorDefinition,
  options: Omit<SelectorExecutionOptions, 'throwOnFailure'> = {}
): Promise<Locator | null> {
  const result = await executeWithFallback(page, definition, {
    ...options,
    throwOnFailure: false,
  });

  return result.success ? result.locator! : null;
}

// ============================================================================
// Selector Chain Validation
// ============================================================================

/**
 * Validate a selector chain without executing it
 *
 * Checks for common issues:
 * - Empty selectors
 * - Duplicate selectors
 * - Invalid selector syntax (basic check)
 *
 * @param definition - Selector definition to validate
 * @returns Validation errors (empty array if valid)
 */
export function validateSelectorChain(definition: SelectorDefinition): string[] {
  const errors: string[] = [];
  const selectors = normalizeSelectorDefinition(definition);

  if (selectors.length === 0) {
    errors.push('Selector chain is empty');
    return errors;
  }

  const seen = new Set<string>();

  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i];
    const label = i === 0 ? 'Primary selector' : `Fallback selector #${i}`;

    // Check for empty selector
    if (!selector || selector.trim().length === 0) {
      errors.push(`${label} is empty`);
      continue;
    }

    // Check for duplicates
    if (seen.has(selector)) {
      errors.push(`${label} is duplicate: "${selector}"`);
    }
    seen.add(selector);

    // Basic syntax validation (very simple check)
    if (selector.includes('  ')) {
      errors.push(`${label} contains double spaces: "${selector}"`);
    }
  }

  return errors;
}

/**
 * Check if a selector chain is valid
 *
 * @param definition - Selector definition
 * @returns True if valid, false otherwise
 */
export function isValidSelectorChain(definition: SelectorDefinition): boolean {
  return validateSelectorChain(definition).length === 0;
}

// ============================================================================
// Retry with Selector Fallback
// ============================================================================

/**
 * Execute an action with automatic retry using selector fallback
 *
 * This is a higher-order function that wraps action execution with
 * retry logic and automatic selector fallback on failure.
 *
 * @param action - Function to execute (receives locator)
 * @param page - Playwright page instance
 * @param definition - Selector definition
 * @param options - Execution options
 * @returns Action result
 *
 * @example
 * ```typescript
 * const result = await retryWithFallback(
 *   async (locator) => {
 *     await locator.click();
 *     return { clicked: true };
 *   },
 *   page,
 *   { primary: 'button', fallback: ['.btn'] },
 *   { timeout: 3000, maxRetries: 2 }
 * );
 * ```
 */
export async function retryWithFallback<T>(
  action: (locator: Locator) => Promise<T>,
  page: Page,
  definition: SelectorDefinition,
  options: SelectorExecutionOptions & { maxRetries?: number; retryDelay?: number } = {}
): Promise<T> {
  const { maxRetries = 0, retryDelay = 1000, ...selectorOptions } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await executeWithFallback(page, definition, selectorOptions);

      if (!result.success || !result.locator) {
        throw new Error('No locator found after fallback chain');
      }

      // Execute the action with the found locator
      return await action(result.locator);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        if (selectorOptions.debugMode) {
          console.log(`[Retry] Attempt ${attempt + 1} failed, retrying after ${retryDelay}ms...`);
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw lastError!;
}

// ============================================================================
// Statistics & Monitoring
// ============================================================================

/**
 * Selector execution statistics
 */
export interface SelectorStatistics {
  /** Total number of executions */
  totalExecutions: number;

  /** Number of successful executions */
  successfulExecutions: number;

  /** Number of primary selector successes */
  primarySuccesses: number;

  /** Number of fallback uses */
  fallbackUses: number;

  /** Number of complete failures */
  failures: number;

  /** Average execution time (milliseconds) */
  avgExecutionTime: number;

  /** Total execution time (milliseconds) */
  totalExecutionTime: number;
}

/**
 * Selector statistics tracker
 */
export class SelectorStatsTracker {
  private stats: SelectorStatistics = {
    totalExecutions: 0,
    successfulExecutions: 0,
    primarySuccesses: 0,
    fallbackUses: 0,
    failures: 0,
    avgExecutionTime: 0,
    totalExecutionTime: 0,
  };

  /**
   * Record an execution result
   */
  record(result: SelectorExecutionResult): void {
    this.stats.totalExecutions++;
    this.stats.totalExecutionTime += result.executionTime;

    if (result.success) {
      this.stats.successfulExecutions++;

      if (result.selectorIndex === 0) {
        this.stats.primarySuccesses++;
      } else {
        this.stats.fallbackUses++;
      }
    } else {
      this.stats.failures++;
    }

    // Update average
    this.stats.avgExecutionTime = this.stats.totalExecutionTime / this.stats.totalExecutions;
  }

  /**
   * Get current statistics
   */
  getStats(): Readonly<SelectorStatistics> {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      primarySuccesses: 0,
      fallbackUses: 0,
      failures: 0,
      avgExecutionTime: 0,
      totalExecutionTime: 0,
    };
  }

  /**
   * Get success rate (0-1)
   */
  getSuccessRate(): number {
    if (this.stats.totalExecutions === 0) return 0;
    return this.stats.successfulExecutions / this.stats.totalExecutions;
  }

  /**
   * Get fallback usage rate (0-1)
   */
  getFallbackRate(): number {
    if (this.stats.successfulExecutions === 0) return 0;
    return this.stats.fallbackUses / this.stats.successfulExecutions;
  }
}
