/**
 * Tests for Tokenizer (Expression Lexical Analysis)
 */

import { describe, it, expect } from 'vitest';
import { Tokenizer, TokenType, TokenizerError } from './vars';

describe('Tokenizer', () => {
  describe('Basic Tokens', () => {
    it('should tokenize numbers', () => {
      const tokenizer = new Tokenizer('42');
      const tokens = tokenizer.tokenize();

      expect(tokens).toHaveLength(2); // NUMBER + EOF
      expect(tokens[0]).toMatchObject({
        type: TokenType.NUMBER,
        value: 42,
        position: 0,
        length: 2,
      });
      expect(tokens[1].type).toBe(TokenType.EOF);
    });

    it('should tokenize floating point numbers', () => {
      const tokenizer = new Tokenizer('3.14');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.NUMBER,
        value: 3.14,
        position: 0,
        length: 4,
      });
    });

    it('should tokenize strings with double quotes', () => {
      const tokenizer = new Tokenizer('"hello world"');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.STRING,
        value: 'hello world',
        position: 0,
        length: 13,
      });
    });

    it('should tokenize strings with single quotes', () => {
      const tokenizer = new Tokenizer("'hello world'");
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.STRING,
        value: 'hello world',
        position: 0,
        length: 13,
      });
    });

    it('should handle escape sequences in strings', () => {
      const tokenizer = new Tokenizer('"hello\\nworld\\ttab"');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.STRING,
        value: 'hello\nworld\ttab',
      });
    });

    it('should handle escaped quotes', () => {
      const tokenizer = new Tokenizer('"say \\"hello\\""');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.STRING,
        value: 'say "hello"',
      });
    });

    it('should tokenize boolean true', () => {
      const tokenizer = new Tokenizer('true');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.TRUE,
        value: true,
        position: 0,
        length: 4,
      });
    });

    it('should tokenize boolean false', () => {
      const tokenizer = new Tokenizer('false');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.FALSE,
        value: false,
        position: 0,
        length: 5,
      });
    });

    it('should tokenize null', () => {
      const tokenizer = new Tokenizer('null');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.NULL,
        value: null,
        position: 0,
        length: 4,
      });
    });

    it('should tokenize identifiers', () => {
      const tokenizer = new Tokenizer('username');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.IDENTIFIER,
        value: 'username',
        position: 0,
        length: 8,
      });
    });

    it('should tokenize identifiers with dots (variable paths)', () => {
      const tokenizer = new Tokenizer('params.user.name');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.IDENTIFIER,
        value: 'params.user.name',
        position: 0,
        length: 16,
      });
    });

    it('should tokenize identifiers with underscores and dollar signs', () => {
      const tokenizer = new Tokenizer('$_user_123');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.IDENTIFIER,
        value: '$_user_123',
      });
    });
  });

  describe('Operators', () => {
    it('should tokenize == operator', () => {
      const tokenizer = new Tokenizer('==');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.EQ,
        value: '==',
        position: 0,
        length: 2,
      });
    });

    it('should tokenize != operator', () => {
      const tokenizer = new Tokenizer('!=');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.NEQ,
        value: '!=',
      });
    });

    it('should tokenize > operator', () => {
      const tokenizer = new Tokenizer('>');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.GT,
        value: '>',
      });
    });

    it('should tokenize >= operator', () => {
      const tokenizer = new Tokenizer('>=');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.GTE,
        value: '>=',
      });
    });

    it('should tokenize < operator', () => {
      const tokenizer = new Tokenizer('<');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.LT,
        value: '<',
      });
    });

    it('should tokenize <= operator', () => {
      const tokenizer = new Tokenizer('<=');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.LTE,
        value: '<=',
      });
    });

    it('should tokenize && operator', () => {
      const tokenizer = new Tokenizer('&&');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.AND,
        value: '&&',
      });
    });

    it('should tokenize || operator', () => {
      const tokenizer = new Tokenizer('||');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.OR,
        value: '||',
      });
    });

    it('should tokenize ! operator', () => {
      const tokenizer = new Tokenizer('!');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.NOT,
        value: '!',
      });
    });
  });

  describe('Delimiters', () => {
    it('should tokenize parentheses', () => {
      const tokenizer = new Tokenizer('()');
      const tokens = tokenizer.tokenize();

      expect(tokens).toHaveLength(3); // LPAREN + RPAREN + EOF
      expect(tokens[0]).toMatchObject({
        type: TokenType.LPAREN,
        value: '(',
      });
      expect(tokens[1]).toMatchObject({
        type: TokenType.RPAREN,
        value: ')',
      });
    });
  });

  describe('Complex Expressions', () => {
    it('should tokenize comparison expression', () => {
      const tokenizer = new Tokenizer('age > 18');
      const tokens = tokenizer.tokenize();

      expect(tokens).toHaveLength(4); // IDENTIFIER + GT + NUMBER + EOF
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[0].value).toBe('age');
      expect(tokens[1].type).toBe(TokenType.GT);
      expect(tokens[2].type).toBe(TokenType.NUMBER);
      expect(tokens[2].value).toBe(18);
    });

    it('should tokenize equality expression', () => {
      const tokenizer = new Tokenizer('status == "active"');
      const tokens = tokenizer.tokenize();

      expect(tokens).toHaveLength(4); // IDENTIFIER + EQ + STRING + EOF
      expect(tokens[0].value).toBe('status');
      expect(tokens[1].type).toBe(TokenType.EQ);
      expect(tokens[2].value).toBe('active');
    });

    it('should tokenize logical AND expression', () => {
      const tokenizer = new Tokenizer('age > 18 && status == "active"');
      const tokens = tokenizer.tokenize();

      expect(tokens).toHaveLength(8); // 7 tokens + EOF
      expect(tokens[0].value).toBe('age');
      expect(tokens[1].type).toBe(TokenType.GT);
      expect(tokens[2].value).toBe(18);
      expect(tokens[3].type).toBe(TokenType.AND);
      expect(tokens[4].value).toBe('status');
      expect(tokens[5].type).toBe(TokenType.EQ);
      expect(tokens[6].value).toBe('active');
    });

    it('should tokenize expression with parentheses', () => {
      const tokenizer = new Tokenizer('(age > 18) && (status == "active")');
      const tokens = tokenizer.tokenize();

      expect(tokens[0].type).toBe(TokenType.LPAREN);
      expect(tokens[1].value).toBe('age');
      expect(tokens[4].type).toBe(TokenType.RPAREN);
      expect(tokens[5].type).toBe(TokenType.AND);
      expect(tokens[6].type).toBe(TokenType.LPAREN);
    });

    it('should tokenize negation expression', () => {
      const tokenizer = new Tokenizer('!isActive');
      const tokens = tokenizer.tokenize();

      expect(tokens[0].type).toBe(TokenType.NOT);
      expect(tokens[1].value).toBe('isActive');
    });

    it('should tokenize variable path comparison', () => {
      const tokenizer = new Tokenizer('params.user.age >= 21');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        type: TokenType.IDENTIFIER,
        value: 'params.user.age',
      });
      expect(tokens[1].type).toBe(TokenType.GTE);
      expect(tokens[2]).toMatchObject({
        type: TokenType.NUMBER,
        value: 21,
      });
    });
  });

  describe('Whitespace Handling', () => {
    it('should skip whitespace', () => {
      const tokenizer = new Tokenizer('  age   >   18  ');
      const tokens = tokenizer.tokenize();

      expect(tokens).toHaveLength(4); // IDENTIFIER + GT + NUMBER + EOF
      expect(tokens[0].value).toBe('age');
      expect(tokens[1].type).toBe(TokenType.GT);
      expect(tokens[2].value).toBe(18);
    });

    it('should handle tabs and newlines', () => {
      const tokenizer = new Tokenizer('age\t>\n18');
      const tokens = tokenizer.tokenize();

      expect(tokens).toHaveLength(4);
      expect(tokens[0].value).toBe('age');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty input', () => {
      const tokenizer = new Tokenizer('');
      const tokens = tokenizer.tokenize();

      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe(TokenType.EOF);
    });

    it('should handle only whitespace', () => {
      const tokenizer = new Tokenizer('   ');
      const tokens = tokenizer.tokenize();

      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe(TokenType.EOF);
    });

    it('should handle numbers at start of identifier-like sequence', () => {
      const tokenizer = new Tokenizer('123abc');
      const tokens = tokenizer.tokenize();

      // Should be tokenized as NUMBER followed by IDENTIFIER
      expect(tokens).toHaveLength(3); // NUMBER + IDENTIFIER + EOF
      expect(tokens[0].type).toBe(TokenType.NUMBER);
      expect(tokens[0].value).toBe(123);
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[1].value).toBe('abc');
    });
  });

  describe('Error Cases', () => {
    it('should throw on unterminated string (double quote)', () => {
      const tokenizer = new Tokenizer('"hello');

      expect(() => tokenizer.tokenize()).toThrow(TokenizerError);
      expect(() => {
        const t = new Tokenizer('"hello');
        t.tokenize();
      }).toThrow('Unterminated string');
    });

    it('should throw on unterminated string (single quote)', () => {
      const tokenizer = new Tokenizer("'hello");

      expect(() => tokenizer.tokenize()).toThrow(TokenizerError);
    });

    it('should throw on unexpected character', () => {
      const tokenizer = new Tokenizer('age @ 18');

      expect(() => tokenizer.tokenize()).toThrow(TokenizerError);
      expect(() => {
        const t = new Tokenizer('age @ 18');
        t.tokenize();
      }).toThrow("Unexpected character '@'");
    });

    it('should throw on unterminated escape sequence', () => {
      const tokenizer = new Tokenizer('"hello\\');

      expect(() => tokenizer.tokenize()).toThrow(TokenizerError);
      expect(() => {
        const t = new Tokenizer('"hello\\');
        t.tokenize();
      }).toThrow('Unterminated string');
    });
  });

  describe('Position Tracking', () => {
    it('should track position correctly', () => {
      const tokenizer = new Tokenizer('age > 18');
      const tokens = tokenizer.tokenize();

      expect(tokens[0].position).toBe(0); // 'age' starts at 0
      expect(tokens[1].position).toBe(4); // '>' starts at 4
      expect(tokens[2].position).toBe(6); // '18' starts at 6
    });

    it('should track length correctly', () => {
      const tokenizer = new Tokenizer('params.user.name');
      const tokens = tokenizer.tokenize();

      expect(tokens[0]).toMatchObject({
        position: 0,
        length: 16,
      });
    });
  });

  describe('nextToken() method', () => {
    it('should return tokens one by one', () => {
      const tokenizer = new Tokenizer('a b c');

      const token1 = tokenizer.nextToken();
      expect(token1.type).toBe(TokenType.IDENTIFIER);
      expect(token1.value).toBe('a');

      const token2 = tokenizer.nextToken();
      expect(token2.type).toBe(TokenType.IDENTIFIER);
      expect(token2.value).toBe('b');

      const token3 = tokenizer.nextToken();
      expect(token3.type).toBe(TokenType.IDENTIFIER);
      expect(token3.value).toBe('c');

      const token4 = tokenizer.nextToken();
      expect(token4.type).toBe(TokenType.EOF);
    });

    it('should return EOF repeatedly after input is consumed', () => {
      const tokenizer = new Tokenizer('x');

      tokenizer.nextToken(); // IDENTIFIER
      const eof1 = tokenizer.nextToken(); // EOF
      const eof2 = tokenizer.nextToken(); // EOF again

      expect(eof1.type).toBe(TokenType.EOF);
      expect(eof2.type).toBe(TokenType.EOF);
    });
  });
});
