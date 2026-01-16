/**
 * Tests for expression parser
 */

import { describe, it, expect } from 'vitest';
import {
  parseExpression,
  ASTNodeType,
  ParserError,
  type ASTNode,
  type BinaryOpNode,
  type UnaryOpNode,
  type NumberNode,
  type StringNode,
  type BooleanNode,
  type IdentifierNode,
  type NullNode,
} from './vars';

describe('Parser', () => {
  describe('Literals', () => {
    it('should parse number literals', () => {
      const node = parseExpression('42') as NumberNode;
      expect(node.type).toBe(ASTNodeType.NUMBER);
      expect(node.value).toBe(42);
    });

    it('should parse float literals', () => {
      const node = parseExpression('3.14') as NumberNode;
      expect(node.type).toBe(ASTNodeType.NUMBER);
      expect(node.value).toBe(3.14);
    });

    it('should parse string literals with double quotes', () => {
      const node = parseExpression('"hello"') as StringNode;
      expect(node.type).toBe(ASTNodeType.STRING);
      expect(node.value).toBe('hello');
    });

    it('should parse string literals with single quotes', () => {
      const node = parseExpression("'world'") as StringNode;
      expect(node.type).toBe(ASTNodeType.STRING);
      expect(node.value).toBe('world');
    });

    it('should parse true literal', () => {
      const node = parseExpression('true') as BooleanNode;
      expect(node.type).toBe(ASTNodeType.BOOLEAN);
      expect(node.value).toBe(true);
    });

    it('should parse false literal', () => {
      const node = parseExpression('false') as BooleanNode;
      expect(node.type).toBe(ASTNodeType.BOOLEAN);
      expect(node.value).toBe(false);
    });

    it('should parse null literal', () => {
      const node = parseExpression('null') as NullNode;
      expect(node.type).toBe(ASTNodeType.NULL);
      expect(node.value).toBe(null);
    });

    it('should parse identifiers', () => {
      const node = parseExpression('params.username') as IdentifierNode;
      expect(node.type).toBe(ASTNodeType.IDENTIFIER);
      expect(node.name).toBe('params.username');
    });
  });

  describe('Comparison operators', () => {
    it('should parse equality (==)', () => {
      const node = parseExpression('5 == 5') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('==');
      expect((node.left as NumberNode).value).toBe(5);
      expect((node.right as NumberNode).value).toBe(5);
    });

    it('should parse inequality (!=)', () => {
      const node = parseExpression('5 != 3') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('!=');
      expect((node.left as NumberNode).value).toBe(5);
      expect((node.right as NumberNode).value).toBe(3);
    });

    it('should parse greater than (>)', () => {
      const node = parseExpression('10 > 5') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('>');
      expect((node.left as NumberNode).value).toBe(10);
      expect((node.right as NumberNode).value).toBe(5);
    });

    it('should parse less than (<)', () => {
      const node = parseExpression('3 < 7') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('<');
      expect((node.left as NumberNode).value).toBe(3);
      expect((node.right as NumberNode).value).toBe(7);
    });

    it('should parse greater than or equal (>=)', () => {
      const node = parseExpression('10 >= 10') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('>=');
      expect((node.left as NumberNode).value).toBe(10);
      expect((node.right as NumberNode).value).toBe(10);
    });

    it('should parse less than or equal (<=)', () => {
      const node = parseExpression('5 <= 10') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('<=');
      expect((node.left as NumberNode).value).toBe(5);
      expect((node.right as NumberNode).value).toBe(10);
    });

    it('should parse string comparison', () => {
      const node = parseExpression('"hello" == "world"') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('==');
      expect((node.left as StringNode).value).toBe('hello');
      expect((node.right as StringNode).value).toBe('world');
    });
  });

  describe('Logical operators', () => {
    it('should parse AND (&&)', () => {
      const node = parseExpression('true && false') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('&&');
      expect((node.left as BooleanNode).value).toBe(true);
      expect((node.right as BooleanNode).value).toBe(false);
    });

    it('should parse OR (||)', () => {
      const node = parseExpression('true || false') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('||');
      expect((node.left as BooleanNode).value).toBe(true);
      expect((node.right as BooleanNode).value).toBe(false);
    });

    it('should parse NOT (!)', () => {
      const node = parseExpression('!true') as UnaryOpNode;
      expect(node.type).toBe(ASTNodeType.UNARY_OP);
      expect(node.operator).toBe('!');
      expect((node.operand as BooleanNode).value).toBe(true);
    });

    it('should parse double negation', () => {
      const node = parseExpression('!!true') as UnaryOpNode;
      expect(node.type).toBe(ASTNodeType.UNARY_OP);
      expect(node.operator).toBe('!');

      const inner = node.operand as UnaryOpNode;
      expect(inner.type).toBe(ASTNodeType.UNARY_OP);
      expect(inner.operator).toBe('!');
      expect((inner.operand as BooleanNode).value).toBe(true);
    });
  });

  describe('Operator precedence', () => {
    it('should respect comparison before logical AND', () => {
      // 5 > 3 && 2 < 4  =>  (5 > 3) && (2 < 4)
      const node = parseExpression('5 > 3 && 2 < 4') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('&&');

      const left = node.left as BinaryOpNode;
      expect(left.operator).toBe('>');
      expect((left.left as NumberNode).value).toBe(5);
      expect((left.right as NumberNode).value).toBe(3);

      const right = node.right as BinaryOpNode;
      expect(right.operator).toBe('<');
      expect((right.left as NumberNode).value).toBe(2);
      expect((right.right as NumberNode).value).toBe(4);
    });

    it('should respect logical AND before logical OR', () => {
      // true || false && true  =>  true || (false && true)
      const node = parseExpression('true || false && true') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('||');
      expect((node.left as BooleanNode).value).toBe(true);

      const right = node.right as BinaryOpNode;
      expect(right.operator).toBe('&&');
      expect((right.left as BooleanNode).value).toBe(false);
      expect((right.right as BooleanNode).value).toBe(true);
    });

    it('should respect unary NOT before binary operators', () => {
      // !true && false  =>  (!true) && false
      const node = parseExpression('!true && false') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('&&');

      const left = node.left as UnaryOpNode;
      expect(left.type).toBe(ASTNodeType.UNARY_OP);
      expect(left.operator).toBe('!');
      expect((left.operand as BooleanNode).value).toBe(true);

      expect((node.right as BooleanNode).value).toBe(false);
    });
  });

  describe('Parentheses', () => {
    it('should parse parenthesized expressions', () => {
      // Test parentheses with comparison operator
      const node = parseExpression('(5 > 3)') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('>');
      expect((node.left as NumberNode).value).toBe(5);
      expect((node.right as NumberNode).value).toBe(3);
    });

    it('should override operator precedence with parentheses', () => {
      // (true || false) && true  =>  true because true || false => true, true && true => true
      const node = parseExpression('(true || false) && true') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('&&');

      const left = node.left as BinaryOpNode;
      expect(left.type).toBe(ASTNodeType.BINARY_OP);
      expect(left.operator).toBe('||');
      expect((left.left as BooleanNode).value).toBe(true);
      expect((left.right as BooleanNode).value).toBe(false);

      expect((node.right as BooleanNode).value).toBe(true);
    });

    it('should parse nested parentheses', () => {
      const node = parseExpression('((5 > 3))') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('>');
    });
  });

  describe('Complex expressions', () => {
    it('should parse complex logical expression', () => {
      // (status == "active" || status == "pending") && count > 0
      const expr = '(params.status == "active" || params.status == "pending") && params.count > 0';
      const node = parseExpression(expr) as BinaryOpNode;

      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('&&');

      // Left: (status == "active" || status == "pending")
      const left = node.left as BinaryOpNode;
      expect(left.operator).toBe('||');

      // Right: count > 0
      const right = node.right as BinaryOpNode;
      expect(right.operator).toBe('>');
      expect((right.left as IdentifierNode).name).toBe('params.count');
      expect((right.right as NumberNode).value).toBe(0);
    });

    it('should parse chained comparisons', () => {
      // In real usage: 1 < x && x < 10
      const node = parseExpression('1 < params.x && params.x < 10') as BinaryOpNode;
      expect(node.type).toBe(ASTNodeType.BINARY_OP);
      expect(node.operator).toBe('&&');

      const left = node.left as BinaryOpNode;
      expect(left.operator).toBe('<');
      expect((left.left as NumberNode).value).toBe(1);
      expect((left.right as IdentifierNode).name).toBe('params.x');

      const right = node.right as BinaryOpNode;
      expect(right.operator).toBe('<');
      expect((right.left as IdentifierNode).name).toBe('params.x');
      expect((right.right as NumberNode).value).toBe(10);
    });

    it('should parse negated comparisons', () => {
      const node = parseExpression('!(params.x > 10)') as UnaryOpNode;
      expect(node.type).toBe(ASTNodeType.UNARY_OP);
      expect(node.operator).toBe('!');

      const operand = node.operand as BinaryOpNode;
      expect(operand.operator).toBe('>');
      expect((operand.left as IdentifierNode).name).toBe('params.x');
      expect((operand.right as NumberNode).value).toBe(10);
    });
  });

  describe('Error handling', () => {
    it('should throw error for unclosed parenthesis', () => {
      expect(() => parseExpression('(5 > 3')).toThrow(ParserError);
      expect(() => parseExpression('(5 > 3')).toThrow('Expected closing parenthesis ")"');
    });

    it('should throw error for unexpected token', () => {
      expect(() => parseExpression('5 >')).toThrow(ParserError);
      expect(() => parseExpression('5 >')).toThrow('Unexpected token');
    });

    it('should throw error for invalid operator sequence', () => {
      expect(() => parseExpression('5 == == 3')).toThrow(ParserError);
    });

    it('should throw error for trailing tokens', () => {
      expect(() => parseExpression('5 > 3 )')).toThrow(ParserError);
      expect(() => parseExpression('5 > 3 )')).toThrow('Unexpected token');
    });

    it('should throw error for empty expression', () => {
      expect(() => parseExpression('')).toThrow(ParserError);
    });

    it('should provide position information in errors', () => {
      try {
        parseExpression('5 > (3');
      } catch (error) {
        expect(error).toBeInstanceOf(ParserError);
        if (error instanceof ParserError) {
          expect(error.position).toBeGreaterThanOrEqual(0);
          expect(error.input).toBe('5 > (3');
        }
      }
    });
  });

  describe('Whitespace handling', () => {
    it('should handle expressions with various whitespace', () => {
      const node1 = parseExpression('5>3') as BinaryOpNode;
      const node2 = parseExpression('5 > 3') as BinaryOpNode;
      const node3 = parseExpression('  5   >   3  ') as BinaryOpNode;

      expect(node1.operator).toBe('>');
      expect(node2.operator).toBe('>');
      expect(node3.operator).toBe('>');
    });

    it('should handle newlines and tabs', () => {
      const node = parseExpression('5\n>\t3') as BinaryOpNode;
      expect(node.operator).toBe('>');
      expect((node.left as NumberNode).value).toBe(5);
      expect((node.right as NumberNode).value).toBe(3);
    });
  });
});
