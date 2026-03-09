type PluginEnvelope = {
  id: string;
  success: boolean;
  data?: unknown;
  error?: unknown;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!isObject(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isPluginEnvelope = (value: unknown): value is PluginEnvelope => {
  if (!isPlainObject(value)) {
    return false;
  }
  return typeof value.id === 'string' && typeof value.success === 'boolean';
};

const findSerializationIssue = (value: unknown, path: string, seen: Set<object>): string | null => {
  if (value === undefined) {
    return `${path} is undefined`;
  }

  const valueType = typeof value;
  if (valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    return `${path} has unsupported type ${valueType}`;
  }

  if (!isObject(value)) {
    return null;
  }

  if (seen.has(value)) {
    return `${path} contains circular references`;
  }

  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const issue = findSerializationIssue(value[i], `${path}[${i}]`, seen);
      if (issue) {
        return issue;
      }
    }
    return null;
  }

  if (!isPlainObject(value)) {
    return `${path} must be a plain object or array`;
  }

  for (const [key, child] of Object.entries(value)) {
    const issue = findSerializationIssue(child, `${path}.${key}`, seen);
    if (issue) {
      return issue;
    }
  }

  return null;
};

function normalizeLegacyEnvelope(result: PluginEnvelope): unknown {
  if (!result.success) {
    const message =
      typeof result.error === 'string' && result.error.trim().length > 0
        ? result.error
        : 'Plugin command failed';
    throw new Error(message);
  }
  return result.data;
}

function toDataEnvelope(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { result: null };
  }

  if (typeof value === 'string') {
    return { text: value };
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return { result: value };
  }

  if (Array.isArray(value)) {
    return { result: value };
  }

  if (isPlainObject(value)) {
    return value;
  }

  throw new Error(
    'Plugin command returned unsupported data type. Return a plain object, string, number, boolean, array, or null.'
  );
}

/**
 * Normalize plugin command output into daemon response data.
 * Plugins should return business data or throw errors. Legacy response envelopes
 * ({ id, success, data/error }) are accepted for backward compatibility.
 */
export function normalizePluginResult(result: unknown): Record<string, unknown> {
  const normalized = isPluginEnvelope(result) ? normalizeLegacyEnvelope(result) : result;
  const data = toDataEnvelope(normalized);
  const issue = findSerializationIssue(data, 'result', new Set<object>());
  if (issue) {
    throw new Error(`Plugin command returned non-serializable data: ${issue}`);
  }
  return data;
}
