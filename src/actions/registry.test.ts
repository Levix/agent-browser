/**
 * Tests for Action Registry
 *
 * Tests merge rules, indexing, and search functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Registry } from './registry.js';
import type { NamespaceDefinition, ActionDefinition } from './types.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal namespace definition for testing
 */
function createTestNamespace(
  namespace: string,
  actions: Record<string, Partial<ActionDefinition>> = {},
  selectors: Record<string, any> = {},
  sourcePath = '/test/path.yaml'
): NamespaceDefinition {
  const fullActions: Record<string, ActionDefinition> = {};

  for (const [name, partial] of Object.entries(actions)) {
    fullActions[name] = {
      name,
      namespace,
      fullName: `${namespace}:${name}`,
      description: partial.description || `Test action ${name}`,
      params: partial.params || {},
      steps: partial.steps || [],
      sourcePath: partial.sourcePath || sourcePath,
      ...partial,
    };
  }

  return {
    namespace,
    version: '1.0.0',
    description: `Test namespace ${namespace}`,
    selectors,
    actions: fullActions,
    sourcePath,
  };
}

// ============================================================================
// Merge Rules Tests
// ============================================================================

describe('Registry - Merge Rules', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
  });

  describe('Namespace Merging', () => {
    it('should add new namespace when it does not exist', () => {
      const ns1 = createTestNamespace('common', {
        login: { description: 'Login action' },
      });

      // Access private method for testing
      (registry as any).mergeNamespace(ns1);

      const result = registry.getNamespace('common');
      expect(result).toBeDefined();
      expect(result?.namespace).toBe('common');
      expect(result?.actions.login).toBeDefined();
    });

    it('should merge actions from same namespace - later wins', () => {
      const ns1 = createTestNamespace(
        'common',
        {
          login: { description: 'First login' },
          logout: { description: 'Logout action' },
        },
        {},
        '/path/first.yaml'
      );

      const ns2 = createTestNamespace(
        'common',
        {
          login: { description: 'Second login (overridden)' },
          signup: { description: 'Signup action' },
        },
        {},
        '/path/second.yaml'
      );

      (registry as any).mergeNamespace(ns1);
      (registry as any).mergeNamespace(ns2);

      const result = registry.getNamespace('common');
      expect(result?.actions.login.description).toBe('Second login (overridden)');
      expect(result?.actions.logout.description).toBe('Logout action');
      expect(result?.actions.signup.description).toBe('Signup action');
      expect(result?.sourcePath).toBe('/path/second.yaml'); // Most recent source
    });

    it('should merge selectors from same namespace - later wins', () => {
      const ns1 = createTestNamespace(
        'common',
        {},
        {
          loginButton: '[data-test="login"]',
          submitButton: '[data-test="submit-first"]',
        },
        '/path/first.yaml'
      );

      const ns2 = createTestNamespace(
        'common',
        {},
        {
          submitButton: '[data-test="submit-second"]',
          cancelButton: '[data-test="cancel"]',
        },
        '/path/second.yaml'
      );

      (registry as any).mergeNamespace(ns1);
      (registry as any).mergeNamespace(ns2);

      const result = registry.getNamespace('common');
      expect(result?.selectors.loginButton).toBe('[data-test="login"]');
      expect(result?.selectors.submitButton).toBe('[data-test="submit-second"]');
      expect(result?.selectors.cancelButton).toBe('[data-test="cancel"]');
    });

    it('should preserve actions from earlier namespace when not overridden', () => {
      const ns1 = createTestNamespace('common', {
        action1: { description: 'Action 1' },
        action2: { description: 'Action 2' },
      });

      const ns2 = createTestNamespace('common', {
        action3: { description: 'Action 3' },
      });

      (registry as any).mergeNamespace(ns1);
      (registry as any).mergeNamespace(ns2);

      const result = registry.getNamespace('common');
      expect(Object.keys(result!.actions)).toHaveLength(3);
      expect(result?.actions.action1).toBeDefined();
      expect(result?.actions.action2).toBeDefined();
      expect(result?.actions.action3).toBeDefined();
    });

    it('should track source path of most recent namespace', () => {
      const ns1 = createTestNamespace('common', {}, {}, '/path/first.yaml');
      const ns2 = createTestNamespace('common', {}, {}, '/path/second.yaml');
      const ns3 = createTestNamespace('common', {}, {}, '/path/third.yaml');

      (registry as any).mergeNamespace(ns1);
      (registry as any).mergeNamespace(ns2);
      (registry as any).mergeNamespace(ns3);

      const result = registry.getNamespace('common');
      expect(result?.sourcePath).toBe('/path/third.yaml');
    });
  });

  describe('Action Index Building', () => {
    it('should build index with fully qualified action names', () => {
      const ns1 = createTestNamespace('common', {
        login: {},
        logout: {},
      });

      const ns2 = createTestNamespace('eresh', {
        'dialog:open': {},
        'dialog:close': {},
      });

      (registry as any).mergeNamespace(ns1);
      (registry as any).mergeNamespace(ns2);
      (registry as any).buildIndex();

      expect(registry.hasAction('common:login')).toBe(true);
      expect(registry.hasAction('common:logout')).toBe(true);
      expect(registry.hasAction('eresh:dialog:open')).toBe(true);
      expect(registry.hasAction('eresh:dialog:close')).toBe(true);
      expect(registry.hasAction('common:nonexistent')).toBe(false);
    });

    it('should update index when actions are merged', () => {
      const ns1 = createTestNamespace('common', {
        login: { description: 'First' },
      });

      (registry as any).mergeNamespace(ns1);
      (registry as any).buildIndex();

      let action = registry.getAction('common:login');
      expect(action?.description).toBe('First');

      const ns2 = createTestNamespace('common', {
        login: { description: 'Second' },
      });

      (registry as any).mergeNamespace(ns2);
      (registry as any).buildIndex();

      action = registry.getAction('common:login');
      expect(action?.description).toBe('Second');
    });
  });
});

// ============================================================================
// Query Tests
// ============================================================================

describe('Registry - Queries', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();

    // Setup test data
    const ns1 = createTestNamespace(
      'common',
      {
        login: { description: 'Login to application' },
        logout: { description: 'Logout from application' },
      },
      {
        loginButton: '[data-test="login"]',
        logoutButton: '[data-test="logout"]',
      }
    );

    const ns2 = createTestNamespace(
      'eresh',
      {
        'dialog:open': { description: 'Open a dialog' },
        'dialog:close': { description: 'Close a dialog' },
        'form:submit': { description: 'Submit a form' },
      },
      {
        dialogRoot: '[role="dialog"]',
      }
    );

    (registry as any).mergeNamespace(ns1);
    (registry as any).mergeNamespace(ns2);
    (registry as any).buildIndex();
  });

  it('should get all namespaces', () => {
    const namespaces = registry.getNamespaces();
    expect(namespaces.size).toBe(2);
    expect(namespaces.has('common')).toBe(true);
    expect(namespaces.has('eresh')).toBe(true);
  });

  it('should get specific namespace', () => {
    const ns = registry.getNamespace('common');
    expect(ns).toBeDefined();
    expect(ns?.namespace).toBe('common');
    expect(Object.keys(ns!.actions)).toHaveLength(2);
  });

  it('should get all actions', () => {
    const actions = registry.getAllActions();
    expect(actions).toHaveLength(5);
  });

  it('should get actions by namespace', () => {
    const commonActions = registry.getActionsByNamespace('common');
    expect(commonActions).toHaveLength(2);

    const ereshActions = registry.getActionsByNamespace('eresh');
    expect(ereshActions).toHaveLength(3);

    const nonexistent = registry.getActionsByNamespace('nonexistent');
    expect(nonexistent).toHaveLength(0);
  });

  it('should get specific action by full name', () => {
    const action = registry.getAction('common:login');
    expect(action).toBeDefined();
    expect(action?.name).toBe('login');
    expect(action?.namespace).toBe('common');
    expect(action?.fullName).toBe('common:login');
  });

  it('should get selectors for namespace', () => {
    const selectors = registry.getSelectors('common');
    expect(Object.keys(selectors)).toHaveLength(2);
    expect(selectors.loginButton).toBe('[data-test="login"]');
  });

  it('should get specific selector', () => {
    const selector = registry.getSelector('common', 'loginButton');
    expect(selector).toBe('[data-test="login"]');

    const nonexistent = registry.getSelector('common', 'nonexistent');
    expect(nonexistent).toBeUndefined();
  });

  it('should check if action exists', () => {
    expect(registry.hasAction('common:login')).toBe(true);
    expect(registry.hasAction('common:nonexistent')).toBe(false);
  });

  it('should check if namespace exists', () => {
    expect(registry.hasNamespace('common')).toBe(true);
    expect(registry.hasNamespace('nonexistent')).toBe(false);
  });

  it('should get registry statistics', () => {
    const stats = registry.getStats();
    expect(stats.namespaceCount).toBe(2);
    expect(stats.actionCount).toBe(5);
    expect(stats.selectorCount).toBe(3);
  });
});

// ============================================================================
// Search Tests
// ============================================================================

describe('Registry - Search', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();

    const ns = createTestNamespace('common', {
      login: {
        description: 'Login to the application',
        params: {
          username: {
            type: 'string',
            description: 'User email address',
            required: true,
          },
          password: {
            type: 'string',
            description: 'User password',
            required: true,
            secret: true,
          },
        },
      },
      logout: {
        description: 'Logout from application',
      },
      signup: {
        description: 'Register a new user account',
        params: {
          email: {
            type: 'string',
            description: 'Email address',
            required: true,
          },
        },
      },
    });

    (registry as any).mergeNamespace(ns);
    (registry as any).buildIndex();
  });

  it('should search in action names', () => {
    const results = registry.search('login', {
      searchNames: true,
      searchDescriptions: false,
      searchParams: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].action.name).toBe('login');
    expect(results[0].matches).toContain('name: login');
  });

  it('should search in action descriptions', () => {
    const results = registry.search('application', {
      searchNames: false,
      searchDescriptions: true,
      searchParams: false,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.action.name === 'login')).toBe(true);
    expect(results.some((r) => r.action.name === 'logout')).toBe(true);
  });

  it('should search in parameter names', () => {
    const results = registry.search('email', {
      searchNames: false,
      searchDescriptions: false,
      searchParams: true,
    });

    expect(results.length).toBeGreaterThan(0);
    const loginResult = results.find((r) => r.action.name === 'login');
    expect(loginResult).toBeDefined();
    expect(loginResult?.matches.some((m) => m.includes('param'))).toBe(true);
  });

  it('should search in parameter descriptions', () => {
    const results = registry.search('password', {
      searchNames: false,
      searchDescriptions: false,
      searchParams: true,
    });

    expect(results.length).toBeGreaterThan(0);
    const loginResult = results.find((r) => r.action.name === 'login');
    expect(loginResult).toBeDefined();
  });

  it('should combine multiple search locations', () => {
    const results = registry.search('user', {
      searchNames: true,
      searchDescriptions: true,
      searchParams: true,
    });

    // Should match 'username' param and 'user' in descriptions
    expect(results.length).toBeGreaterThan(0);
  });

  it('should be case-insensitive by default', () => {
    const results1 = registry.search('LOGIN');
    const results2 = registry.search('login');

    expect(results1.length).toBe(results2.length);
    expect(results1[0].action.name).toBe(results2[0].action.name);
  });

  it('should support case-sensitive search', () => {
    const results = registry.search('LOGIN', { caseSensitive: true });
    expect(results).toHaveLength(0);
  });

  it('should filter by namespace', () => {
    const ns2 = createTestNamespace('eresh', {
      login: { description: 'Eresh login' },
    });

    (registry as any).mergeNamespace(ns2);
    (registry as any).buildIndex();

    const results = registry.search('login', { namespace: 'common' });

    expect(results).toHaveLength(1);
    expect(results[0].action.namespace).toBe('common');
  });

  it('should limit results', () => {
    const results = registry.search('', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should sort results by relevance score', () => {
    const results = registry.search('login');

    // Results should be sorted by score (descending)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it('should assign higher score to name matches than description matches', () => {
    const results = registry.search('login');

    const nameMatch = results.find((r) => r.action.name === 'login');
    const descMatch = results.find(
      (r) => r.action.name !== 'login' && r.matches.some((m) => m.includes('description'))
    );

    if (nameMatch && descMatch) {
      expect(nameMatch.score).toBeGreaterThan(descMatch.score);
    }
  });
});

// ============================================================================
// Debug Info Tests
// ============================================================================

describe('Registry - Debug Info', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();

    const ns1 = createTestNamespace(
      'common',
      {
        login: { deprecated: true },
        logout: {},
      },
      {},
      '/path/common.yaml'
    );

    const ns2 = createTestNamespace(
      'eresh',
      {
        'dialog:open': {},
      },
      {},
      '/path/eresh.yaml'
    );

    (registry as any).mergeNamespace(ns1);
    (registry as any).mergeNamespace(ns2);
    (registry as any).buildIndex();
  });

  it('should get debug info about namespaces', () => {
    const info = registry.getDebugInfo();

    expect(info.namespaces).toHaveLength(2);

    const common = info.namespaces.find((ns) => ns.name === 'common');
    expect(common?.actionCount).toBe(2);
    expect(common?.sourcePath).toBe('/path/common.yaml');
  });

  it('should get debug info about actions', () => {
    const info = registry.getDebugInfo();

    expect(info.actions).toHaveLength(3);

    const login = info.actions.find((a) => a.fullName === 'common:login');
    expect(login?.deprecated).toBe(true);
    expect(login?.sourcePath).toBe('/path/common.yaml');
  });
});
