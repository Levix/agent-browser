/**
 * Tests for AST Evaluator
 */

import { describe, it, expect } from 'vitest';
import { evaluateExpression, EvaluatorError, type VariableContext } from './vars';

describe('Evaluator', () => {
  // Helper to create a basic context
  const createContext = (params: Record<string, unknown> = {}): VariableContext => ({
    params,
    env: {},
    selectors: {},
    steps: {},
  });

  describe('Literal evaluation', () => {
    it('should evaluate number literals', () => {
      const context = createContext();
      expect(evaluateExpression('42', context)).toBe(42);
      expect(evaluateExpression('3.14', context)).toBe(3.14);
      expect(evaluateExpression('0', context)).toBe(0);
    });

    it('should evaluate string literals', () => {
      const context = createContext();
      expect(evaluateExpression('"hello"', context)).toBe('hello');
      expect(evaluateExpression("'world'", context)).toBe('world');
      expect(evaluateExpression('""', context)).toBe('');
    });

    it('should evaluate boolean literals', () => {
      const context = createContext();
      expect(evaluateExpression('true', context)).toBe(true);
      expect(evaluateExpression('false', context)).toBe(false);
    });

    it('should evaluate null literal', () => {
      const context = createContext();
      expect(evaluateExpression('null', context)).toBe(null);
    });
  });

  describe('Variable evaluation', () => {
    it('should resolve simple variables', () => {
      const context = createContext({ name: 'Alice', age: 25 });
      expect(evaluateExpression('params.name', context)).toBe('Alice');
      expect(evaluateExpression('params.age', context)).toBe(25);
    });

    it('should resolve nested variables', () => {
      const context = createContext({
        user: { name: 'Bob', address: { city: 'NYC' } },
      });
      expect(evaluateExpression('params.user.name', context)).toBe('Bob');
      expect(evaluateExpression('params.user.address.city', context)).toBe('NYC');
    });

    it('should handle undefined variables', () => {
      const context = createContext();
      expect(evaluateExpression('params.missing', context)).toBeUndefined();
    });

    it('should throw error for invalid scope', () => {
      const context = createContext();
      expect(() => evaluateExpression('invalid.scope', context)).toThrow(EvaluatorError);
    });
  });

  describe('Comparison operators', () => {
    it('should evaluate equality (==)', () => {
      const context = createContext({ a: 5, b: 5, c: 10 });
      expect(evaluateExpression('params.a == params.b', context)).toBe(true);
      expect(evaluateExpression('params.a == params.c', context)).toBe(false);
      expect(evaluateExpression('params.a == 5', context)).toBe(true);
      expect(evaluateExpression('"hello" == "hello"', context)).toBe(true);
      expect(evaluateExpression('true == true', context)).toBe(true);
    });

    it('should evaluate inequality (!=)', () => {
      const context = createContext({ a: 5, b: 10 });
      expect(evaluateExpression('params.a != params.b', context)).toBe(true);
      expect(evaluateExpression('params.a != 5', context)).toBe(false);
      expect(evaluateExpression('"hello" != "world"', context)).toBe(true);
    });

    it('should evaluate greater than (>)', () => {
      const context = createContext({ a: 10, b: 5 });
      expect(evaluateExpression('params.a > params.b', context)).toBe(true);
      expect(evaluateExpression('params.b > params.a', context)).toBe(false);
      expect(evaluateExpression('params.a > 10', context)).toBe(false);
      expect(evaluateExpression('params.a > 5', context)).toBe(true);
    });

    it('should evaluate greater than or equal (>=)', () => {
      const context = createContext({ a: 10, b: 10, c: 5 });
      expect(evaluateExpression('params.a >= params.b', context)).toBe(true);
      expect(evaluateExpression('params.a >= params.c', context)).toBe(true);
      expect(evaluateExpression('params.c >= params.a', context)).toBe(false);
    });

    it('should evaluate less than (<)', () => {
      const context = createContext({ a: 5, b: 10 });
      expect(evaluateExpression('params.a < params.b', context)).toBe(true);
      expect(evaluateExpression('params.b < params.a', context)).toBe(false);
      expect(evaluateExpression('params.a < 5', context)).toBe(false);
    });

    it('should evaluate less than or equal (<=)', () => {
      const context = createContext({ a: 5, b: 5, c: 10 });
      expect(evaluateExpression('params.a <= params.b', context)).toBe(true);
      expect(evaluateExpression('params.a <= params.c', context)).toBe(true);
      expect(evaluateExpression('params.c <= params.a', context)).toBe(false);
    });
  });

  describe('Logical operators', () => {
    it('should evaluate logical AND (&&)', () => {
      const context = createContext({ a: true, b: true, c: false });
      expect(evaluateExpression('params.a && params.b', context)).toBe(true);
      expect(evaluateExpression('params.a && params.c', context)).toBe(false);
      expect(evaluateExpression('params.c && params.a', context)).toBe(false);
      expect(evaluateExpression('true && true', context)).toBe(true);
      expect(evaluateExpression('true && false', context)).toBe(false);
    });

    it('should evaluate logical OR (||)', () => {
      const context = createContext({ a: true, b: false, c: false });
      expect(evaluateExpression('params.a || params.b', context)).toBe(true);
      expect(evaluateExpression('params.b || params.a', context)).toBe(true);
      expect(evaluateExpression('params.b || params.c', context)).toBe(false);
      expect(evaluateExpression('false || false', context)).toBe(false);
      expect(evaluateExpression('false || true', context)).toBe(true);
    });

    it('should evaluate logical NOT (!)', () => {
      const context = createContext({ a: true, b: false });
      expect(evaluateExpression('!params.a', context)).toBe(false);
      expect(evaluateExpression('!params.b', context)).toBe(true);
      expect(evaluateExpression('!true', context)).toBe(false);
      expect(evaluateExpression('!false', context)).toBe(true);
    });

    it('should support short-circuit evaluation for AND', () => {
      const context = createContext({ a: false });
      // Second operand should not be evaluated if first is false
      expect(evaluateExpression('params.a && params.nonexistent.value', context)).toBe(false);
    });

    it('should support short-circuit evaluation for OR', () => {
      const context = createContext({ a: true });
      // Second operand should not be evaluated if first is true
      expect(evaluateExpression('params.a || params.nonexistent.value', context)).toBe(true);
    });
  });

  describe('Type conversion', () => {
    it('should convert types for equality comparison', () => {
      const context = createContext({ num: 5, str: '5' });
      expect(evaluateExpression('params.num == params.str', context)).toBe(true);
      expect(evaluateExpression('params.num == "5"', context)).toBe(true);
    });

    it('should convert types for ordering comparison', () => {
      const context = createContext({ num: 5, str: '10' });
      expect(evaluateExpression('params.str > params.num', context)).toBe(true);
      expect(evaluateExpression('"100" > 50', context)).toBe(true);
    });

    it('should handle null and undefined in comparisons', () => {
      const context = createContext({ a: null });
      expect(evaluateExpression('params.a == null', context)).toBe(true);
      // undefined == null returns true (following JavaScript semantics)
      expect(evaluateExpression('params.missing == null', context)).toBe(true);
    });

    it('should use truthiness for logical operators', () => {
      const context = createContext({ zero: 0, empty: '', one: 1, text: 'hello' });
      expect(evaluateExpression('params.zero || params.one', context)).toBe(1);
      expect(evaluateExpression('params.empty || params.text', context)).toBe('hello');
      expect(evaluateExpression('params.one && params.text', context)).toBe('hello');
      expect(evaluateExpression('params.zero && params.text', context)).toBe(0);
    });
  });

  describe('Parentheses', () => {
    it('should support parenthesized expressions', () => {
      const context = createContext({ a: 5, b: 10, c: 15 });
      expect(evaluateExpression('params.a < params.c', context)).toBe(true);
      expect(evaluateExpression('(params.a < params.b) && (params.b < params.c)', context)).toBe(
        true
      );
    });

    it('should respect operator precedence with parentheses', () => {
      const context = createContext();
      expect(evaluateExpression('true || false && false', context)).toBe(true);
      expect(evaluateExpression('(true || false) && false', context)).toBe(false);
    });

    it('should support nested parentheses', () => {
      const context = createContext();
      expect(evaluateExpression('((true))', context)).toBe(true);
      expect(evaluateExpression('(!(true))', context)).toBe(false);
    });
  });

  describe('Complex expressions', () => {
    it('should evaluate complex boolean logic', () => {
      const context = createContext({ age: 25, status: 'active', score: 85 });

      expect(evaluateExpression('params.age >= 18 && params.status == "active"', context)).toBe(
        true
      );

      expect(
        evaluateExpression(
          'params.age >= 18 && params.status == "active" && params.score > 80',
          context
        )
      ).toBe(true);

      expect(
        evaluateExpression(
          '(params.age < 18 || params.status != "active") && params.score > 90',
          context
        )
      ).toBe(false);
    });

    it('should handle multiple comparisons', () => {
      const context = createContext({ x: 5 });
      expect(evaluateExpression('params.x > 0 && params.x < 10', context)).toBe(true);
      expect(evaluateExpression('params.x <= 0 || params.x >= 10', context)).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle NaN in comparisons', () => {
      const context = createContext({ invalid: 'not a number' });
      // Comparing strings that can't be converted to numbers should return false
      expect(evaluateExpression('params.invalid > 5', context)).toBe(false);
      expect(evaluateExpression('params.invalid < 5', context)).toBe(false);
    });

    it('should handle empty strings', () => {
      const context = createContext({ empty: '' });
      expect(evaluateExpression('params.empty == ""', context)).toBe(true);
      expect(evaluateExpression('!params.empty', context)).toBe(true);
    });

    it('should handle zero values', () => {
      const context = createContext({ zero: 0 });
      expect(evaluateExpression('params.zero == 0', context)).toBe(true);
      expect(evaluateExpression('!params.zero', context)).toBe(true);
      expect(evaluateExpression('params.zero || 5', context)).toBe(5);
    });
  });

  describe('Security and safety', () => {
    it('should reject dangerous property access', () => {
      const context = createContext();
      expect(() => evaluateExpression('params.__proto__', context)).toThrow();
      expect(() => evaluateExpression('params.constructor', context)).toThrow();
      expect(() => evaluateExpression('params.prototype', context)).toThrow();
    });

    it('should enforce maximum depth limit', () => {
      const context = createContext();
      // Create a deeply nested expression
      let expr = 'true';
      for (let i = 0; i < 60; i++) {
        expr = `!${expr}`;
      }
      expect(() => evaluateExpression(expr, context)).toThrow(EvaluatorError);
      expect(() => evaluateExpression(expr, context)).toThrow(/maximum.*depth/i);
    });
  });

  describe('Error handling', () => {
    it('should provide meaningful error messages', () => {
      const context = createContext();

      try {
        evaluateExpression('invalid.scope', context);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(EvaluatorError);
        expect((error as EvaluatorError).message).toContain('Invalid scope');
      }
    });

    it('should include position information in errors', () => {
      const context = createContext();

      try {
        evaluateExpression('invalid.scope', context);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(EvaluatorError);
        expect((error as EvaluatorError).position).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle form validation expressions', () => {
      const context = createContext({
        email: 'user@example.com',
        password: 'secret123',
        age: 25,
        terms: true,
      });

      expect(evaluateExpression('params.email != "" && params.password != ""', context)).toBe(true);

      expect(evaluateExpression('params.age >= 18 && params.terms == true', context)).toBe(true);
    });

    it('should handle conditional step execution', () => {
      const context = {
        params: {},
        env: { DEBUG: 'true' },
        selectors: {},
        steps: { login: { success: true, userId: 123 } },
      };

      expect(evaluateExpression('env.DEBUG == "true"', context)).toBe(true);
      expect(evaluateExpression('steps.login.success == true', context)).toBe(true);
      expect(evaluateExpression('steps.login.success && steps.login.userId > 0', context)).toBe(
        true
      );
    });

    it('should handle status checks', () => {
      const context = {
        params: {},
        env: {},
        selectors: {},
        steps: {
          api_call: { status: 200, data: { count: 5 } },
        },
      };

      expect(evaluateExpression('steps.api_call.status == 200', context)).toBe(true);

      expect(
        evaluateExpression('steps.api_call.status == 200 && steps.api_call.data.count > 0', context)
      ).toBe(true);
    });
  });
});
