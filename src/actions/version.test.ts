/**
 * Tests for version detection and compatibility management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'playwright';
import {
  detectVersion,
  normalizeVersion,
  isVersionCompatible,
  matchVersion,
  applyVersionOverrides,
  registerDetectionStrategy,
  getDetectionConfig,
  detectComponentVersion,
  getCompatibleAction,
  isNamespaceCompatible,
  selectBestAction,
  type VersionDetectionConfig,
} from './version.js';
import type { ActionDefinition, NamespaceDefinition, ActionCompatibility } from './types.js';

// ============================================================================
// Mock Setup
// ============================================================================

function createMockPage(evaluateFn?: (script: string) => any): Page {
  return {
    evaluate: vi.fn(async (fn, ...args) => {
      if (evaluateFn) {
        return evaluateFn(typeof fn === 'string' ? fn : args[0]);
      }
      return null;
    }),
  } as any;
}

// ============================================================================
// Version Normalization Tests
// ============================================================================

describe('normalizeVersion', () => {
  it('should normalize standard semver', () => {
    expect(normalizeVersion('4.2.1')).toBe('4.2.1');
    expect(normalizeVersion('1.0.0')).toBe('1.0.0');
    expect(normalizeVersion('10.20.30')).toBe('10.20.30');
  });

  it('should normalize versions with "v" prefix', () => {
    expect(normalizeVersion('v4.2.1')).toBe('4.2.1');
    expect(normalizeVersion('V1.0.0')).toBe('1.0.0');
  });

  it('should normalize partial versions', () => {
    expect(normalizeVersion('4.2')).toBe('4.2.0');
    expect(normalizeVersion('4')).toBe('4.0.0');
  });

  it('should handle whitespace', () => {
    expect(normalizeVersion('  4.2.1  ')).toBe('4.2.1');
    expect(normalizeVersion('\t4.2.1\n')).toBe('4.2.1');
  });

  it('should return null for invalid versions', () => {
    expect(normalizeVersion('')).toBeNull();
    expect(normalizeVersion('abc')).toBeNull();
    expect(normalizeVersion('x.y.z')).toBeNull();
  });

  it('should return null for non-string inputs', () => {
    expect(normalizeVersion(null as any)).toBeNull();
    expect(normalizeVersion(undefined as any)).toBeNull();
  });
});

// ============================================================================
// Version Detection Tests
// ============================================================================

describe('detectVersion', () => {
  it('should detect version using versionScript', async () => {
    const page = createMockPage((script) => {
      if (script.includes('__ERESH_VERSION__')) {
        return '4.2.1';
      }
      return null;
    });

    const config: VersionDetectionConfig = {
      namespace: 'eresh',
      versionScript: 'window.__ERESH_VERSION__',
    };

    const result = await detectVersion(page, config);
    expect(result.version).toBe('4.2.1');
    expect(result.method).toBe('script');
    expect(result.raw).toBe('4.2.1');
  });

  it('should detect version using versionSelector', async () => {
    const page = {
      evaluate: vi.fn(async (fn) => {
        // Simulate element with data-version attribute
        return '4.2.1';
      }),
    } as any;

    const config: VersionDetectionConfig = {
      namespace: 'eresh',
      versionSelector: '[data-eresh-version]',
    };

    const result = await detectVersion(page, config);
    expect(result.version).toBe('4.2.1');
    expect(result.method).toBe('selector');
  });

  it('should detect version using versionMeta', async () => {
    const page = {
      evaluate: vi.fn(async (fn) => {
        // Simulate meta tag with content
        return '4.2.1';
      }),
    } as any;

    const config: VersionDetectionConfig = {
      namespace: 'eresh',
      versionMeta: 'eresh:version',
    };

    const result = await detectVersion(page, config);
    expect(result.version).toBe('4.2.1');
    expect(result.method).toBe('meta');
  });

  it('should use custom detector', async () => {
    const page = createMockPage();

    const config: VersionDetectionConfig = {
      namespace: 'eresh',
      customDetector: async () => '4.2.1',
    };

    const result = await detectVersion(page, config);
    expect(result.version).toBe('4.2.1');
    expect(result.method).toBe('custom');
  });

  it('should try methods in order', async () => {
    const page = createMockPage();

    const config: VersionDetectionConfig = {
      namespace: 'eresh',
      customDetector: async () => null, // Returns null, should try next
      versionScript: 'window.__ERESH_VERSION__', // Will also fail
      versionSelector: '[data-version]', // Will also fail
    };

    const result = await detectVersion(page, config);
    expect(result.version).toBeNull();
    expect(result.method).toBe('none');
  });

  it('should handle detection errors gracefully', async () => {
    // Mock console.warn to suppress expected error messages
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const page = {
      evaluate: vi.fn(async () => {
        throw new Error('Page error');
      }),
    } as any;

    const config: VersionDetectionConfig = {
      namespace: 'eresh',
      versionScript: 'window.__ERESH_VERSION__',
    };

    const result = await detectVersion(page, config);
    expect(result.version).toBeNull();
    expect(result.method).toBe('none');

    // Restore console.warn
    consoleWarnSpy.mockRestore();
  });
});

// ============================================================================
// Compatibility Checking Tests
// ============================================================================

describe('isVersionCompatible', () => {
  it('should return true when no constraints', () => {
    expect(isVersionCompatible('4.2.1')).toBe(true);
    expect(isVersionCompatible('4.2.1', {})).toBe(true);
  });

  it('should check minimum version', () => {
    const compat: ActionCompatibility = { minVersion: '4.0.0' };
    expect(isVersionCompatible('4.2.1', compat)).toBe(true);
    expect(isVersionCompatible('4.0.0', compat)).toBe(true);
    expect(isVersionCompatible('3.9.9', compat)).toBe(false);
  });

  it('should check maximum version', () => {
    const compat: ActionCompatibility = { maxVersion: '5.0.0' };
    expect(isVersionCompatible('4.2.1', compat)).toBe(true);
    expect(isVersionCompatible('5.0.0', compat)).toBe(true);
    expect(isVersionCompatible('5.0.1', compat)).toBe(false);
  });

  it('should check both min and max', () => {
    const compat: ActionCompatibility = {
      minVersion: '4.0.0',
      maxVersion: '5.0.0',
    };
    expect(isVersionCompatible('4.2.1', compat)).toBe(true);
    expect(isVersionCompatible('4.0.0', compat)).toBe(true);
    expect(isVersionCompatible('5.0.0', compat)).toBe(true);
    expect(isVersionCompatible('3.9.9', compat)).toBe(false);
    expect(isVersionCompatible('5.0.1', compat)).toBe(false);
  });

  it('should handle invalid versions gracefully', () => {
    const compat: ActionCompatibility = { minVersion: '4.0.0' };
    expect(isVersionCompatible('invalid', compat)).toBe(true); // Assume compatible
  });
});

// ============================================================================
// Version Matching Tests
// ============================================================================

describe('matchVersion', () => {
  it('should match exact version', () => {
    expect(matchVersion('4.2.1', '4.2.1')).toBe(true);
    expect(matchVersion('4.2.1', '4.2.0')).toBe(false);
  });

  it('should match wildcard patterns', () => {
    expect(matchVersion('4.2.1', '4.x')).toBe(true);
    expect(matchVersion('4.0.0', '4.x')).toBe(true);
    expect(matchVersion('5.0.0', '4.x')).toBe(false);

    expect(matchVersion('4.2.1', '4.2.x')).toBe(true);
    expect(matchVersion('4.2.0', '4.2.x')).toBe(true);
    expect(matchVersion('4.3.0', '4.2.x')).toBe(false);
  });

  it('should match semver ranges', () => {
    expect(matchVersion('4.2.1', '>=4.0.0')).toBe(true);
    expect(matchVersion('3.9.9', '>=4.0.0')).toBe(false);

    expect(matchVersion('4.2.1', '^4.2.0')).toBe(true); // 4.x.x
    expect(matchVersion('4.9.0', '^4.2.0')).toBe(true);
    expect(matchVersion('5.0.0', '^4.2.0')).toBe(false);

    expect(matchVersion('4.2.1', '~4.2.0')).toBe(true); // 4.2.x
    expect(matchVersion('4.2.9', '~4.2.0')).toBe(true);
    expect(matchVersion('4.3.0', '~4.2.0')).toBe(false);
  });

  it('should handle invalid versions', () => {
    expect(matchVersion('invalid', '4.x')).toBe(false);
  });
});

// ============================================================================
// Version Overrides Tests
// ============================================================================

describe('applyVersionOverrides', () => {
  const createAction = (steps: any[]): ActionDefinition => ({
    name: 'dialog:open',
    namespace: 'eresh',
    fullName: 'eresh:dialog:open',
    description: 'Open dialog',
    params: {},
    steps: steps.map((step) => {
      // If step has selector at top level, move it to args
      if (step.selector && !step.args?.selector) {
        const { selector, ...rest } = step;
        return {
          ...rest,
          args: { ...rest.args, selector },
        };
      }
      return step;
    }),
    sourcePath: '/test/action.yaml',
  });

  const createNamespace = (overrides?: Record<string, any>): NamespaceDefinition => ({
    namespace: 'eresh',
    version: '1.0.0',
    description: 'Test namespace',
    selectors: {},
    actions: {},
    sourcePath: '/test/namespace.yaml',
    compatibility: {
      versionOverrides: overrides,
    },
  });

  it('should return original action if no version detected', () => {
    const action = createAction([{ action: 'click', selector: '$dialog.openBtn' }]);
    const namespace = createNamespace({
      '4.x': {
        selectors: { 'dialog.openBtn': '.new-selector' },
      },
    });

    const result = applyVersionOverrides(action, namespace, null);
    expect(result).toBe(action); // Same reference
  });

  it('should return original action if no overrides defined', () => {
    const action = createAction([{ action: 'click', selector: '$dialog.openBtn' }]);
    const namespace = createNamespace();

    const result = applyVersionOverrides(action, namespace, '4.2.1');
    expect(result).toBe(action);
  });

  it('should apply matching selector overrides', () => {
    const action = createAction([
      { action: 'click', selector: '$dialog.openBtn' },
      { action: 'fill', selector: '$dialog.input', args: { value: 'test' } },
    ]);
    const namespace = createNamespace({
      '4.x': {
        selectors: {
          'dialog.openBtn': '.btn-open-v4',
          'dialog.input': 'input[name="dialog-input-v4"]',
        },
      },
    });

    const result = applyVersionOverrides(action, namespace, '4.2.1');
    expect(result).not.toBe(action); // New object
    expect(result.steps[0].args.selector).toBe('.btn-open-v4');
    expect(result.steps[1].args.selector).toBe('input[name="dialog-input-v4"]');
  });

  it('should not modify steps without selectors', () => {
    const action = createAction([
      { action: 'wait', args: { timeout: 1000 } },
      { action: 'click', selector: '$dialog.openBtn' },
    ]);
    const namespace = createNamespace({
      '4.x': {
        selectors: { 'dialog.openBtn': '.new-btn' },
      },
    });

    const result = applyVersionOverrides(action, namespace, '4.2.1');
    expect(result.steps[0]).toEqual({ action: 'wait', args: { timeout: 1000 } });
    expect(result.steps[1].args.selector).toBe('.new-btn');
  });

  it('should not modify literal selectors (not starting with $)', () => {
    const action = createAction([{ action: 'click', selector: '.literal-selector' }]);
    const namespace = createNamespace({
      '4.x': {
        selectors: { 'dialog.openBtn': '.new-btn' },
      },
    });

    const result = applyVersionOverrides(action, namespace, '4.2.1');
    expect(result.steps[0].args.selector).toBe('.literal-selector');
  });

  it('should merge multiple matching overrides', () => {
    const action = createAction([
      { action: 'click', selector: '$btn1' },
      { action: 'click', selector: '$btn2' },
    ]);
    const namespace = createNamespace({
      '>=4.0.0': {
        selectors: { btn1: '.btn1-v4' },
      },
      '4.2.x': {
        selectors: { btn2: '.btn2-v4.2' },
      },
    });

    const result = applyVersionOverrides(action, namespace, '4.2.1');
    expect(result.steps[0].args.selector).toBe('.btn1-v4');
    expect(result.steps[1].args.selector).toBe('.btn2-v4.2');
  });

  it('should handle version patterns correctly', () => {
    const action = createAction([{ action: 'click', selector: '$btn' }]);
    const namespace = createNamespace({
      '4.x': {
        selectors: { btn: '.btn-v4' },
      },
      '5.x': {
        selectors: { btn: '.btn-v5' },
      },
    });

    const result4 = applyVersionOverrides(action, namespace, '4.2.1');
    expect(result4.steps[0].args.selector).toBe('.btn-v4');

    const result5 = applyVersionOverrides(action, namespace, '5.1.0');
    expect(result5.steps[0].args.selector).toBe('.btn-v5');
  });
});

// ============================================================================
// Detection Strategy Registry Tests
// ============================================================================

describe('Detection Strategy Registry', () => {
  beforeEach(() => {
    // Clear registry before each test
    // Note: We can't easily clear the private Map, so we'll just override
  });

  it('should register custom detection strategy', () => {
    registerDetectionStrategy('custom', {
      versionScript: 'window.CUSTOM_VERSION',
    });

    const config = getDetectionConfig('custom');
    expect(config.namespace).toBe('custom');
    expect(config.versionScript).toBe('window.CUSTOM_VERSION');
  });

  it('should provide default strategy for unregistered namespace', () => {
    const config = getDetectionConfig('unknown');
    expect(config.namespace).toBe('unknown');
    expect(config.versionScript).toBe('window.__UNKNOWN_VERSION__');
    expect(config.versionMeta).toBe('unknown:version');
    expect(config.versionSelector).toBe('[data-unknown-version]');
  });

  it('should use registered strategy in detectComponentVersion', async () => {
    const page = createMockPage((script) => {
      if (script.includes('MY_CUSTOM_VERSION')) {
        return 'v5.0.0';
      }
      return null;
    });

    registerDetectionStrategy('mylib', {
      versionScript: 'window.MY_CUSTOM_VERSION',
    });

    const result = await detectComponentVersion(page, 'mylib');
    expect(result.version).toBe('5.0.0');
    expect(result.method).toBe('script');
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration: Version Detection and Overrides', () => {
  it('should detect version and apply appropriate overrides', async () => {
    // Setup: Mock page with version
    const page = createMockPage((script) => {
      if (script.includes('__ERESH_VERSION__')) {
        return '4.2.1';
      }
      return null;
    });

    // Detect version
    const versionResult = await detectComponentVersion(page, 'eresh');
    expect(versionResult.version).toBe('4.2.1');

    // Create action and namespace with overrides
    const action: ActionDefinition = {
      name: 'dialog:open',
      namespace: 'eresh',
      fullName: 'eresh:dialog:open',
      description: 'Open dialog',
      params: {},
      steps: [
        { action: 'click', args: { selector: '$dialog.trigger' } },
        { action: 'wait', args: { timeout: 500 } },
      ],
      sourcePath: '/test/action.yaml',
    };

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Eresh UI Library',
      selectors: {
        'dialog.trigger': '.dialog-trigger-default',
      },
      actions: {},
      sourcePath: '/test/namespace.yaml',
      compatibility: {
        minVersion: '4.0.0',
        maxVersion: '5.0.0',
        versionOverrides: {
          '4.x': {
            selectors: {
              'dialog.trigger': '.dialog-trigger-v4',
            },
          },
        },
      },
    };

    // Check compatibility
    expect(isVersionCompatible(versionResult.version!, namespace.compatibility)).toBe(true);

    // Apply overrides
    const overriddenAction = applyVersionOverrides(action, namespace, versionResult.version);

    expect(overriddenAction.steps[0].args.selector).toBe('.dialog-trigger-v4');
    expect(overriddenAction.steps[1]).toEqual({
      action: 'wait',
      args: { timeout: 500 },
    });
  });
});

// ============================================================================
// High-Level Integration Functions Tests
// ============================================================================

describe('getCompatibleAction', () => {
  it('should return action with overrides when compatible', async () => {
    const page = createMockPage((script) => {
      if (script.includes('__ERESH_VERSION__')) {
        return '4.2.1';
      }
      return null;
    });

    const action: ActionDefinition = {
      name: 'login',
      namespace: 'eresh',
      fullName: 'eresh:login',
      description: 'Login action',
      params: {},
      steps: [{ action: 'click', args: { selector: '$loginBtn' } }],
      sourcePath: '/test/action.yaml',
      compatibility: {
        minVersion: '4.0.0',
        maxVersion: '5.0.0',
      },
    };

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
      compatibility: {
        versionOverrides: {
          '4.x': {
            selectors: { loginBtn: '.login-v4' },
          },
        },
      },
    };

    const result = await getCompatibleAction(page, action, namespace);
    expect(result).not.toBeNull();
    expect(result!.steps[0].args.selector).toBe('.login-v4');
  });

  it('should return null when version is incompatible', async () => {
    const page = createMockPage((script) => {
      if (script.includes('__ERESH_VERSION__')) {
        return '3.0.0'; // Below minimum
      }
      return null;
    });

    const action: ActionDefinition = {
      name: 'login',
      namespace: 'eresh',
      fullName: 'eresh:login',
      description: 'Login action',
      params: {},
      steps: [{ action: 'click', args: { selector: '$loginBtn' } }],
      sourcePath: '/test/action.yaml',
      compatibility: {
        minVersion: '4.0.0',
        maxVersion: '5.0.0',
      },
    };

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
    };

    const result = await getCompatibleAction(page, action, namespace);
    expect(result).toBeNull();
  });

  it('should return action when no version detected', async () => {
    const page = createMockPage(() => null);

    const action: ActionDefinition = {
      name: 'login',
      namespace: 'eresh',
      fullName: 'eresh:login',
      description: 'Login action',
      params: {},
      steps: [{ action: 'click', args: { selector: '.login' } }],
      sourcePath: '/test/action.yaml',
    };

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
    };

    const result = await getCompatibleAction(page, action, namespace);
    expect(result).not.toBeNull();
    expect(result!.steps[0].args.selector).toBe('.login');
  });
});

describe('isNamespaceCompatible', () => {
  it('should return true when version is within constraints', async () => {
    const page = createMockPage((script) => {
      if (script.includes('__ERESH_VERSION__')) {
        return '4.5.0';
      }
      return null;
    });

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
      compatibility: {
        minVersion: '4.0.0',
        maxVersion: '5.0.0',
      },
    };

    const result = await isNamespaceCompatible(page, namespace);
    expect(result).toBe(true);
  });

  it('should return false when version is outside constraints', async () => {
    const page = createMockPage((script) => {
      if (script.includes('__ERESH_VERSION__')) {
        return '6.0.0'; // Above maximum
      }
      return null;
    });

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
      compatibility: {
        minVersion: '4.0.0',
        maxVersion: '5.0.0',
      },
    };

    const result = await isNamespaceCompatible(page, namespace);
    expect(result).toBe(false);
  });

  it('should return true when no constraints specified', async () => {
    const page = createMockPage(() => null);

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
    };

    const result = await isNamespaceCompatible(page, namespace);
    expect(result).toBe(true);
  });

  it('should return true when version cannot be detected', async () => {
    const page = createMockPage(() => null);

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
      compatibility: {
        minVersion: '4.0.0',
      },
    };

    const result = await isNamespaceCompatible(page, namespace);
    expect(result).toBe(true); // Assume compatible when can't detect
  });
});

describe('selectBestAction', () => {
  it('should select most specific compatible action', async () => {
    const page = createMockPage((script) => {
      if (script.includes('__ERESH_VERSION__')) {
        return '4.5.0';
      }
      return null;
    });

    const actions: ActionDefinition[] = [
      {
        name: 'login',
        namespace: 'eresh',
        fullName: 'eresh:login',
        description: 'Generic login',
        params: {},
        steps: [{ action: 'click', args: { selector: '.generic' } }],
        sourcePath: '/test/1.yaml',
      },
      {
        name: 'login',
        namespace: 'eresh',
        fullName: 'eresh:login',
        description: 'v4 specific login',
        params: {},
        steps: [{ action: 'click', args: { selector: '$btn' } }],
        sourcePath: '/test/2.yaml',
        compatibility: {
          minVersion: '4.0.0',
          maxVersion: '4.9.9',
        },
      },
      {
        name: 'login',
        namespace: 'eresh',
        fullName: 'eresh:login',
        description: 'v5 specific login',
        params: {},
        steps: [{ action: 'click', args: { selector: '.v5-btn' } }],
        sourcePath: '/test/3.yaml',
        compatibility: {
          minVersion: '5.0.0',
        },
      },
    ];

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
      compatibility: {
        versionOverrides: {
          '4.x': {
            selectors: { btn: '.btn-v4' },
          },
        },
      },
    };

    const result = await selectBestAction(page, actions, namespace);
    expect(result).not.toBeNull();
    // Should select the v4 specific one (index 1) and apply overrides
    expect(result!.description).toBe('v4 specific login');
    expect(result!.steps[0].args.selector).toBe('.btn-v4');
  });

  it('should return null when no compatible action found', async () => {
    const page = createMockPage((script) => {
      if (script.includes('__ERESH_VERSION__')) {
        return '6.0.0';
      }
      return null;
    });

    const actions: ActionDefinition[] = [
      {
        name: 'login',
        namespace: 'eresh',
        fullName: 'eresh:login',
        description: 'Old version only',
        params: {},
        steps: [{ action: 'click', args: { selector: '.btn' } }],
        sourcePath: '/test/1.yaml',
        compatibility: {
          maxVersion: '5.0.0',
        },
      },
    ];

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
    };

    const result = await selectBestAction(page, actions, namespace);
    expect(result).toBeNull();
  });

  it('should return first action without constraints when no version detected', async () => {
    const page = createMockPage(() => null);

    const actions: ActionDefinition[] = [
      {
        name: 'login',
        namespace: 'eresh',
        fullName: 'eresh:login',
        description: 'Fallback',
        params: {},
        steps: [{ action: 'click', args: { selector: '.fallback' } }],
        sourcePath: '/test/1.yaml',
      },
      {
        name: 'login',
        namespace: 'eresh',
        fullName: 'eresh:login',
        description: 'v4 specific',
        params: {},
        steps: [{ action: 'click', args: { selector: '.v4' } }],
        sourcePath: '/test/2.yaml',
        compatibility: {
          minVersion: '4.0.0',
        },
      },
    ];

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
    };

    const result = await selectBestAction(page, actions, namespace);
    expect(result).not.toBeNull();
    expect(result!.description).toBe('Fallback');
  });

  it('should handle empty action array', async () => {
    const page = createMockPage(() => '4.0.0');

    const namespace: NamespaceDefinition = {
      namespace: 'eresh',
      version: '1.0.0',
      description: 'Test',
      selectors: {},
      actions: {},
      sourcePath: '/test/ns.yaml',
    };

    const result = await selectBestAction(page, [], namespace);
    expect(result).toBeNull();
  });
});
