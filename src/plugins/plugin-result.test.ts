import { describe, expect, it } from 'vitest';
import { normalizePluginResult } from './plugin-result.js';

describe('normalizePluginResult', () => {
  it('normalizes primitive values', () => {
    expect(normalizePluginResult('ok')).toEqual({ text: 'ok' });
    expect(normalizePluginResult(1)).toEqual({ result: 1 });
    expect(normalizePluginResult(false)).toEqual({ result: false });
    expect(normalizePluginResult(null)).toEqual({ result: null });
    expect(normalizePluginResult(undefined)).toEqual({ result: null });
  });

  it('passes through plain object results', () => {
    expect(normalizePluginResult({ value: 'x', nested: { count: 1 } })).toEqual({
      value: 'x',
      nested: { count: 1 },
    });
  });

  it('unwraps legacy success envelopes', () => {
    const legacy = {
      id: 'p1',
      success: true,
      data: { found: true },
    };
    expect(normalizePluginResult(legacy)).toEqual({ found: true });
  });

  it('raises legacy error envelopes', () => {
    const legacy = {
      id: 'p1',
      success: false,
      error: 'boom',
    };
    expect(() => normalizePluginResult(legacy)).toThrow('boom');
  });

  it('rejects unsupported object types', () => {
    expect(() => normalizePluginResult(new Date())).toThrow('unsupported data type');
  });

  it('rejects non-serializable data', () => {
    expect(() =>
      normalizePluginResult({
        ok: true,
        bad: () => true,
      })
    ).toThrow('non-serializable data');
  });

  it('rejects circular data', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => normalizePluginResult(circular)).toThrow('circular references');
  });
});
