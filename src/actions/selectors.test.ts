/**
 * Tests for selector fallback and retry mechanism
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Page, Locator } from 'playwright';
import type { SelectorDefinition } from './types.js';
import {
  normalizeSelectorDefinition,
  hasFallbacks,
  executeWithFallback,
  findWithFallback,
  validateSelectorChain,
  isValidSelectorChain,
  retryWithFallback,
  SelectorFallbackError,
  SelectorStatsTracker,
} from './selectors.js';

// ============================================================================
// Mocks
// ============================================================================

function createMockLocator(shouldSucceed: boolean = true): Locator {
  return {
    waitFor: vi.fn(async () => {
      if (!shouldSucceed) {
        throw new Error('Element not found');
      }
    }),
    click: vi.fn(async () => {}),
  } as unknown as Locator;
}

function createMockPage(locatorBehavior: Map<string, boolean>): Page {
  return {
    locator: vi.fn((selector: string) => {
      const shouldSucceed = locatorBehavior.get(selector) ?? false;
      return createMockLocator(shouldSucceed);
    }),
  } as unknown as Page;
}

// ============================================================================
// Tests: Selector Normalization
// ============================================================================

describe('normalizeSelectorDefinition', () => {
  it('should normalize string selector to array', () => {
    const result = normalizeSelectorDefinition('button.submit');
    expect(result).toEqual(['button.submit']);
  });

  it('should normalize object with primary only', () => {
    const result = normalizeSelectorDefinition({
      primary: '[data-testid="submit"]',
      fallback: [],
    });
    expect(result).toEqual(['[data-testid="submit"]']);
  });

  it('should normalize object with primary and fallbacks', () => {
    const result = normalizeSelectorDefinition({
      primary: '[data-testid="submit"]',
      fallback: ['button.submit', 'button:has-text("Submit")'],
    });
    expect(result).toEqual([
      '[data-testid="submit"]',
      'button.submit',
      'button:has-text("Submit")',
    ]);
  });

  it('should handle empty fallback array', () => {
    const result = normalizeSelectorDefinition({
      primary: 'button',
      fallback: [],
    });
    expect(result).toEqual(['button']);
  });
});

describe('hasFallbacks', () => {
  it('should return false for string selector', () => {
    expect(hasFallbacks('button')).toBe(false);
  });

  it('should return false for object without fallbacks', () => {
    expect(hasFallbacks({ primary: 'button', fallback: [] })).toBe(false);
  });

  it('should return true for object with fallbacks', () => {
    expect(hasFallbacks({ primary: 'button', fallback: ['.btn'] })).toBe(true);
  });
});

// ============================================================================
// Tests: Selector Execution
// ============================================================================

describe('executeWithFallback', () => {
  it('should succeed with primary selector', async () => {
    const page = createMockPage(new Map([['button.primary', true]]));

    const result = await executeWithFallback(page, 'button.primary', { timeout: 1000 });

    expect(result.success).toBe(true);
    expect(result.selector).toBe('button.primary');
    expect(result.selectorIndex).toBe(0);
    expect(result.attempted).toEqual(['button.primary']);
    expect(result.errors).toEqual([]);
  });

  it('should fallback to second selector when primary fails', async () => {
    const page = createMockPage(
      new Map([
        ['button.primary', false],
        ['button.fallback', true],
      ])
    );

    const definition: SelectorDefinition = {
      primary: 'button.primary',
      fallback: ['button.fallback'],
    };

    const result = await executeWithFallback(page, definition, { timeout: 1000 });

    expect(result.success).toBe(true);
    expect(result.selector).toBe('button.fallback');
    expect(result.selectorIndex).toBe(1);
    expect(result.attempted).toEqual(['button.primary', 'button.fallback']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].selector).toBe('button.primary');
  });

  it('should try all fallbacks in order', async () => {
    const page = createMockPage(
      new Map([
        ['selector1', false],
        ['selector2', false],
        ['selector3', true],
      ])
    );

    const definition: SelectorDefinition = {
      primary: 'selector1',
      fallback: ['selector2', 'selector3', 'selector4'],
    };

    const result = await executeWithFallback(page, definition, { timeout: 1000 });

    expect(result.success).toBe(true);
    expect(result.selector).toBe('selector3');
    expect(result.selectorIndex).toBe(2);
    expect(result.attempted).toEqual(['selector1', 'selector2', 'selector3']);
  });

  it('should fail when all selectors fail', async () => {
    const page = createMockPage(
      new Map([
        ['selector1', false],
        ['selector2', false],
      ])
    );

    const definition: SelectorDefinition = {
      primary: 'selector1',
      fallback: ['selector2'],
    };

    await expect(executeWithFallback(page, definition, { timeout: 1000 })).rejects.toThrow(
      SelectorFallbackError
    );
  });

  it('should return failure result when throwOnFailure is false', async () => {
    const page = createMockPage(new Map([['selector', false]]));

    const result = await executeWithFallback(page, 'selector', {
      timeout: 1000,
      throwOnFailure: false,
    });

    expect(result.success).toBe(false);
    expect(result.locator).toBeUndefined();
    expect(result.attempted).toEqual(['selector']);
    expect(result.errors).toHaveLength(1);
  });

  it('should respect maxFallbacks option', async () => {
    const page = createMockPage(
      new Map([
        ['selector1', false],
        ['selector2', false],
        ['selector3', true],
      ])
    );

    const definition: SelectorDefinition = {
      primary: 'selector1',
      fallback: ['selector2', 'selector3'],
    };

    const result = await executeWithFallback(page, definition, {
      timeout: 1000,
      maxFallbacks: 1,
      throwOnFailure: false,
    });

    // Should only try primary + 1 fallback
    expect(result.attempted).toEqual(['selector1', 'selector2']);
    expect(result.success).toBe(false);
  });

  it('should track execution time', async () => {
    const page = createMockPage(new Map([['button', true]]));

    const result = await executeWithFallback(page, 'button', { timeout: 1000 });

    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });
});

describe('findWithFallback', () => {
  it('should return locator on success', async () => {
    const page = createMockPage(new Map([['button', true]]));

    const locator = await findWithFallback(page, 'button', { timeout: 1000 });

    expect(locator).toBeTruthy();
  });

  it('should return null on failure', async () => {
    const page = createMockPage(new Map([['button', false]]));

    const locator = await findWithFallback(page, 'button', { timeout: 1000 });

    expect(locator).toBeNull();
  });

  it('should use fallback chain', async () => {
    const page = createMockPage(
      new Map([
        ['button.primary', false],
        ['button.fallback', true],
      ])
    );

    const locator = await findWithFallback(
      page,
      { primary: 'button.primary', fallback: ['button.fallback'] },
      { timeout: 1000 }
    );

    expect(locator).toBeTruthy();
  });
});

// ============================================================================
// Tests: Selector Validation
// ============================================================================

describe('validateSelectorChain', () => {
  it('should return empty array for valid string selector', () => {
    const errors = validateSelectorChain('button.submit');
    expect(errors).toEqual([]);
  });

  it('should return empty array for valid selector chain', () => {
    const errors = validateSelectorChain({
      primary: '[data-testid="submit"]',
      fallback: ['button.submit', 'button:has-text("Submit")'],
    });
    expect(errors).toEqual([]);
  });

  it('should detect empty selector', () => {
    const errors = validateSelectorChain('');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('empty');
  });

  it('should detect duplicate selectors', () => {
    const errors = validateSelectorChain({
      primary: 'button',
      fallback: ['button', '.btn'],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('should detect double spaces', () => {
    const errors = validateSelectorChain('button  .submit');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('double spaces'))).toBe(true);
  });

  it('should detect empty fallback selector', () => {
    const errors = validateSelectorChain({
      primary: 'button',
      fallback: ['', '.btn'],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('empty'))).toBe(true);
  });
});

describe('isValidSelectorChain', () => {
  it('should return true for valid selector', () => {
    expect(isValidSelectorChain('button')).toBe(true);
  });

  it('should return false for invalid selector', () => {
    expect(isValidSelectorChain('')).toBe(false);
  });

  it('should return false for duplicate selectors', () => {
    expect(
      isValidSelectorChain({
        primary: 'button',
        fallback: ['button'],
      })
    ).toBe(false);
  });
});

// ============================================================================
// Tests: Retry with Fallback
// ============================================================================

describe('retryWithFallback', () => {
  it('should execute action with found locator', async () => {
    const page = createMockPage(new Map([['button', true]]));
    const action = vi.fn(async (locator: Locator) => {
      await locator.click();
      return { clicked: true };
    });

    const result = await retryWithFallback(action, page, 'button', { timeout: 1000 });

    expect(result).toEqual({ clicked: true });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('should retry on action failure', async () => {
    const page = createMockPage(new Map([['button', true]]));
    let attempt = 0;
    const action = vi.fn(async (locator: Locator) => {
      attempt++;
      if (attempt < 2) {
        throw new Error('Action failed');
      }
      return { success: true };
    });

    const result = await retryWithFallback(action, page, 'button', {
      timeout: 1000,
      maxRetries: 2,
      retryDelay: 10,
    });

    expect(result).toEqual({ success: true });
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('should throw after max retries exceeded', async () => {
    const page = createMockPage(new Map([['button', true]]));
    const action = vi.fn(async () => {
      throw new Error('Action always fails');
    });

    await expect(
      retryWithFallback(action, page, 'button', {
        timeout: 1000,
        maxRetries: 2,
        retryDelay: 10,
      })
    ).rejects.toThrow('Action always fails');

    expect(action).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('should use fallback selector on retry', async () => {
    const page = createMockPage(
      new Map([
        ['button.primary', false],
        ['button.fallback', true],
      ])
    );
    const action = vi.fn(async (locator: Locator) => {
      await locator.click();
      return { clicked: true };
    });

    const result = await retryWithFallback(
      action,
      page,
      { primary: 'button.primary', fallback: ['button.fallback'] },
      { timeout: 1000 }
    );

    expect(result).toEqual({ clicked: true });
    expect(page.locator).toHaveBeenCalledWith('button.fallback');
  });
});

// ============================================================================
// Tests: Statistics
// ============================================================================

describe('SelectorStatsTracker', () => {
  let tracker: SelectorStatsTracker;

  beforeEach(() => {
    tracker = new SelectorStatsTracker();
  });

  it('should start with zero stats', () => {
    const stats = tracker.getStats();
    expect(stats.totalExecutions).toBe(0);
    expect(stats.successfulExecutions).toBe(0);
    expect(stats.failures).toBe(0);
  });

  it('should record successful primary execution', () => {
    tracker.record({
      success: true,
      locator: {} as Locator,
      selector: 'button',
      selectorIndex: 0,
      attempted: ['button'],
      errors: [],
      executionTime: 100,
    });

    const stats = tracker.getStats();
    expect(stats.totalExecutions).toBe(1);
    expect(stats.successfulExecutions).toBe(1);
    expect(stats.primarySuccesses).toBe(1);
    expect(stats.fallbackUses).toBe(0);
    expect(stats.failures).toBe(0);
  });

  it('should record successful fallback execution', () => {
    tracker.record({
      success: true,
      locator: {} as Locator,
      selector: 'button.fallback',
      selectorIndex: 1,
      attempted: ['button.primary', 'button.fallback'],
      errors: [{ selector: 'button.primary', error: 'Not found' }],
      executionTime: 200,
    });

    const stats = tracker.getStats();
    expect(stats.totalExecutions).toBe(1);
    expect(stats.successfulExecutions).toBe(1);
    expect(stats.primarySuccesses).toBe(0);
    expect(stats.fallbackUses).toBe(1);
  });

  it('should record failure', () => {
    tracker.record({
      success: false,
      attempted: ['button'],
      errors: [{ selector: 'button', error: 'Not found' }],
      executionTime: 150,
    });

    const stats = tracker.getStats();
    expect(stats.totalExecutions).toBe(1);
    expect(stats.successfulExecutions).toBe(0);
    expect(stats.failures).toBe(1);
  });

  it('should calculate average execution time', () => {
    tracker.record({
      success: true,
      locator: {} as Locator,
      selector: 'button',
      selectorIndex: 0,
      attempted: ['button'],
      errors: [],
      executionTime: 100,
    });

    tracker.record({
      success: true,
      locator: {} as Locator,
      selector: 'button',
      selectorIndex: 0,
      attempted: ['button'],
      errors: [],
      executionTime: 200,
    });

    const stats = tracker.getStats();
    expect(stats.avgExecutionTime).toBe(150);
    expect(stats.totalExecutionTime).toBe(300);
  });

  it('should calculate success rate', () => {
    tracker.record({ success: true, selectorIndex: 0 } as any);
    tracker.record({ success: true, selectorIndex: 1 } as any);
    tracker.record({ success: false } as any);

    expect(tracker.getSuccessRate()).toBeCloseTo(2 / 3);
  });

  it('should calculate fallback rate', () => {
    tracker.record({ success: true, selectorIndex: 0 } as any);
    tracker.record({ success: true, selectorIndex: 1 } as any);
    tracker.record({ success: true, selectorIndex: 2 } as any);

    expect(tracker.getFallbackRate()).toBeCloseTo(2 / 3);
  });

  it('should reset statistics', () => {
    tracker.record({ success: true, selectorIndex: 0 } as any);
    tracker.reset();

    const stats = tracker.getStats();
    expect(stats.totalExecutions).toBe(0);
    expect(stats.successfulExecutions).toBe(0);
  });

  it('should return 0 rates when no executions', () => {
    expect(tracker.getSuccessRate()).toBe(0);
    expect(tracker.getFallbackRate()).toBe(0);
  });
});

// ============================================================================
// Tests: Error Handling
// ============================================================================

describe('SelectorFallbackError', () => {
  it('should contain detailed failure information', () => {
    const attempted = ['selector1', 'selector2'];
    const errors = [
      { selector: 'selector1', error: 'Not found' },
      { selector: 'selector2', error: 'Timeout' },
    ];

    const error = new SelectorFallbackError('All failed', attempted, errors, 1000);

    expect(error.message).toBe('All failed');
    expect(error.attempted).toEqual(attempted);
    expect(error.errors).toEqual(errors);
    expect(error.executionTime).toBe(1000);
    expect(error.code).toBe('ELEMENT_NOT_FOUND');
  });
});
