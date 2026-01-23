/**
 * E2E Tests for Action System
 * 
 * Tests the complete action execution flow including:
 * - Action loading and registry
 * - Action execution with real browser (or mock)
 * - Selector fallback chains
 * - Version compatibility
 * - Command handling
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { Registry } from '../src/actions/registry.js';
import { ActionExecutor } from '../src/actions/executor.js';
import { loadActionFile } from '../src/actions/loader.js';
import { applyVersionOverrides } from '../src/actions/version.js';
import { MockBrowserAdapter } from './mocks/browser.js';
import type { ActionDefinition, NamespaceDefinition } from '../src/actions/types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

// ============================================================================
// Test Suite Setup
// ============================================================================

describe('E2E: Action System', () => {
  let registry: Registry;
  let executor: ActionExecutor;
  let mockBrowser: MockBrowserAdapter;
  let mockPage: any;

  beforeAll(async () => {
    // Load test fixtures
    const testActionsResult = await loadActionFile(join(fixturesDir, 'test-actions.yaml'));
    const ereshActionsResult = await loadActionFile(join(fixturesDir, 'eresh-actions.yaml'));

    registry = new Registry();
    
    if ('namespace' in testActionsResult) {
      registry.registerNamespace(testActionsResult as NamespaceDefinition);
    }
    
    if ('namespace' in ereshActionsResult) {
      registry.registerNamespace(ereshActionsResult as NamespaceDefinition);
    }
  });

  beforeEach(() => {
    mockBrowser = new MockBrowserAdapter();
    mockPage = mockBrowser.createMockPage();

    executor = new ActionExecutor({
      debugMode: false,
      stepTimeout: 5000,
      actionTimeout: 30000,
    });
    executor.setPage(mockPage);
    executor.setRegistry(registry.getRawRegistry());

    mockBrowser.clearHistory();
  });

  // ==========================================================================
  // Action List & Discovery
  // ==========================================================================

  describe('Action Discovery', () => {
    it('should list all loaded namespaces', () => {
      const namespaces = Array.from(registry.getNamespaces().keys());
      expect(namespaces).toContain('test');
      expect(namespaces).toContain('eresh');
    });

    it('should list actions in a namespace', () => {
      const actions = registry.getActionsByNamespace('test');
      expect(actions).toHaveLength(6);
      expect(actions.map((a) => a.name)).toContain('simple_login');
      expect(actions.map((a) => a.name)).toContain('conditional_action');
    });

    it('should describe a specific action', () => {
      const action = registry.getAction('test:simple_login');
      expect(action).toBeDefined();
      expect(action?.params).toHaveProperty('username');
      expect(action?.params).toHaveProperty('password');
      expect(action?.steps).toHaveLength(4);
    });

    it('should search actions by keyword', () => {
      const results = registry.search('login');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.action.fullName === 'test:simple_login')).toBe(true);
      expect(results.some((r) => r.action.fullName === 'eresh:login')).toBe(true);
    });
  });

  // ==========================================================================
  // Action Execution
  // ==========================================================================

  describe('Action Execution', () => {
    it('should execute simple login action', async () => {
      const action = registry.getAction('test:simple_login');
      expect(action).toBeDefined();

      const result = await executor.execute(action!, {
        username: 'testuser',
        password: 'testpass',
      });

      expect(result.success).toBe(true);
      expect(mockBrowser.getCallsFor('locator.fill')).toHaveLength(2);
      expect(mockBrowser.getCallsFor('locator.click')).toHaveLength(1);
    });

    it('should execute conditional action', async () => {
      const action = registry.getAction('test:conditional_action');
      expect(action).toBeDefined();

      // When condition is false
      const result1 = await executor.execute(action!, { should_click: false });
      expect(result1.success).toBe(true);
      expect(mockBrowser.getCallsFor('locator.click')).toHaveLength(0);

      mockBrowser.clearHistory();

      // When condition is true
      const result2 = await executor.execute(action!, { should_click: true });
      expect(result2.success).toBe(true);
      expect(mockBrowser.getCallsFor('locator.click')).toHaveLength(1);
    });

    it('should execute action with output capture', async () => {
      const action = registry.getAction('test:action_with_output');
      expect(action).toBeDefined();

      mockBrowser.setEvaluateResult('document.title', 'Test Page Title');
      mockBrowser.setEvaluateResult('window.location.href', 'https://test.com');

      const result = await executor.execute(action!, {});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveProperty('title');
      expect(result.data).toHaveProperty('url');
    });

    it('should execute nested action', async () => {
      const action = registry.getAction('test:nested_action');
      expect(action).toBeDefined();

      const result = await executor.execute(action!, {
        username: 'user',
        password: 'pass',
      });

      expect(result.success).toBe(true);
      // Should execute the nested simple_login action
      expect(mockBrowser.getCallsFor('locator.fill')).toHaveLength(2);
      expect(mockBrowser.getCallsFor('locator.click')).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Error Handling & Retry
  // ==========================================================================

  describe('Error Handling', () => {
    it('should retry on failure', async () => {
      const action = registry.getAction('test:action_with_retry');
      expect(action).toBeDefined();

      let attempts = 0;
      mockPage.goto = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Network error');
        }
      };

      const result = await executor.execute(action!, {
        url: 'https://example.com',
      });

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });

    it('should use fallback on error', async () => {
      const action = registry.getAction('test:action_with_fallback');
      expect(action).toBeDefined();

      // Primary selector fails
      mockBrowser.simulateFailure(
        '[data-test="primary-button"]',
        new Error('Element not found')
      );

      const result = await executor.execute(action!, {
        text: 'Search',
      });

      expect(result.success).toBe(true);
      // Should have attempted primary, then used fallback
      expect(mockBrowser.getCalls().length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Selector Fallback Chain
  // ==========================================================================

  describe('Selector Fallback', () => {
    it.skip('should use fallback selectors', async () => {
      const action = registry.getAction('eresh:login');
      expect(action).toBeDefined();

      // Make primary selector fail
      mockBrowser.simulateFailure(
        '[data-eresh-id="login-btn"]',
        new Error('Selector not found')
      );

      const result = await executor.execute(action!, {
        username: 'user',
        password: 'pass',
      });

      // Should still succeed using fallback selector
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Version Compatibility
  // ==========================================================================

  describe('Version Compatibility', () => {
    it('should apply version overrides', () => {
      const namespace = registry.getNamespace('eresh');
      expect(namespace).toBeDefined();

      const action = registry.getAction('eresh:login');
      expect(action).toBeDefined();

      const overridden = applyVersionOverrides(action!, namespace!, '2.1.0');
      
      // Action should be returned (possibly with modified selectors applied)
      expect(overridden).toBeDefined();
      expect(overridden.name).toBe('login');
    });

    it('should check version compatibility', () => {
      const action = registry.getAction('eresh:login');
      expect(action).toBeDefined();

      const namespace = registry.getNamespace('eresh');
      expect(namespace).toBeDefined();
      expect(namespace?.compatibility).toBeDefined();
      expect(namespace?.compatibility?.minVersion).toBe('2.0.0');
      expect(namespace?.compatibility?.maxVersion).toBe('2.9.9');
    });
  });

  // ==========================================================================
  // Validation
  // ==========================================================================

  describe('Action Validation', () => {
    it.skip('should validate action parameters', async () => {
      const action = registry.getAction('test:simple_login');
      expect(action).toBeDefined();

      // Missing required parameter
      await expect(
        executor.execute(action!, { username: 'user' })
      ).rejects.toThrow();
    });

    it('should reject invalid action reference', () => {
      const action = registry.getAction('nonexistent:action');
      expect(action).toBeUndefined();
    });
  });

  // ==========================================================================
  // Dry Run
  // ==========================================================================

  describe('Dry Run', () => {
    it('should perform dry-run without execution', async () => {
      const action = registry.getAction('test:simple_login');
      expect(action).toBeDefined();

      executor = new ActionExecutor({
        debugMode: false,
        dryRun: true,
      });
      executor.setPage(mockPage);
      executor.setRegistry(registry.getRawRegistry());

      const result = await executor.execute(action!, {
        username: 'user',
        password: 'pass',
      });

      expect(result.success).toBe(true);
      // No actual browser calls should be made
      expect(mockBrowser.getCalls()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Resource Limits
  // ==========================================================================

  describe('Resource Limits', () => {
    it('should enforce max steps limit', async () => {
      const action: ActionDefinition = {
        name: 'many_steps',
        namespace: 'test',
        fullName: 'test:many_steps',
        description: 'Action with many steps',
        params: {},
        steps: Array(150).fill({
          action: 'wait',
          args: { time: 1 },
        }),
        sourcePath: 'test',
      };

      executor = new ActionExecutor({
        debugMode: false,
        maxSteps: 100,
      });
      executor.setPage(mockPage);
      executor.setRegistry(registry.getRawRegistry());

      const result = await executor.execute(action, {});
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/max.*steps/i);
    });

    it('should enforce action timeout', async () => {
      const action: ActionDefinition = {
        name: 'slow_action',
        namespace: 'test',
        fullName: 'test:slow_action',
        description: 'Slow action',
        params: {},
        steps: [
          {
            action: 'wait',
            args: { time: 10000 }, // 10 seconds
          },
        ],
        sourcePath: 'test',
      };

      executor = new ActionExecutor({
        debugMode: false,
        actionTimeout: 1000, // 1 second
      });
      executor.setPage(mockPage);
      executor.setRegistry(registry.getRawRegistry());

      mockBrowser.setDelay('waitForTimeout', 10000);

      const result = await executor.execute(action, {});
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/timeout/i);
    });
  });
});
