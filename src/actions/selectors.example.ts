/**
 * Example: Using Selector Fallback Strategy
 *
 * This example demonstrates how to use the selector fallback mechanism
 * to handle different selector scenarios robustly.
 */

import type { Page } from 'playwright';
import type { SelectorDefinition } from './types.js';
import {
  executeWithFallback,
  findWithFallback,
  retryWithFallback,
  SelectorStatsTracker,
} from './selectors.js';

// ============================================================================
// Example 1: Basic Selector Fallback
// ============================================================================

export async function example1_basicFallback(page: Page) {
  console.log('\n=== Example 1: Basic Selector Fallback ===\n');

  // Define a selector with fallback chain
  const submitButton: SelectorDefinition = {
    primary: '[data-testid="submit-btn"]', // Try this first
    fallback: [
      'button.submit-button', // If primary fails, try this
      'button:has-text("Submit")', // Then try text-based selector
      'button[type="submit"]', // Last resort: generic submit button
    ],
  };

  try {
    const result = await executeWithFallback(page, submitButton, {
      timeout: 5000,
      debugMode: true, // Enable debug logging
    });

    console.log('Success!');
    console.log('- Used selector:', result.selector);
    console.log('- Selector index:', result.selectorIndex);
    console.log('- Execution time:', result.executionTime, 'ms');

    // Click the button
    await result.locator!.click();
  } catch (error) {
    console.error('All selectors failed:', error);
  }
}

// ============================================================================
// Example 2: Simple Find with Fallback
// ============================================================================

export async function example2_simpleFindWithFallback(page: Page) {
  console.log('\n=== Example 2: Simple Find with Fallback ===\n');

  // Convenience function - returns locator or null
  const button = await findWithFallback(
    page,
    {
      primary: '[data-testid="close"]',
      fallback: ['button.close', '[aria-label="Close"]'],
    },
    { timeout: 3000 }
  );

  if (button) {
    console.log('Button found!');
    await button.click();
  } else {
    console.log('Button not found after trying all selectors');
  }
}

// ============================================================================
// Example 3: Retry with Fallback
// ============================================================================

export async function example3_retryWithFallback(page: Page) {
  console.log('\n=== Example 3: Retry with Fallback ===\n');

  try {
    const result = await retryWithFallback(
      async (locator) => {
        // This action might fail due to timing issues
        await locator.click();

        // Verify the action succeeded
        const isDialogOpen = await page.locator('.dialog').isVisible();
        if (!isDialogOpen) {
          throw new Error('Dialog did not open');
        }

        return { success: true, dialogOpen: true };
      },
      page,
      {
        primary: 'button[data-action="open-dialog"]',
        fallback: ['.open-dialog-btn', 'button:has-text("Open")'],
      },
      {
        timeout: 3000,
        maxRetries: 2, // Retry up to 2 times
        retryDelay: 1000, // Wait 1s between retries
        debugMode: true,
      }
    );

    console.log('Success after retries:', result);
  } catch (error) {
    console.error('Failed after all retries:', error);
  }
}

// ============================================================================
// Example 4: Multiple Actions with Statistics
// ============================================================================

export async function example4_withStatistics(page: Page) {
  console.log('\n=== Example 4: Selector Statistics ===\n');

  const tracker = new SelectorStatsTracker();

  // Define multiple selectors
  const selectors = {
    submit: {
      primary: '[data-testid="submit"]',
      fallback: ['button.submit'],
    },
    cancel: {
      primary: '[data-testid="cancel"]',
      fallback: ['button.cancel'],
    },
    confirm: {
      primary: '[data-testid="confirm"]',
      fallback: ['button.confirm', 'button:has-text("Confirm")'],
    },
  };

  // Execute multiple selector lookups
  for (const [name, selector] of Object.entries(selectors)) {
    try {
      const result = await executeWithFallback(page, selector, {
        timeout: 3000,
        throwOnFailure: false, // Don't throw, just track
      });

      tracker.record(result);

      if (result.success) {
        console.log(`✓ ${name}: found with ${result.selectorIndex === 0 ? 'primary' : 'fallback'}`);
      } else {
        console.log(`✗ ${name}: not found`);
      }
    } catch (error) {
      console.error(`Error finding ${name}:`, error);
    }
  }

  // Print statistics
  const stats = tracker.getStats();
  console.log('\n--- Statistics ---');
  console.log('Total executions:', stats.totalExecutions);
  console.log('Successful:', stats.successfulExecutions);
  console.log('Primary successes:', stats.primarySuccesses);
  console.log('Fallback uses:', stats.fallbackUses);
  console.log('Failures:', stats.failures);
  console.log('Success rate:', (tracker.getSuccessRate() * 100).toFixed(1) + '%');
  console.log('Fallback rate:', (tracker.getFallbackRate() * 100).toFixed(1) + '%');
  console.log('Avg execution time:', stats.avgExecutionTime.toFixed(1) + 'ms');
}

// ============================================================================
// Example 5: Integration with Action Definition
// ============================================================================

/**
 * Example action definition using selector fallback
 */
export const exampleActionDefinition = {
  namespace: 'eresh',
  name: 'dialog:open',
  fullName: 'eresh:dialog:open',
  description: 'Open a dialog component',
  params: {
    trigger: {
      type: 'string' as const,
      description: 'Selector name for the trigger button',
      required: true,
    },
  },
  steps: [
    {
      action: 'click',
      args: {
        selector: '${params.trigger}', // Will be resolved to selector with fallback
      },
    },
    {
      action: 'wait',
      args: {
        selector: 'dialog_container', // References namespace selector
        state: 'visible',
      },
    },
  ],
  returns: {
    dialogVisible: 'steps.1.success',
  },
  sourcePath: 'actions/eresh.yaml',
};

/**
 * Example namespace with selector definitions
 */
export const exampleNamespaceDefinition = {
  namespace: 'eresh',
  version: '3.0.0',
  description: 'Eresh UI component actions',
  selectors: {
    // Selector with fallback chain
    dialog_container: {
      primary: '[data-component="dialog"]',
      fallback: ['.eresh-dialog', '[role="dialog"]', '.modal-container'],
    },

    // Simple string selector
    dialog_close: '[data-testid="dialog-close"]',

    // Another fallback chain
    dialog_confirm: {
      primary: 'button[data-action="confirm"]',
      fallback: ['button.confirm', 'button:has-text("Confirm")', 'button:has-text("OK")'],
    },
  },
  actions: {},
  compatibility: {
    minVersion: '2.0.0',
    versionOverrides: {
      '2.x': {
        selectors: {
          // Override selectors for v2.x
          dialog_container: {
            primary: '.modal-dialog',
            fallback: ['[role="dialog"]', '.dialog-wrapper'],
          },
        },
      },
    },
  },
  sourcePath: 'actions/eresh.yaml',
};

// ============================================================================
// Example 6: Error Handling
// ============================================================================

export async function example6_errorHandling(page: Page) {
  console.log('\n=== Example 6: Error Handling ===\n');

  try {
    await executeWithFallback(
      page,
      {
        primary: '.nonexistent-selector-1',
        fallback: ['.nonexistent-selector-2', '.nonexistent-selector-3'],
      },
      {
        timeout: 1000,
        throwOnFailure: true,
      }
    );
  } catch (error: any) {
    console.log('Caught SelectorFallbackError:');
    console.log('- Attempted selectors:', error.attempted);
    console.log('- Errors per selector:');
    error.errors.forEach((e: any) => {
      console.log(`  - ${e.selector}: ${e.error}`);
    });
    console.log('- Total execution time:', error.executionTime, 'ms');
  }

  // Alternative: Don't throw, check result
  const result = await executeWithFallback(
    page,
    {
      primary: '.another-nonexistent',
      fallback: ['.also-nonexistent'],
    },
    {
      timeout: 1000,
      throwOnFailure: false, // Return failure result instead
    }
  );

  if (!result.success) {
    console.log('\nFailed without throwing:');
    console.log('- Attempted:', result.attempted);
    console.log('- Error count:', result.errors.length);
  }
}

// ============================================================================
// Main Example Runner
// ============================================================================

export async function runAllExamples(page: Page) {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Selector Fallback Strategy Examples                     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  await example1_basicFallback(page);
  await example2_simpleFindWithFallback(page);
  await example3_retryWithFallback(page);
  await example4_withStatistics(page);
  await example6_errorHandling(page);

  console.log('\n✓ All examples completed\n');
}
