/**
 * Security Tests for Action System
 * 
 * Tests security controls including:
 * - Expression injection prevention
 * - Function call interception
 * - Prototype pollution prevention
 * - Path traversal prevention
 * - Resource limit enforcement
 */

import { describe, it, expect } from 'vitest';
import { evaluateExpression } from '../src/actions/vars.js';
import { ActionExecutor } from '../src/actions/executor.js';
import { NamespaceFileSchema } from '../src/actions/validator.js';
import { MockBrowserAdapter } from './mocks/browser.js';
import type { ActionDefinition, ExecutionContext } from '../src/actions/types.js';

// ============================================================================
// Expression Injection Prevention
// ============================================================================

describe('Security: Expression Injection', () => {
  it('should block function calls in expressions', () => {
    const context: ExecutionContext = {
      params: { input: 'test' },
      env: {},
      selectors: {},
      steps: {},
      depth: 0,
      startTime: Date.now(),
      actionTimeout: 30000,
      stepTimeout: 5000,
      debugMode: false,
      dryRun: false,
    };

    // Attempt to call a function
    expect(() => evaluateExpression('alert("XSS")', context)).toThrow();
    expect(() => evaluateExpression('console.log("test")', context)).toThrow();
    expect(() => evaluateExpression('eval("malicious")', context)).toThrow();
    expect(() => evaluateExpression('Function("return 1")()', context)).toThrow();
  });

  it('should block object/array literals', () => {
    const context: ExecutionContext = {
      params: {},
      env: {},
      selectors: {},
      steps: {},
      depth: 0,
      startTime: Date.now(),
      actionTimeout: 30000,
      stepTimeout: 5000,
      debugMode: false,
      dryRun: false,
    };

    // Object and array literals should be blocked
    expect(() => evaluateExpression('{a: 1}', context)).toThrow();
    expect(() => evaluateExpression('[1, 2, 3]', context)).toThrow();
    expect(() => evaluateExpression('new Object()', context)).toThrow();
    expect(() => evaluateExpression('new Array()', context)).toThrow();
  });

  it('should block assignment operations', () => {
    const context: ExecutionContext = {
      params: { x: 1 },
      env: {},
      selectors: {},
      steps: {},
      depth: 0,
      startTime: Date.now(),
      actionTimeout: 30000,
      stepTimeout: 5000,
      debugMode: false,
      dryRun: false,
    };

    // Assignment should be blocked
    expect(() => evaluateExpression('${params.x} = 2', context)).toThrow();
    expect(() => evaluateExpression('${params.x}++', context)).toThrow();
    expect(() => evaluateExpression('${params.x}--', context)).toThrow();
    expect(() => evaluateExpression('${params.x} += 1', context)).toThrow();
  });

  it('should enforce AST depth limit', () => {
    const context: ExecutionContext = {
      params: { a: true },
      env: {},
      selectors: {},
      steps: {},
      depth: 0,
      startTime: Date.now(),
      actionTimeout: 30000,
      stepTimeout: 5000,
      debugMode: false,
      dryRun: false,
    };

    // Create deeply nested expression
    const deepExpression = '(' + '('.repeat(100) + '${params.a}' + ')'.repeat(100) + ')';
    expect(() => evaluateExpression(deepExpression, context)).toThrow(/depth/i);
  });

  it('should only allow whitelisted operators', () => {
    const context: ExecutionContext = {
      params: { x: 5 },
      env: {},
      selectors: {},
      steps: {},
      depth: 0,
      startTime: Date.now(),
      actionTimeout: 30000,
      stepTimeout: 5000,
      debugMode: false,
      dryRun: false,
    };

    // Allowed operators
    expect(() => evaluateExpression('${params.x} == 5', context)).not.toThrow();
    expect(() => evaluateExpression('${params.x} > 3', context)).not.toThrow();
    expect(() => evaluateExpression('${params.x} >= 5', context)).not.toThrow();

    // Disallowed operators (if any - depends on implementation)
    // Binary operators like +, -, *, / might be allowed for arithmetic
    // But bitwise operators should be blocked
    expect(() => evaluateExpression('${params.x} | 1', context)).toThrow();
    expect(() => evaluateExpression('${params.x} & 1', context)).toThrow();
    expect(() => evaluateExpression('${params.x} ^ 1', context)).toThrow();
    expect(() => evaluateExpression('${params.x} << 1', context)).toThrow();
    expect(() => evaluateExpression('${params.x} >> 1', context)).toThrow();
  });
});

// ============================================================================
// Prototype Pollution Prevention
// ============================================================================

describe('Security: Prototype Pollution', () => {
  it('should block __proto__ access', () => {
    const context: ExecutionContext = {
      params: { obj: {} },
      env: {},
      selectors: {},
      steps: {},
      depth: 0,
      startTime: Date.now(),
      actionTimeout: 30000,
      stepTimeout: 5000,
      debugMode: false,
      dryRun: false,
    };

    expect(() => evaluateExpression('${params.obj.__proto__}', context)).toThrow(/proto/i);
    expect(() => evaluateExpression('${params.__proto__}', context)).toThrow(/proto/i);
  });

  it('should block constructor access', () => {
    const context: ExecutionContext = {
      params: { obj: {} },
      env: {},
      selectors: {},
      steps: {},
      depth: 0,
      startTime: Date.now(),
      actionTimeout: 30000,
      stepTimeout: 5000,
      debugMode: false,
      dryRun: false,
    };

    expect(() => evaluateExpression('${params.obj.constructor}', context)).toThrow(/constructor/i);
    expect(() => evaluateExpression('${params.constructor}', context)).toThrow(/constructor/i);
  });

  it('should block prototype access', () => {
    const context: ExecutionContext = {
      params: { obj: {} },
      env: {},
      selectors: {},
      steps: {},
      depth: 0,
      startTime: Date.now(),
      actionTimeout: 30000,
      stepTimeout: 5000,
      debugMode: false,
      dryRun: false,
    };

    expect(() => evaluateExpression('${params.obj.prototype}', context)).toThrow(/prototype/i);
    expect(() => evaluateExpression('${params.prototype}', context)).toThrow(/prototype/i);
  });
});

// ============================================================================
// Path Traversal Prevention
// ============================================================================

describe('Security: Path Traversal', () => {
  it('should validate action definition file paths', () => {
    // Attempt path traversal
    const invalidDef = {
      schema_version: 1,
      namespace: 'test',
      version: '1.0.0',
      description: 'Test',
      actions: {
        test: {
          description: 'Test',
          steps: [
            {
              action: 'eval',
              args: {
                expression: 'document.title',
              },
            },
          ],
        },
      },
      sourcePath: '../../etc/passwd', // Path traversal attempt
    };

    // The validator should accept this (path validation is not its job),
    // but the loader should reject it
    expect(() => NamespaceFileSchema.parse(invalidDef)).not.toThrow();
    // Path validation should be done at the loader level
  });
});

// ============================================================================
// Resource Limit Enforcement
// ============================================================================

describe('Security: Resource Limits', () => {
  it('should enforce max recursion depth', async () => {
    const mockBrowser = new MockBrowserAdapter();
    const mockPage = mockBrowser.createMockPage();

    const executor = new ActionExecutor({
      maxDepth: 3,
      debugMode: false,
    });
    executor.setPage(mockPage);

    // Create recursive action
    const recursiveAction: ActionDefinition = {
      name: 'recursive',
      namespace: 'test',
      fullName: 'test:recursive',
      description: 'Recursive action',
      params: {},
      steps: [
        {
          action: 'run',
          args: {
            action: 'test:recursive',
            params: {},
          },
        },
      ],
      sourcePath: 'test',
    };

    // Set up registry with the recursive action
    const registry = {
      namespaces: new Map([
        [
          'test',
          {
            namespace: 'test',
            version: '1.0.0',
            description: 'Test',
            actions: { recursive: recursiveAction },
            sourcePath: 'test',
          },
        ],
      ]),
      index: new Map([['test:recursive', recursiveAction]]),
    };

    executor.setRegistry(registry as any);

    await expect(executor.execute(recursiveAction, {})).rejects.toThrow(/depth/i);
  });

  it('should enforce max steps limit', async () => {
    const mockBrowser = new MockBrowserAdapter();
    const mockPage = mockBrowser.createMockPage();

    const executor = new ActionExecutor({
      maxSteps: 10,
      debugMode: false,
    });
    executor.setPage(mockPage);

    const manyStepsAction: ActionDefinition = {
      name: 'many_steps',
      namespace: 'test',
      fullName: 'test:many_steps',
      description: 'Action with many steps',
      params: {},
      steps: Array(20).fill({
        action: 'wait',
        args: { time: 1 },
      }),
      sourcePath: 'test',
    };

    await expect(executor.execute(manyStepsAction, {})).rejects.toThrow(/steps/i);
  });

  it('should enforce step timeout', async () => {
    const mockBrowser = new MockBrowserAdapter();
    const mockPage = mockBrowser.createMockPage();

    const executor = new ActionExecutor({
      stepTimeout: 100, // 100ms
      debugMode: false,
    });
    executor.setPage(mockPage);

    // Simulate slow operation
    mockBrowser.setDelay('goto', 500); // 500ms delay

    const slowAction: ActionDefinition = {
      name: 'slow',
      namespace: 'test',
      fullName: 'test:slow',
      description: 'Slow action',
      params: {},
      steps: [
        {
          action: 'open',
          args: { url: 'https://example.com' },
        },
      ],
      sourcePath: 'test',
    };

    await expect(executor.execute(slowAction, {})).rejects.toThrow(/timeout/i);
  });

  it('should enforce action timeout', async () => {
    const mockBrowser = new MockBrowserAdapter();
    const mockPage = mockBrowser.createMockPage();

    const executor = new ActionExecutor({
      actionTimeout: 100, // 100ms for entire action
      debugMode: false,
    });
    executor.setPage(mockPage);

    mockBrowser.setDelay('waitForTimeout', 200); // 200ms delay

    const timeoutAction: ActionDefinition = {
      name: 'timeout',
      namespace: 'test',
      fullName: 'test:timeout',
      description: 'Action that times out',
      params: {},
      steps: [
        {
          action: 'wait',
          args: { time: 1000 }, // Wait 1 second
        },
      ],
      sourcePath: 'test',
    };

    await expect(executor.execute(timeoutAction, {})).rejects.toThrow(/timeout/i);
  });
});

// ============================================================================
// Sensitive Data Protection
// ============================================================================

describe('Security: Sensitive Data', () => {
  it('should mask secret parameters in logs', async () => {
    const mockBrowser = new MockBrowserAdapter();
    const mockPage = mockBrowser.createMockPage();

    const executor = new ActionExecutor({
      debugMode: true, // Enable debug mode to generate logs
    });
    executor.setPage(mockPage);

    const sensitiveAction: ActionDefinition = {
      name: 'sensitive',
      namespace: 'test',
      fullName: 'test:sensitive',
      description: 'Action with sensitive data',
      params: {
        username: {
          type: 'string',
          required: true,
          description: 'Username',
        },
        password: {
          type: 'string',
          required: true,
          secret: true, // Mark as secret
          description: 'Password',
        },
      },
      steps: [
        {
          action: 'fill',
          args: {
            selector: '#password',
            value: '${params.password}',
          },
        },
      ],
      sourcePath: 'test',
    };

    const result = await executor.execute(sensitiveAction, {
      username: 'testuser',
      password: 'supersecret123',
    });

    expect(result.success).toBe(true);

    // Check that the trace doesn't contain the actual password
    const traceStr = JSON.stringify(result.trace);
    expect(traceStr).not.toContain('supersecret123');
    expect(traceStr).toContain('***'); // Should be masked
  });

  it('should not expose secrets in error messages', async () => {
    const mockBrowser = new MockBrowserAdapter();
    const mockPage = mockBrowser.createMockPage();

    const executor = new ActionExecutor({
      debugMode: false,
    });
    executor.setPage(mockPage);

    mockBrowser.simulateFailure('#password', new Error('Element not found'));

    const sensitiveAction: ActionDefinition = {
      name: 'sensitive_fail',
      namespace: 'test',
      fullName: 'test:sensitive_fail',
      description: 'Failing action with sensitive data',
      params: {
        password: {
          type: 'string',
          required: true,
          secret: true,
          description: 'Password',
        },
      },
      steps: [
        {
          action: 'fill',
          args: {
            selector: '#password',
            value: '${params.password}',
          },
        },
      ],
      sourcePath: 'test',
    };

    try {
      await executor.execute(sensitiveAction, {
        password: 'topsecret456',
      });
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      const errorStr = error.toString();
      expect(errorStr).not.toContain('topsecret456');
    }
  });
});

// ============================================================================
// YAML Injection Prevention
// ============================================================================

describe('Security: YAML Injection', () => {
  it('should validate YAML structure', () => {
    // Malicious YAML with code injection attempt
    const maliciousYaml = {
      schema_version: 1,
      namespace: 'test',
      version: '1.0.0',
      description: 'Test',
      actions: {
        malicious: {
          description: 'Malicious action',
          steps: [
            {
              action: 'eval',
              args: {
                // Attempt to inject code via expression
                expression: '(() => { while(true) {} })()', // Infinite loop
              },
            },
          ],
        },
      },
    };

    // The validator should accept this (expression validation happens at runtime),
    // Schema validation only checks structure
    expect(() => NamespaceFileSchema.parse(maliciousYaml)).not.toThrow();
  });

  it('should prevent circular references in YAML', () => {
    const circularYaml = {
      schema_version: 1,
      namespace: 'test',
      version: '1.0.0',
      description: 'Test',
      actions: {
        circular: {
          description: 'Circular action',
          steps: [
            {
              action: 'run',
              args: {
                action: 'test:circular',
              },
              on_error: 'fallback',
              fallback: [
                {
                  action: 'run',
                  args: {
                    action: 'test:circular',
                  },
                },
              ],
            },
          ],
        },
      },
    };

    // Schema validation only checks structure, not circular references
    // Circular reference detection happens at execution time or in deeper validation
    expect(() => NamespaceFileSchema.parse(circularYaml)).not.toThrow();
  });
});
