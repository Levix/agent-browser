/**
 * Variable interpolation and expression evaluation system
 *
 * This module provides safe variable interpolation for action definitions,
 * supporting ${var} syntax with multi-level path access and multiple scopes.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Context for variable resolution
 */
export interface VariableContext {
  /** Action parameters */
  params: Record<string, unknown>;

  /** Environment variables */
  env: Record<string, unknown>;

  /** Selector definitions */
  selectors: Record<string, unknown>;

  /** Step outputs from previous steps */
  steps: Record<string, unknown>;
}

/**
 * Result of variable interpolation
 */
export interface InterpolationResult {
  /** Whether interpolation succeeded */
  success: boolean;

  /** Interpolated value */
  value?: unknown;

  /** Error message if failed */
  error?: string;

  /** Variable path that caused the error */
  path?: string;
}

// ============================================================================
// Security Constants
// ============================================================================

/**
 * Dangerous property names that could lead to prototype pollution
 */
const DANGEROUS_PROPERTIES = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Valid scope names
 */
const VALID_SCOPES = new Set(['params', 'env', 'selectors', 'steps']);

// ============================================================================
// Variable Resolution
// ============================================================================

/**
 * Check if a property name is safe to access
 */
function isSafeProperty(prop: string): boolean {
  return !DANGEROUS_PROPERTIES.has(prop);
}

/**
 * Resolve a variable path from context
 *
 * Supports paths like:
 * - params.username
 * - env.API_KEY
 * - selectors.loginButton
 * - steps.login.userId
 *
 * @param path - Variable path (e.g., "params.user.name")
 * @param context - Variable context
 * @returns Resolved value or undefined
 */
function resolveVariablePath(
  path: string,
  context: VariableContext
): { value: unknown; error?: string } {
  const parts = path.split('.');

  if (parts.length === 0) {
    return { value: undefined, error: 'Empty variable path' };
  }

  // First part must be a valid scope
  const scope = parts[0];
  if (!VALID_SCOPES.has(scope)) {
    return {
      value: undefined,
      error: `Invalid scope "${scope}". Must be one of: ${Array.from(VALID_SCOPES).join(', ')}`,
    };
  }

  // Check all parts for dangerous properties
  for (const part of parts) {
    if (!isSafeProperty(part)) {
      return {
        value: undefined,
        error: `Dangerous property "${part}" in path "${path}"`,
      };
    }
  }

  // Start from the scope
  let current: any = context[scope as keyof VariableContext];

  // Navigate through the path (skip the scope itself)
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    if (current === null || current === undefined) {
      return { value: undefined };
    }

    if (typeof current !== 'object') {
      return {
        value: undefined,
        error: `Cannot access property "${part}" of non-object value`,
      };
    }

    current = current[part];
  }

  return { value: current };
}

/**
 * Interpolate variables in a string
 *
 * Replaces ${var} with actual values from context.
 * Supports nested paths like ${params.user.name}
 *
 * @param str - String containing ${var} expressions
 * @param context - Variable context
 * @returns Interpolation result
 */
export function interpolateString(str: string, context: VariableContext): InterpolationResult {
  // Pattern to match ${...} expressions
  const pattern = /\$\{([^}]+)\}/g;

  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  pattern.lastIndex = 0;

  while ((match = pattern.exec(str)) !== null) {
    const fullMatch = match[0];
    const varPath = match[1].trim();

    if (!varPath) {
      return {
        success: false,
        error: 'Empty variable expression',
        path: fullMatch,
      };
    }

    // Resolve the variable
    const { value, error } = resolveVariablePath(varPath, context);

    if (error) {
      return {
        success: false,
        error,
        path: varPath,
      };
    }

    // Convert value to string
    let replacement: string;
    if (value === undefined || value === null) {
      // Return empty string for undefined/null
      replacement = '';
    } else if (typeof value === 'object') {
      // For objects/arrays, use JSON representation
      try {
        replacement = JSON.stringify(value);
      } catch {
        return {
          success: false,
          error: `Cannot stringify value at "${varPath}"`,
          path: varPath,
        };
      }
    } else {
      // For primitives, convert to string
      replacement = String(value);
    }

    // Append the part before the match and the replacement
    result += str.substring(lastIndex, match.index) + replacement;
    lastIndex = match.index + fullMatch.length;
  }

  // Append any remaining part of the string
  result += str.substring(lastIndex);

  return {
    success: true,
    value: result,
  };
}

/**
 * Interpolate variables in any value (string, array, or object)
 *
 * Recursively processes:
 * - Strings: interpolates ${var} expressions
 * - Arrays: processes each element
 * - Objects: processes each property value
 * - Other types: returned as-is
 *
 * @param value - Value to interpolate
 * @param context - Variable context
 * @returns Interpolation result
 */
export function interpolateValue(value: unknown, context: VariableContext): InterpolationResult {
  // Handle strings
  if (typeof value === 'string') {
    return interpolateString(value, context);
  }

  // Handle arrays
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const itemResult = interpolateValue(value[i], context);
      if (!itemResult.success) {
        return {
          success: false,
          error: `In array index ${i}: ${itemResult.error}`,
          path: itemResult.path,
        };
      }
      result.push(itemResult.value);
    }
    return { success: true, value: result };
  }

  // Handle objects
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      // Check for dangerous property names
      if (!isSafeProperty(key)) {
        return {
          success: false,
          error: `Dangerous property name "${key}"`,
          path: key,
        };
      }

      const valResult = interpolateValue(val, context);
      if (!valResult.success) {
        return {
          success: false,
          error: `In property "${key}": ${valResult.error}`,
          path: valResult.path,
        };
      }
      result[key] = valResult.value;
    }
    return { success: true, value: result };
  }

  // Other types (number, boolean, null, undefined) - return as-is
  return { success: true, value };
}

/**
 * Recursively resolve all strings in an object
 *
 * This is a convenience function that wraps interpolateValue
 * and provides a simpler API for the common case.
 *
 * @param obj - Object to resolve
 * @param context - Variable context
 * @returns Resolved object or throws on error
 */
export function resolveObject<T = unknown>(obj: T, context: VariableContext): T {
  const result = interpolateValue(obj, context);

  if (!result.success) {
    throw new Error(
      result.path
        ? `Variable interpolation failed at "${result.path}": ${result.error}`
        : `Variable interpolation failed: ${result.error}`
    );
  }

  return result.value as T;
}

/**
 * Check if a string contains variable expressions
 */
export function hasVariables(str: string): boolean {
  return /\$\{[^}]+\}/.test(str);
}

/**
 * Extract all variable paths from a string
 *
 * @param str - String to extract from
 * @returns Array of variable paths (e.g., ["params.user", "env.API_KEY"])
 */
export function extractVariables(str: string): string[] {
  const pattern = /\$\{([^}]+)\}/g;
  const variables: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(str)) !== null) {
    const varPath = match[1].trim();
    if (varPath) {
      variables.push(varPath);
    }
  }

  return variables;
}

// ============================================================================
// Expression Evaluation System
// ============================================================================

/**
 * Token types for expression evaluation
 */
export enum TokenType {
  // Literals
  IDENTIFIER = 'IDENTIFIER', // Variable names like params.user
  NUMBER = 'NUMBER', // Numeric literals like 42, 3.14
  STRING = 'STRING', // String literals like "hello"
  TRUE = 'TRUE', // Boolean literal true
  FALSE = 'FALSE', // Boolean literal false
  NULL = 'NULL', // Null literal

  // Operators
  EQ = 'EQ', // ==
  NEQ = 'NEQ', // !=
  GT = 'GT', // >
  GTE = 'GTE', // >=
  LT = 'LT', // <
  LTE = 'LTE', // <=
  AND = 'AND', // &&
  OR = 'OR', // ||
  NOT = 'NOT', // !

  // Delimiters
  LPAREN = 'LPAREN', // (
  RPAREN = 'RPAREN', // )

  // Special
  EOF = 'EOF', // End of input
}

/**
 * Token with position information
 */
export interface Token {
  type: TokenType;
  value: string | number | boolean | null;
  position: number;
  length: number;
}

/**
 * Tokenizer error
 */
export class TokenizerError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly input: string
  ) {
    super(`${message} at position ${position}`);
    this.name = 'TokenizerError';
  }
}

/**
 * Tokenizer for expression evaluation
 *
 * Converts expression strings into tokens for parsing.
 * Supports:
 * - Identifiers (variable paths)
 * - Numbers (integers and floats)
 * - Strings (single and double quoted)
 * - Booleans (true/false)
 * - Null
 * - Comparison operators (==, !=, >, <, >=, <=)
 * - Logical operators (&&, ||, !)
 * - Parentheses
 */
export class Tokenizer {
  private input: string;
  private position: number = 0;
  private current: string | null = null;

  constructor(input: string) {
    this.input = input;
    this.current = input.length > 0 ? input[0] : null;
  }

  /**
   * Advance to the next character
   */
  private advance(): void {
    this.position++;
    this.current = this.position < this.input.length ? this.input[this.position] : null;
  }

  /**
   * Peek at the next character without advancing
   */
  private peek(offset: number = 1): string | null {
    const pos = this.position + offset;
    return pos < this.input.length ? this.input[pos] : null;
  }

  /**
   * Skip whitespace
   */
  private skipWhitespace(): void {
    while (this.current !== null && /\s/.test(this.current)) {
      this.advance();
    }
  }

  /**
   * Check if character is a valid identifier start
   */
  private isIdentifierStart(ch: string): boolean {
    return /[a-zA-Z_$]/.test(ch);
  }

  /**
   * Check if character is a valid identifier part
   */
  private isIdentifierPart(ch: string): boolean {
    return /[a-zA-Z0-9_$.]/.test(ch);
  }

  /**
   * Check if character is a digit
   */
  private isDigit(ch: string): boolean {
    return /[0-9]/.test(ch);
  }

  /**
   * Read a number token
   */
  private readNumber(): Token {
    const start = this.position;
    let numStr = '';

    // Read integer part
    while (this.current !== null && this.isDigit(this.current)) {
      numStr += this.current;
      this.advance();
    }

    // Read decimal part if present
    if (this.current === '.' && this.peek() !== null && this.isDigit(this.peek()!)) {
      numStr += this.current;
      this.advance();

      while (this.current !== null && this.isDigit(this.current)) {
        numStr += this.current;
        this.advance();
      }
    }

    const value = parseFloat(numStr);

    return {
      type: TokenType.NUMBER,
      value,
      position: start,
      length: this.position - start,
    };
  }

  /**
   * Read a string token (single or double quoted)
   */
  private readString(quote: string): Token {
    const start = this.position;
    let str = '';

    // Skip opening quote
    this.advance();

    while (this.current !== null && this.current !== quote) {
      // Handle escape sequences
      if (this.current === '\\') {
        this.advance();
        if (this.current === null) {
          throw new TokenizerError('Unterminated string', start, this.input);
        }

        // Simple escape sequences - use type assertion to work around TS literal type narrowing
        const ch: string = this.current;
        if (ch === 'n') {
          str += '\n';
        } else if (ch === 't') {
          str += '\t';
        } else if (ch === 'r') {
          str += '\r';
        } else if (ch === '\\') {
          str += '\\';
        } else if (ch === quote) {
          str += quote;
        } else {
          // For unsupported escapes, keep the character as-is
          str += ch;
        }
        this.advance();
      } else {
        str += this.current;
        this.advance();
      }
    }

    if (this.current !== quote) {
      throw new TokenizerError('Unterminated string', start, this.input);
    }

    // Skip closing quote
    this.advance();

    return {
      type: TokenType.STRING,
      value: str,
      position: start,
      length: this.position - start,
    };
  }

  /**
   * Read an identifier or keyword token
   */
  private readIdentifier(): Token {
    const start = this.position;
    let ident = '';

    while (this.current !== null && this.isIdentifierPart(this.current)) {
      ident += this.current;
      this.advance();
    }

    // Check for keywords
    switch (ident) {
      case 'true':
        return {
          type: TokenType.TRUE,
          value: true,
          position: start,
          length: ident.length,
        };
      case 'false':
        return {
          type: TokenType.FALSE,
          value: false,
          position: start,
          length: ident.length,
        };
      case 'null':
        return {
          type: TokenType.NULL,
          value: null,
          position: start,
          length: ident.length,
        };
      default:
        return {
          type: TokenType.IDENTIFIER,
          value: ident,
          position: start,
          length: ident.length,
        };
    }
  }

  /**
   * Get the next token
   */
  public nextToken(): Token {
    this.skipWhitespace();

    if (this.current === null) {
      return {
        type: TokenType.EOF,
        value: '',
        position: this.position,
        length: 0,
      };
    }

    const start = this.position;

    // Numbers
    if (this.isDigit(this.current)) {
      return this.readNumber();
    }

    // Strings
    if (this.current === '"' || this.current === "'") {
      return this.readString(this.current);
    }

    // Identifiers and keywords
    if (this.isIdentifierStart(this.current)) {
      return this.readIdentifier();
    }

    // Two-character operators
    if (this.current === '=' && this.peek() === '=') {
      this.advance();
      this.advance();
      return {
        type: TokenType.EQ,
        value: '==',
        position: start,
        length: 2,
      };
    }

    if (this.current === '!' && this.peek() === '=') {
      this.advance();
      this.advance();
      return {
        type: TokenType.NEQ,
        value: '!=',
        position: start,
        length: 2,
      };
    }

    if (this.current === '>' && this.peek() === '=') {
      this.advance();
      this.advance();
      return {
        type: TokenType.GTE,
        value: '>=',
        position: start,
        length: 2,
      };
    }

    if (this.current === '<' && this.peek() === '=') {
      this.advance();
      this.advance();
      return {
        type: TokenType.LTE,
        value: '<=',
        position: start,
        length: 2,
      };
    }

    if (this.current === '&' && this.peek() === '&') {
      this.advance();
      this.advance();
      return {
        type: TokenType.AND,
        value: '&&',
        position: start,
        length: 2,
      };
    }

    if (this.current === '|' && this.peek() === '|') {
      this.advance();
      this.advance();
      return {
        type: TokenType.OR,
        value: '||',
        position: start,
        length: 2,
      };
    }

    // Single-character operators
    switch (this.current) {
      case '>':
        this.advance();
        return {
          type: TokenType.GT,
          value: '>',
          position: start,
          length: 1,
        };
      case '<':
        this.advance();
        return {
          type: TokenType.LT,
          value: '<',
          position: start,
          length: 1,
        };
      case '!':
        this.advance();
        return {
          type: TokenType.NOT,
          value: '!',
          position: start,
          length: 1,
        };
      case '(':
        this.advance();
        return {
          type: TokenType.LPAREN,
          value: '(',
          position: start,
          length: 1,
        };
      case ')':
        this.advance();
        return {
          type: TokenType.RPAREN,
          value: ')',
          position: start,
          length: 1,
        };
      default:
        throw new TokenizerError(`Unexpected character '${this.current}'`, start, this.input);
    }
  }

  /**
   * Tokenize the entire input and return all tokens
   */
  public tokenize(): Token[] {
    const tokens: Token[] = [];
    let token: Token;

    do {
      token = this.nextToken();
      tokens.push(token);
    } while (token.type !== TokenType.EOF);

    return tokens;
  }
}

// ============================================================================
// AST Nodes
// ============================================================================

/**
 * AST node types
 */
export enum ASTNodeType {
  // Literals
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',
  IDENTIFIER = 'IDENTIFIER',

  // Binary operations
  BINARY_OP = 'BINARY_OP',

  // Unary operations
  UNARY_OP = 'UNARY_OP',
}

/**
 * Base AST node
 */
export interface ASTNode {
  type: ASTNodeType;
  position: number;
}

/**
 * Number literal node
 */
export interface NumberNode extends ASTNode {
  type: ASTNodeType.NUMBER;
  value: number;
}

/**
 * String literal node
 */
export interface StringNode extends ASTNode {
  type: ASTNodeType.STRING;
  value: string;
}

/**
 * Boolean literal node
 */
export interface BooleanNode extends ASTNode {
  type: ASTNodeType.BOOLEAN;
  value: boolean;
}

/**
 * Null literal node
 */
export interface NullNode extends ASTNode {
  type: ASTNodeType.NULL;
  value: null;
}

/**
 * Identifier node (variable reference)
 */
export interface IdentifierNode extends ASTNode {
  type: ASTNodeType.IDENTIFIER;
  name: string;
}

/**
 * Binary operator types
 */
export type BinaryOperator = '==' | '!=' | '>' | '<' | '>=' | '<=' | '&&' | '||';

/**
 * Binary operation node
 */
export interface BinaryOpNode extends ASTNode {
  type: ASTNodeType.BINARY_OP;
  operator: BinaryOperator;
  left: ASTNode;
  right: ASTNode;
}

/**
 * Unary operator types
 */
export type UnaryOperator = '!';

/**
 * Unary operation node
 */
export interface UnaryOpNode extends ASTNode {
  type: ASTNodeType.UNARY_OP;
  operator: UnaryOperator;
  operand: ASTNode;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parser error
 */
export class ParserError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly input: string
  ) {
    super(`${message} at position ${position}`);
    this.name = 'ParserError';
  }
}

/**
 * Recursive descent parser for expression evaluation
 *
 * Grammar (in order of precedence, lowest to highest):
 *
 * expression    ::= logicalOr
 * logicalOr     ::= logicalAnd ( "||" logicalAnd )*
 * logicalAnd    ::= equality ( "&&" equality )*
 * equality      ::= comparison ( ( "==" | "!=" ) comparison )*
 * comparison    ::= unary ( ( ">" | "<" | ">=" | "<=" ) unary )*
 * unary         ::= "!" unary | primary
 * primary       ::= NUMBER | STRING | BOOLEAN | NULL | IDENTIFIER | "(" expression ")"
 */
export class Parser {
  private tokens: Token[];
  private position: number = 0;
  private input: string;

  constructor(tokens: Token[], input: string) {
    this.tokens = tokens;
    this.input = input;
  }

  /**
   * Get current token
   */
  private current(): Token {
    return this.tokens[this.position];
  }

  /**
   * Check if we're at the end
   */
  private isAtEnd(): boolean {
    return this.current().type === TokenType.EOF;
  }

  /**
   * Advance to next token
   */
  private advance(): Token {
    if (!this.isAtEnd()) {
      this.position++;
    }
    return this.tokens[this.position - 1];
  }

  /**
   * Check if current token matches any of the given types
   */
  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.current().type === type) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  /**
   * Consume a token of the given type or throw error
   */
  private consume(type: TokenType, message: string): Token {
    const token = this.current();
    if (token.type === type) {
      return this.advance();
    }
    throw new ParserError(message, token.position, this.input);
  }

  /**
   * Parse expression (entry point)
   */
  public parse(): ASTNode {
    const expr = this.expression();

    // Ensure we consumed all tokens
    if (!this.isAtEnd()) {
      const token = this.current();
      throw new ParserError(`Unexpected token '${token.value}'`, token.position, this.input);
    }

    return expr;
  }

  /**
   * Parse expression: logicalOr
   */
  private expression(): ASTNode {
    return this.logicalOr();
  }

  /**
   * Parse logical OR: logicalAnd ( "||" logicalAnd )*
   */
  private logicalOr(): ASTNode {
    let left = this.logicalAnd();

    while (this.match(TokenType.OR)) {
      const operator: BinaryOperator = '||';
      const position = left.position;
      const right = this.logicalAnd();

      left = {
        type: ASTNodeType.BINARY_OP,
        operator,
        left,
        right,
        position,
      } as BinaryOpNode;
    }

    return left;
  }

  /**
   * Parse logical AND: equality ( "&&" equality )*
   */
  private logicalAnd(): ASTNode {
    let left = this.equality();

    while (this.match(TokenType.AND)) {
      const operator: BinaryOperator = '&&';
      const position = left.position;
      const right = this.equality();

      left = {
        type: ASTNodeType.BINARY_OP,
        operator,
        left,
        right,
        position,
      } as BinaryOpNode;
    }

    return left;
  }

  /**
   * Parse equality: comparison ( ( "==" | "!=" ) comparison )*
   */
  private equality(): ASTNode {
    let left = this.comparison();

    while (this.match(TokenType.EQ, TokenType.NEQ)) {
      const token = this.tokens[this.position - 1];
      const operator = token.value as BinaryOperator;
      const position = left.position;
      const right = this.comparison();

      left = {
        type: ASTNodeType.BINARY_OP,
        operator,
        left,
        right,
        position,
      } as BinaryOpNode;
    }

    return left;
  }

  /**
   * Parse comparison: unary ( ( ">" | "<" | ">=" | "<=" ) unary )*
   */
  private comparison(): ASTNode {
    let left = this.unary();

    while (this.match(TokenType.GT, TokenType.LT, TokenType.GTE, TokenType.LTE)) {
      const token = this.tokens[this.position - 1];
      const operator = token.value as BinaryOperator;
      const position = left.position;
      const right = this.unary();

      left = {
        type: ASTNodeType.BINARY_OP,
        operator,
        left,
        right,
        position,
      } as BinaryOpNode;
    }

    return left;
  }

  /**
   * Parse unary: "!" unary | primary
   */
  private unary(): ASTNode {
    if (this.match(TokenType.NOT)) {
      const token = this.tokens[this.position - 1];
      const operator: UnaryOperator = '!';
      const operand = this.unary();

      return {
        type: ASTNodeType.UNARY_OP,
        operator,
        operand,
        position: token.position,
      } as UnaryOpNode;
    }

    return this.primary();
  }

  /**
   * Parse primary: NUMBER | STRING | BOOLEAN | NULL | IDENTIFIER | "(" expression ")"
   */
  private primary(): ASTNode {
    const token = this.current();

    // Number literal
    if (this.match(TokenType.NUMBER)) {
      return {
        type: ASTNodeType.NUMBER,
        value: token.value as number,
        position: token.position,
      } as NumberNode;
    }

    // String literal
    if (this.match(TokenType.STRING)) {
      return {
        type: ASTNodeType.STRING,
        value: token.value as string,
        position: token.position,
      } as StringNode;
    }

    // Boolean literals
    if (this.match(TokenType.TRUE, TokenType.FALSE)) {
      return {
        type: ASTNodeType.BOOLEAN,
        value: token.value as boolean,
        position: token.position,
      } as BooleanNode;
    }

    // Null literal
    if (this.match(TokenType.NULL)) {
      return {
        type: ASTNodeType.NULL,
        value: null,
        position: token.position,
      } as NullNode;
    }

    // Identifier (variable reference)
    if (this.match(TokenType.IDENTIFIER)) {
      return {
        type: ASTNodeType.IDENTIFIER,
        name: token.value as string,
        position: token.position,
      } as IdentifierNode;
    }

    // Parenthesized expression
    if (this.match(TokenType.LPAREN)) {
      const expr = this.expression();
      this.consume(TokenType.RPAREN, 'Expected closing parenthesis ")"');
      return expr;
    }

    // Unexpected token
    throw new ParserError(`Unexpected token '${token.value}'`, token.position, this.input);
  }
}

/**
 * Parse an expression string into an AST
 *
 * @param expression - Expression string to parse
 * @returns AST root node
 */
export function parseExpression(expression: string): ASTNode {
  const tokenizer = new Tokenizer(expression);
  const tokens = tokenizer.tokenize();
  const parser = new Parser(tokens, expression);
  return parser.parse();
}

// ============================================================================
// Evaluator
// ============================================================================

/**
 * Evaluator error
 */
export class EvaluatorError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly input: string
  ) {
    super(`${message} at position ${position}`);
    this.name = 'EvaluatorError';
  }
}

/**
 * Maximum AST depth to prevent stack overflow attacks
 */
const MAX_AST_DEPTH = 50;

/**
 * Convert value to boolean using JavaScript truthiness rules
 *
 * Falsy values: false, 0, -0, 0n, "", null, undefined, NaN
 * Everything else is truthy
 */
function toBoolean(value: unknown): boolean {
  return Boolean(value);
}

/**
 * Convert value to number
 *
 * - Numbers: returned as-is
 * - Strings: parsed as float (NaN if invalid)
 * - Booleans: true -> 1, false -> 0
 * - null: 0
 * - undefined: NaN
 * - Objects: NaN
 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === '') {
      return 0;
    }
    const num = parseFloat(value);
    return isNaN(num) ? NaN : num;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (value === null) {
    return 0;
  }

  // undefined, objects, etc.
  return NaN;
}

/**
 * Compare two values for equality using loose comparison rules
 *
 * Similar to JavaScript's == operator but more predictable:
 * - Same types: direct comparison
 * - Different types: convert to numbers and compare
 * - null == undefined returns true
 * - null == null returns true
 * - undefined == undefined returns true
 * - NaN == NaN returns false (following IEEE 754)
 */
function looseEquals(left: unknown, right: unknown): boolean {
  // Strict equality check first
  if (left === right) {
    return true;
  }

  // null == undefined (both ways)
  if ((left === null && right === undefined) || (left === undefined && right === null)) {
    return true;
  }

  // If either is null or undefined (but not both), they're not equal
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }

  // If same type, use strict equality (already checked above, so they're not equal)
  if (typeof left === typeof right) {
    return false;
  }

  // Different types: convert to numbers and compare
  const leftNum = toNumber(left);
  const rightNum = toNumber(right);

  // NaN is never equal to anything, including itself
  if (isNaN(leftNum) || isNaN(rightNum)) {
    return false;
  }

  return leftNum === rightNum;
}

/**
 * Compare two values for ordering
 *
 * Returns:
 * - negative if left < right
 * - 0 if left == right
 * - positive if left > right
 * - NaN if comparison is not possible
 */
function compare(left: unknown, right: unknown): number {
  const leftNum = toNumber(left);
  const rightNum = toNumber(right);

  // If either is NaN, comparison fails
  if (isNaN(leftNum) || isNaN(rightNum)) {
    return NaN;
  }

  return leftNum - rightNum;
}

/**
 * AST Evaluator
 *
 * Evaluates an AST node to produce a value.
 * Supports:
 * - Literals (number, string, boolean, null)
 * - Variables (from context)
 * - Binary operators (==, !=, >, <, >=, <=, &&, ||)
 * - Unary operators (!)
 * - Parentheses (handled by parser)
 *
 * Safety features:
 * - Maximum depth limit (prevents stack overflow)
 * - No function calls
 * - No object/array creation
 * - No assignments
 */
export class Evaluator {
  private context: VariableContext;
  private input: string;
  private depth: number = 0;

  constructor(context: VariableContext, input: string) {
    this.context = context;
    this.input = input;
  }

  /**
   * Evaluate an AST node
   */
  public evaluate(node: ASTNode): unknown {
    // Check depth limit
    this.depth++;
    if (this.depth > MAX_AST_DEPTH) {
      throw new EvaluatorError(
        `Maximum expression depth (${MAX_AST_DEPTH}) exceeded`,
        node.position,
        this.input
      );
    }

    try {
      return this.evaluateNode(node);
    } finally {
      this.depth--;
    }
  }

  /**
   * Internal evaluation method
   */
  private evaluateNode(node: ASTNode): unknown {
    switch (node.type) {
      case ASTNodeType.NUMBER:
        return (node as NumberNode).value;

      case ASTNodeType.STRING:
        return (node as StringNode).value;

      case ASTNodeType.BOOLEAN:
        return (node as BooleanNode).value;

      case ASTNodeType.NULL:
        return null;

      case ASTNodeType.IDENTIFIER:
        return this.evaluateIdentifier(node as IdentifierNode);

      case ASTNodeType.BINARY_OP:
        return this.evaluateBinaryOp(node as BinaryOpNode);

      case ASTNodeType.UNARY_OP:
        return this.evaluateUnaryOp(node as UnaryOpNode);

      default:
        throw new EvaluatorError(
          `Unknown node type: ${(node as any).type}`,
          node.position,
          this.input
        );
    }
  }

  /**
   * Evaluate identifier (variable reference)
   */
  private evaluateIdentifier(node: IdentifierNode): unknown {
    const { value, error } = resolveVariablePath(node.name, this.context);

    if (error) {
      throw new EvaluatorError(error, node.position, this.input);
    }

    return value;
  }

  /**
   * Evaluate binary operation
   */
  private evaluateBinaryOp(node: BinaryOpNode): unknown {
    const { operator, left, right } = node;

    // For logical operators, use short-circuit evaluation
    if (operator === '&&') {
      const leftValue = this.evaluate(left);
      if (!toBoolean(leftValue)) {
        return leftValue; // Return the falsy value
      }
      return this.evaluate(right); // Return right value if left is truthy
    }

    if (operator === '||') {
      const leftValue = this.evaluate(left);
      if (toBoolean(leftValue)) {
        return leftValue; // Return the truthy value
      }
      return this.evaluate(right); // Return right value if left is falsy
    }

    // For other operators, evaluate both sides
    const leftValue = this.evaluate(left);
    const rightValue = this.evaluate(right);

    switch (operator) {
      case '==':
        return looseEquals(leftValue, rightValue);

      case '!=':
        return !looseEquals(leftValue, rightValue);

      case '>': {
        const result = compare(leftValue, rightValue);
        if (isNaN(result)) {
          return false; // Invalid comparison returns false
        }
        return result > 0;
      }

      case '<': {
        const result = compare(leftValue, rightValue);
        if (isNaN(result)) {
          return false; // Invalid comparison returns false
        }
        return result < 0;
      }

      case '>=': {
        const result = compare(leftValue, rightValue);
        if (isNaN(result)) {
          return false; // Invalid comparison returns false
        }
        return result >= 0;
      }

      case '<=': {
        const result = compare(leftValue, rightValue);
        if (isNaN(result)) {
          return false; // Invalid comparison returns false
        }
        return result <= 0;
      }

      default:
        throw new EvaluatorError(`Unknown binary operator: ${operator}`, node.position, this.input);
    }
  }

  /**
   * Evaluate unary operation
   */
  private evaluateUnaryOp(node: UnaryOpNode): unknown {
    const { operator, operand } = node;

    switch (operator) {
      case '!': {
        const value = this.evaluate(operand);
        return !toBoolean(value);
      }

      default:
        throw new EvaluatorError(`Unknown unary operator: ${operator}`, node.position, this.input);
    }
  }
}

/**
 * Evaluate an expression string to a value
 *
 * @param expression - Expression string to evaluate
 * @param context - Variable context
 * @returns Evaluated value
 *
 * @example
 * ```typescript
 * const context = {
 *   params: { age: 25, name: 'Alice' },
 *   env: {},
 *   selectors: {},
 *   steps: {},
 * };
 *
 * evaluateExpression('params.age > 18', context); // true
 * evaluateExpression('params.name == "Alice"', context); // true
 * evaluateExpression('params.age >= 21 && params.name != ""', context); // true
 * ```
 */
export function evaluateExpression(expression: string, context: VariableContext): unknown {
  // Parse the expression into an AST
  const ast = parseExpression(expression);

  // Evaluate the AST
  const evaluator = new Evaluator(context, expression);
  return evaluator.evaluate(ast);
}
