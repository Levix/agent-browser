/**
 * 错误处理测试
 */

import { describe, it, expect } from 'vitest';
import {
  ActionErrorCode,
  createActionError,
  mapPlaywrightError,
  ErrorSuggestionGenerator,
  isActionError,
  normalizeError,
} from './errors.js';

describe('errors', () => {
  describe('createActionError', () => {
    it('should create action error with basic info', () => {
      const error = createActionError(ActionErrorCode.ACTION_NOT_FOUND, 'Action not found');

      expect(error.code).toBe(ActionErrorCode.ACTION_NOT_FOUND);
      expect(error.message).toBe('Action not found');
    });

    it('should create action error with full context', () => {
      const error = createActionError(ActionErrorCode.ELEMENT_NOT_FOUND, 'Element not found', {
        step: 1,
        action: 'common:login',
        sourcePath: '/path/to/action.yaml',
        details: { selector: '#username' },
        suggestion: 'Check selector',
      });

      expect(error.step).toBe(1);
      expect(error.action).toBe('common:login');
      expect(error.sourcePath).toBe('/path/to/action.yaml');
      expect(error.details).toEqual({ selector: '#username' });
      expect(error.suggestion).toBe('Check selector');
    });

    it('should preserve cause error stack', () => {
      const cause = new Error('Original error');
      const error = createActionError(ActionErrorCode.TIMEOUT, 'Timeout occurred', { cause });

      expect(error.cause).toBe(cause);
      expect(error.stack).toContain('Caused by:');
    });
  });

  describe('mapPlaywrightError', () => {
    it('should map timeout error', () => {
      const pwError = new Error('Timeout 5000ms exceeded');
      const error = mapPlaywrightError(pwError, { step: 1 });

      expect(error.code).toBe(ActionErrorCode.TIMEOUT);
      expect(error.step).toBe(1);
      expect(error.suggestion).toContain('timeout');
    });

    it('should map element not visible error', () => {
      const pwError = new Error('waiting for selector "#username" to be visible');
      const error = mapPlaywrightError(pwError);

      expect(error.code).toBe(ActionErrorCode.ELEMENT_NOT_FOUND);
      expect(error.suggestion).toContain('#username');
    });

    it('should map strict mode violation', () => {
      const pwError = new Error('strict mode violation: selector resolved to 3 elements');
      const error = mapPlaywrightError(pwError);

      expect(error.code).toBe(ActionErrorCode.MULTIPLE_ELEMENTS_FOUND);
      expect(error.suggestion).toContain('3 个元素');
    });

    it('should map network error', () => {
      const pwError = new Error('net::ERR_CONNECTION_REFUSED');
      const error = mapPlaywrightError(pwError);

      expect(error.code).toBe(ActionErrorCode.NETWORK_ERROR);
    });

    it('should map navigation timeout', () => {
      const pwError = new Error('Navigation timeout of 30000ms exceeded');
      const error = mapPlaywrightError(pwError);

      expect(error.code).toBe(ActionErrorCode.NAVIGATION_ERROR);
    });

    it('should map page closed error', () => {
      const pwError = new Error('Navigation failed because page was closed');
      const error = mapPlaywrightError(pwError);

      expect(error.code).toBe(ActionErrorCode.PAGE_CRASHED);
    });

    it('should handle unknown playwright error', () => {
      const pwError = new Error('Some unknown playwright error');
      const error = mapPlaywrightError(pwError);

      expect(error.code).toBe(ActionErrorCode.BROWSER_ERROR);
      expect(error.suggestion).toBeTruthy();
    });
  });

  describe('ErrorSuggestionGenerator', () => {
    it('should use existing suggestion if provided', () => {
      const error = createActionError(ActionErrorCode.TIMEOUT, 'Timeout', {
        suggestion: 'Custom suggestion',
      });

      const suggestion = ErrorSuggestionGenerator.generate(error);
      expect(suggestion).toBe('Custom suggestion');
    });

    it('should generate suggestion for ACTION_NOT_FOUND', () => {
      const error = createActionError(ActionErrorCode.ACTION_NOT_FOUND, 'Not found');
      const suggestion = ErrorSuggestionGenerator.generate(error);

      expect(suggestion).toContain('action list');
    });

    it('should generate suggestion for PARAM_MISSING', () => {
      const error = createActionError(ActionErrorCode.PARAM_MISSING, 'Missing param');
      const suggestion = ErrorSuggestionGenerator.generate(error);

      expect(suggestion).toContain('action describe');
    });

    it('should generate suggestion for MAX_DEPTH_EXCEEDED', () => {
      const error = createActionError(ActionErrorCode.MAX_DEPTH_EXCEEDED, 'Too deep');
      const suggestion = ErrorSuggestionGenerator.generate(error);

      expect(suggestion).toContain('max_depth');
    });

    it('should format error context', () => {
      const error = createActionError(ActionErrorCode.TIMEOUT, 'Timeout', {
        action: 'common:login',
        step: 2,
        sourcePath: '/actions/common.yaml',
        details: { timeout: 5000 },
      });

      const context = ErrorSuggestionGenerator.formatContext(error);

      expect(context).toContain('Action: common:login');
      expect(context).toContain('Step: 2');
      expect(context).toContain('Source: /actions/common.yaml');
      expect(context).toContain('timeout');
    });

    it('should format error with all components', () => {
      const error = createActionError(ActionErrorCode.ELEMENT_NOT_FOUND, 'Element not found', {
        action: 'common:login',
        step: 1,
        suggestion: 'Check selector',
      });

      const formatted = ErrorSuggestionGenerator.format(error);

      expect(formatted).toContain('[ELEMENT_NOT_FOUND]');
      expect(formatted).toContain('Element not found');
      expect(formatted).toContain('Action: common:login');
      expect(formatted).toContain('Step: 1');
      expect(formatted).toContain('Suggestion: Check selector');
    });

    it('should include stack trace when requested', () => {
      const error = createActionError(ActionErrorCode.TIMEOUT, 'Timeout');
      const formatted = ErrorSuggestionGenerator.format(error, { includeStack: true });

      expect(formatted).toContain('Stack Trace:');
    });
  });

  describe('isActionError', () => {
    it('should return true for ActionError', () => {
      const error = createActionError(ActionErrorCode.TIMEOUT, 'Timeout');
      expect(isActionError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Regular error');
      expect(isActionError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isActionError('string')).toBe(false);
      expect(isActionError(123)).toBe(false);
      expect(isActionError(null)).toBe(false);
      expect(isActionError(undefined)).toBe(false);
    });
  });

  describe('normalizeError', () => {
    it('should return ActionError as-is', () => {
      const error = createActionError(ActionErrorCode.TIMEOUT, 'Timeout');
      const normalized = normalizeError(error);

      expect(normalized).toBe(error);
    });

    it('should map Error to ActionError', () => {
      const error = new Error('Timeout 5000ms exceeded');
      const normalized = normalizeError(error, { step: 1 });

      expect(isActionError(normalized)).toBe(true);
      expect(normalized.code).toBe(ActionErrorCode.TIMEOUT);
      expect(normalized.step).toBe(1);
    });

    it('should convert string to ActionError', () => {
      const normalized = normalizeError('Something went wrong', { action: 'test' });

      expect(isActionError(normalized)).toBe(true);
      expect(normalized.code).toBe(ActionErrorCode.UNKNOWN_ERROR);
      expect(normalized.message).toBe('Something went wrong');
      expect(normalized.action).toBe('test');
    });

    it('should convert unknown type to ActionError', () => {
      const normalized = normalizeError({ foo: 'bar' });

      expect(isActionError(normalized)).toBe(true);
      expect(normalized.code).toBe(ActionErrorCode.UNKNOWN_ERROR);
    });
  });
});
