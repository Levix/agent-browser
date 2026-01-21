/**
 * Tests for action executor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActionExecutor } from './executor.js';
import type {
  ActionDefinition,
  ActionStep,
  ExecutionContext,
  ActionRegistry,
  NamespaceDefinition,
} from './types.js';
import type { Page, Locator } from 'playwright-core';

// ============================================================================
// Mock Setup
// ============================================================================

/**
 * Create a mock page object
 */
function createMockPage(): Page {
  const mockLocator: Partial<Locator> = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    pressSequentially: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
    count: vi.fn().mockResolvedValue(1),
    isVisible: vi.fn().mockResolvedValue(true),
    first: vi.fn().mockReturnThis(),
  };

  const evaluateImpl = vi.fn().mockImplementation((script: string) => {
    // Parse simple expressions for test
    if (script === '42') return Promise.resolve(42);
    if (script === '"hello"') return Promise.resolve('hello');
    if (script === 'document.title') return Promise.resolve('Test Page');
    return Promise.resolve(42); // Default
  });

  const mockPage: Partial<Page> = {
    goto: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue(mockLocator),
    title: vi.fn().mockResolvedValue('Test Page'),
    url: vi.fn().mockReturnValue('https://example.com'),
    evaluate: evaluateImpl,
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
    } as any,
  };

  return mockPage as Page;
}

/**
 * Create a mock registry
 */
function createMockRegistry(): ActionRegistry {
  const namespace: NamespaceDefinition = {
    namespace: 'test',
    version: '1.0.0',
    description: 'Test namespace',
    selectors: {
      button: '[data-test="button"]',
      input: '[data-test="input"]',
    },
    actions: {},
    sourcePath: 'test.yaml',
  };

  const nestedAction: ActionDefinition = {
    name: 'nested',
    namespace: 'test',
    fullName: 'test:nested',
    description: 'Nested action',
    params: {},
    steps: [
      {
        action: 'wait',
        args: { time: 100 },
      },
    ],
    sourcePath: 'test.yaml',
  };

  return {
    namespaces: new Map([['test', namespace]]),
    index: new Map([['test:nested', nestedAction]]),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ActionExecutor', () => {
  let executor: ActionExecutor;
  let mockPage: Page;
  let mockRegistry: ActionRegistry;

  beforeEach(() => {
    executor = new ActionExecutor({
      debugMode: false,
      stepTimeout: 5000,
      actionTimeout: 30000,
    });

    mockPage = createMockPage();
    mockRegistry = createMockRegistry();

    executor.setPage(mockPage);
    executor.setRegistry(mockRegistry);
  });

  // ==========================================================================
  // Basic Execution
  // ==========================================================================

  describe('Basic Execution', () => {
    it('should execute a simple action', async () => {
      const action: ActionDefinition = {
        name: 'simple',
        namespace: 'test',
        fullName: 'test:simple',
        description: 'Simple action',
        params: {},
        steps: [
          {
            action: 'open',
            args: { url: 'https://example.com' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', { timeout: 5000 });
    });

    it('should execute multiple steps', async () => {
      const action: ActionDefinition = {
        name: 'multi',
        namespace: 'test',
        fullName: 'test:multi',
        description: 'Multi-step action',
        params: {},
        steps: [
          {
            action: 'open',
            args: { url: 'https://example.com' },
          },
          {
            action: 'click',
            args: { selector: '[data-test="button"]' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(result.trace).toHaveLength(2);
    });

    it('should support parameter interpolation', async () => {
      const action: ActionDefinition = {
        name: 'parameterized',
        namespace: 'test',
        fullName: 'test:parameterized',
        description: 'Parameterized action',
        params: {
          url: { type: 'string', description: 'URL', required: true },
        },
        steps: [
          {
            action: 'open',
            args: { url: '${params.url}' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, { url: 'https://test.com' });

      expect(result.success).toBe(true);
      expect(mockPage.goto).toHaveBeenCalledWith('https://test.com', { timeout: 5000 });
    });
  });

  // ==========================================================================
  // Conditional Execution
  // ==========================================================================

  describe('Conditional Execution', () => {
    it('should skip step when condition is false', async () => {
      const action: ActionDefinition = {
        name: 'conditional',
        namespace: 'test',
        fullName: 'test:conditional',
        description: 'Conditional action',
        params: {
          shouldClick: { type: 'boolean', description: 'Should click', required: true },
        },
        steps: [
          {
            action: 'click',
            args: { selector: '[data-test="button"]' },
            when: '${params.shouldClick} == true',
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, { shouldClick: false });

      expect(result.success).toBe(true);
      expect(mockPage.locator).not.toHaveBeenCalled();
    });

    it('should execute step when condition is true', async () => {
      const action: ActionDefinition = {
        name: 'conditional',
        namespace: 'test',
        fullName: 'test:conditional',
        description: 'Conditional action',
        params: {
          shouldClick: { type: 'boolean', description: 'Should click', required: true },
        },
        steps: [
          {
            action: 'click',
            args: { selector: '[data-test="button"]' },
            when: '${params.shouldClick} == true',
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, { shouldClick: true });

      expect(result.success).toBe(true);
      expect(mockPage.locator).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Step Output
  // ==========================================================================

  describe('Step Output', () => {
    it('should store step output in context', async () => {
      const action: ActionDefinition = {
        name: 'with-output',
        namespace: 'test',
        fullName: 'test:with-output',
        description: 'Action with output',
        params: {},
        steps: [
          {
            action: 'eval',
            args: { expression: '42' },
            output: 'result',
          },
          {
            action: 'fail',
            args: { message: 'Value: ${steps.result}' },
            when: '${steps.result} != 42',
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(result.trace?.[0].output).toBe(42);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should fail on step error (abort)', async () => {
      mockPage.goto = vi.fn().mockRejectedValue(new Error('Navigation failed'));

      const action: ActionDefinition = {
        name: 'failing',
        namespace: 'test',
        fullName: 'test:failing',
        description: 'Failing action',
        params: {},
        steps: [
          {
            action: 'open',
            args: { url: 'https://example.com' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should continue on error when onError=continue', async () => {
      mockPage.goto = vi.fn().mockRejectedValue(new Error('Navigation failed'));

      const action: ActionDefinition = {
        name: 'continue-on-error',
        namespace: 'test',
        fullName: 'test:continue-on-error',
        description: 'Continue on error',
        params: {},
        steps: [
          {
            action: 'open',
            args: { url: 'https://example.com' },
            onError: 'continue',
          },
          {
            action: 'wait',
            args: { time: 100 },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(result.trace).toHaveLength(2);
      expect(result.trace?.[0].success).toBe(false);
      expect(result.trace?.[1].success).toBe(true);
    });

    it('should use fallback on error when onError=fallback', async () => {
      let attemptCount = 0;
      const mockLocator: Partial<Locator> = {
        waitFor: vi.fn().mockImplementation(async () => {
          attemptCount++;
          if (attemptCount === 1) {
            throw new Error('Element not found');
          }
          // Second attempt (in fallback) succeeds
        }),
        click: vi.fn().mockResolvedValue(undefined),
      };

      mockPage.locator = vi.fn().mockReturnValue(mockLocator);

      const action: ActionDefinition = {
        name: 'with-fallback',
        namespace: 'test',
        fullName: 'test:with-fallback',
        description: 'Action with fallback',
        params: {},
        steps: [
          {
            action: 'click',
            args: { selector: '[data-test="button"]' },
            onError: 'fallback',
            fallback: [
              {
                action: 'wait',
                args: { time: 100 },
              },
              {
                action: 'click',
                args: { selector: '[data-test="button-alt"]' },
              },
            ],
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(attemptCount).toBe(2); // First failed, second in fallback succeeded
    });
  });

  // ==========================================================================
  // Retry Mechanism
  // ==========================================================================

  describe('Retry Mechanism', () => {
    it('should retry on failure', async () => {
      let attemptCount = 0;
      mockPage.goto = vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Navigation failed');
        }
      });

      const action: ActionDefinition = {
        name: 'with-retry',
        namespace: 'test',
        fullName: 'test:with-retry',
        description: 'Action with retry',
        params: {},
        steps: [
          {
            action: 'open',
            args: { url: 'https://example.com' },
            retry: 2,
            retryDelay: 50,
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(attemptCount).toBe(3);
    });

    it('should fail after exhausting retries', async () => {
      mockPage.goto = vi.fn().mockRejectedValue(new Error('Navigation failed'));

      const action: ActionDefinition = {
        name: 'retry-exhausted',
        namespace: 'test',
        fullName: 'test:retry-exhausted',
        description: 'Retry exhausted',
        params: {},
        steps: [
          {
            action: 'open',
            args: { url: 'https://example.com' },
            retry: 2,
            retryDelay: 10,
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(false);
      expect(mockPage.goto).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  // ==========================================================================
  // Nested Actions (run)
  // ==========================================================================

  describe('Nested Actions', () => {
    it('should execute nested action', async () => {
      const action: ActionDefinition = {
        name: 'parent',
        namespace: 'test',
        fullName: 'test:parent',
        description: 'Parent action',
        params: {},
        steps: [
          {
            action: 'run',
            args: { action: 'test:nested' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
    });

    it('should prevent infinite recursion', async () => {
      // Create a recursive action
      const recursiveAction: ActionDefinition = {
        name: 'recursive',
        namespace: 'test',
        fullName: 'test:recursive',
        description: 'Recursive action',
        params: {},
        steps: [
          {
            action: 'run',
            args: { action: 'test:recursive' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      mockRegistry.index.set('test:recursive', recursiveAction);

      const result = await executor.execute(recursiveAction, {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MAX_DEPTH_EXCEEDED');
    });
  });

  // ==========================================================================
  // Step Action Handlers
  // ==========================================================================

  describe('Step Action Handlers', () => {
    it('should handle "open" action', async () => {
      const action: ActionDefinition = {
        name: 'test-open',
        namespace: 'test',
        fullName: 'test:test-open',
        description: 'Test open',
        params: {},
        steps: [
          {
            action: 'open',
            args: { url: 'https://example.com' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', { timeout: 5000 });
    });

    it('should handle "click" action', async () => {
      const action: ActionDefinition = {
        name: 'test-click',
        namespace: 'test',
        fullName: 'test:test-click',
        description: 'Test click',
        params: {},
        steps: [
          {
            action: 'click',
            args: { selector: '[data-test="button"]' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(mockPage.locator).toHaveBeenCalledWith('[data-test="button"]');
    });

    it('should handle "fill" action', async () => {
      const action: ActionDefinition = {
        name: 'test-fill',
        namespace: 'test',
        fullName: 'test:test-fill',
        description: 'Test fill',
        params: {},
        steps: [
          {
            action: 'fill',
            args: { selector: '[data-test="input"]', value: 'test value' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(mockPage.locator).toHaveBeenCalledWith('[data-test="input"]');
    });

    it('should handle "wait" action with time', async () => {
      const action: ActionDefinition = {
        name: 'test-wait',
        namespace: 'test',
        fullName: 'test:test-wait',
        description: 'Test wait',
        params: {},
        steps: [
          {
            action: 'wait',
            args: { time: 100 },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const startTime = Date.now();
      const result = await executor.execute(action, {});
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it('should handle "eval" action', async () => {
      const action: ActionDefinition = {
        name: 'test-eval',
        namespace: 'test',
        fullName: 'test:test-eval',
        description: 'Test eval',
        params: {},
        steps: [
          {
            action: 'eval',
            args: { expression: 'document.title' },
            output: 'title',
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(mockPage.evaluate).toHaveBeenCalledWith('document.title', expect.any(Object));
    });

    it('should handle "fail" action', async () => {
      const action: ActionDefinition = {
        name: 'test-fail',
        namespace: 'test',
        fullName: 'test:test-fail',
        description: 'Test fail',
        params: {},
        steps: [
          {
            action: 'fail',
            args: { message: 'Expected failure' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Expected failure');
    });
  });

  // ==========================================================================
  // Dry Run
  // ==========================================================================

  describe('Dry Run', () => {
    it('should perform dry-run without execution', async () => {
      const action: ActionDefinition = {
        name: 'test-dryrun',
        namespace: 'test',
        fullName: 'test:test-dryrun',
        description: 'Test dry run',
        params: {
          url: { type: 'string', description: 'URL', required: true },
        },
        steps: [
          {
            action: 'open',
            args: { url: '${params.url}' },
          },
          {
            action: 'click',
            args: { selector: '[data-test="button"]' },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.dryRun(action, { url: 'https://example.com' });

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].args.url).toBe('https://example.com');
      expect(mockPage.goto).not.toHaveBeenCalled(); // No actual execution
    });

    it('should evaluate conditions in dry-run', async () => {
      const action: ActionDefinition = {
        name: 'test-dryrun-condition',
        namespace: 'test',
        fullName: 'test:test-dryrun-condition',
        description: 'Test dry run with condition',
        params: {
          skip: { type: 'boolean', description: 'Skip', required: true },
        },
        steps: [
          {
            action: 'click',
            args: { selector: '[data-test="button"]' },
            when: '${params.skip} == false',
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.dryRun(action, { skip: true });

      expect(result.success).toBe(true);
      expect(result.steps[0].willExecute).toBe(false);
      expect(result.steps[0].skipReason).toBeDefined();
    });
  });

  // ==========================================================================
  // Resource Limits
  // ==========================================================================

  describe('Resource Limits', () => {
    it('should enforce max steps limit', async () => {
      const steps: ActionStep[] = [];
      for (let i = 0; i < 150; i++) {
        steps.push({
          action: 'wait',
          args: { time: 1 },
        });
      }

      const action: ActionDefinition = {
        name: 'too-many-steps',
        namespace: 'test',
        fullName: 'test:too-many-steps',
        description: 'Too many steps',
        params: {},
        steps,
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MAX_STEPS_EXCEEDED');
    });

    it('should enforce action timeout', async () => {
      const shortExecutor = new ActionExecutor({
        actionTimeout: 100,
      });
      shortExecutor.setPage(mockPage);

      const action: ActionDefinition = {
        name: 'timeout-test',
        namespace: 'test',
        fullName: 'test:timeout-test',
        description: 'Timeout test',
        params: {},
        steps: [
          {
            action: 'wait',
            args: { time: 200 },
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await shortExecutor.execute(action, {});

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('timeout');
    });
  });

  // ==========================================================================
  // Return Values
  // ==========================================================================

  describe('Return Values', () => {
    it('should evaluate return expressions', async () => {
      const action: ActionDefinition = {
        name: 'with-returns',
        namespace: 'test',
        fullName: 'test:with-returns',
        description: 'Action with returns',
        params: {},
        steps: [
          {
            action: 'eval',
            args: { expression: '42' },
            output: 'number',
          },
          {
            action: 'eval',
            args: { expression: '"hello"' },
            output: 'text',
          },
        ],
        returns: {
          result: '${steps.number}',
          message: '${steps.text}',
        },
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        result: 42,
        message: 'hello',
      });
    });
  });

  // ==========================================================================
  // Verification
  // ==========================================================================

  describe('Verification', () => {
    it('should verify post-conditions', async () => {
      const action: ActionDefinition = {
        name: 'with-verify',
        namespace: 'test',
        fullName: 'test:with-verify',
        description: 'Action with verification',
        params: {},
        steps: [
          {
            action: 'eval',
            args: { expression: '42' },
            output: 'result',
          },
        ],
        verify: [
          {
            condition: '${steps.result} == 42',
            message: 'Result should be 42',
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(true);
    });

    it('should fail when verification fails', async () => {
      const action: ActionDefinition = {
        name: 'with-verify-fail',
        namespace: 'test',
        fullName: 'test:with-verify-fail',
        description: 'Action with failing verification',
        params: {},
        steps: [
          {
            action: 'eval',
            args: { expression: '42' },
            output: 'result',
          },
        ],
        verify: [
          {
            condition: '${steps.result} == 100',
            message: 'Result should be 100',
          },
        ],
        sourcePath: 'test.yaml',
      };

      const result = await executor.execute(action, {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VERIFY_FAILED');
    });
  });
});
