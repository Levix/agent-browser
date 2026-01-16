/**
 * Schema validation for action definition YAML files
 *
 * This module defines Zod schemas for validating action definitions
 * and provides validation functions with detailed error reporting.
 */

import { z } from 'zod';

// ============================================================================
// Schema Version
// ============================================================================

export const SCHEMA_VERSION = 1;

// ============================================================================
// Basic Schemas
// ============================================================================

/**
 * Parameter type values
 */
const ParamTypeSchema = z.enum(['string', 'number', 'boolean', 'enum', 'array', 'object']);

/**
 * Error handling strategy
 */
const OnErrorSchema = z.enum(['continue', 'abort', 'fallback']);

// ============================================================================
// Selector Schemas
// ============================================================================

/**
 * Selector can be a simple string or an object with fallback chain
 */
const SelectorWithFallbackSchema = z.object({
  primary: z.string().min(1, 'Primary selector cannot be empty'),
  fallback: z.array(z.string().min(1)).min(1, 'Fallback must have at least one selector'),
});

const SelectorDefinitionSchema = z.union([
  z.string().min(1, 'Selector cannot be empty'),
  SelectorWithFallbackSchema,
]);

// ============================================================================
// Parameter Schema
// ============================================================================

/**
 * Action parameter definition
 */
export const ActionParamSchema = z
  .object({
    type: ParamTypeSchema,
    description: z.string(),
    required: z.boolean().default(false),
    default: z.unknown().optional(),
    values: z.array(z.string()).optional(), // for enum type
    secret: z.boolean().optional(), // for sensitive data
  })
  .strict();

// ============================================================================
// Step Schema (with recursive fallback support)
// ============================================================================

/**
 * Base step schema without fallback (to avoid circular reference)
 */
const BaseActionStepSchema = z
  .object({
    action: z.string().min(1, 'Step action cannot be empty'),
    args: z.record(z.unknown()).default({}),
    when: z.string().optional(),
    output: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    retry: z.number().int().nonnegative().optional(),
    retryDelay: z.number().int().positive().optional(),
    onError: OnErrorSchema.optional(),
  })
  .strict();

/**
 * Action step with recursive fallback support
 */
export type ActionStepSchemaType = {
  action: string;
  args: Record<string, unknown>;
  when?: string;
  output?: string;
  timeout?: number;
  retry?: number;
  retryDelay?: number;
  onError?: 'continue' | 'abort' | 'fallback';
  fallback?: ActionStepSchemaType[];
};

export const ActionStepSchema: z.ZodSchema<ActionStepSchemaType> = BaseActionStepSchema.extend({
  fallback: z.lazy(() => z.array(ActionStepSchema)).optional(),
}) as z.ZodSchema<ActionStepSchemaType>;

// ============================================================================
// Verify Condition Schema
// ============================================================================

/**
 * Post-execution verification condition
 */
const VerifyConditionSchema = z
  .object({
    condition: z.string().min(1, 'Verify condition cannot be empty'),
    message: z.string().min(1, 'Verify message cannot be empty'),
  })
  .strict();

// ============================================================================
// Action Definition Schema
// ============================================================================

/**
 * Single action definition within a namespace
 */
export const ActionDefinitionSchema = z
  .object({
    description: z.string(),
    since: z.string().optional(),
    deprecated: z.boolean().optional(),
    deprecated_message: z.string().optional(),
    alias_of: z.string().optional(),
    params: z.record(ActionParamSchema).optional().default({}),
    steps: z.array(ActionStepSchema),
    returns: z.record(z.string()).optional(),
    verify: z.array(VerifyConditionSchema).optional(),
  })
  .strict();

// ============================================================================
// Compatibility Schema
// ============================================================================

/**
 * Version-specific overrides
 */
const VersionOverrideSchema = z
  .object({
    selectors: z.record(z.string()).optional(),
    steps: z.record(z.unknown()).optional(), // future: step overrides
  })
  .strict();

/**
 * Compatibility configuration for version-specific behavior
 */
const CompatibilitySchema = z
  .object({
    min_version: z.string().optional(),
    max_version: z.string().optional(),
    version_overrides: z.record(VersionOverrideSchema).optional(),
  })
  .strict();

// ============================================================================
// Namespace File Schema (Top-level)
// ============================================================================

/**
 * Top-level schema for a namespace definition file
 */
export const NamespaceFileSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION, {
      errorMap: () => ({ message: `Schema version must be ${SCHEMA_VERSION}` }),
    }),
    namespace: z
      .string()
      .min(1, 'Namespace cannot be empty')
      .regex(
        /^[a-z][a-z0-9_-]*$/,
        'Namespace must start with lowercase letter and contain only lowercase letters, numbers, hyphens, and underscores'
      ),
    version: z
      .string()
      .min(1, 'Version cannot be empty')
      .regex(
        /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/,
        'Version must follow semantic versioning (e.g., 1.0.0)'
      ),
    description: z.string().default(''),
    compatibility: CompatibilitySchema.optional(),
    selectors: z.record(SelectorDefinitionSchema).optional().default({}),
    actions: z
      .record(ActionDefinitionSchema)
      .refine((actions) => Object.keys(actions).length > 0, {
        message: 'At least one action must be defined',
      }),
  })
  .strict();

// ============================================================================
// Type Exports
// ============================================================================

export type NamespaceFile = z.infer<typeof NamespaceFileSchema>;
export type ActionDefinitionRaw = z.infer<typeof ActionDefinitionSchema>;
export type ActionParamRaw = z.infer<typeof ActionParamSchema>;
export type ActionStepRaw = z.infer<typeof ActionStepSchema>;
export type VerifyConditionRaw = z.infer<typeof VerifyConditionSchema>;
export type SelectorDefinitionRaw = z.infer<typeof SelectorDefinitionSchema>;
export type CompatibilityRaw = z.infer<typeof CompatibilitySchema>;

// ============================================================================
// Known Step Actions (for validation)
// ============================================================================

/**
 * Known step action types that can be used in steps
 */
export const KNOWN_STEP_ACTIONS = [
  'open', // navigate to URL
  'click', // click element
  'fill', // fill input field
  'type', // type text (with keyboard events)
  'press', // press key
  'wait', // wait for condition/timeout
  'snapshot', // take page snapshot
  'eval', // evaluate JavaScript
  'find', // find element (semantic locator)
  'run', // run another action
  'fail', // fail with message
] as const;

export type KnownStepAction = (typeof KNOWN_STEP_ACTIONS)[number];

// ============================================================================
// Variable Scopes (for validation)
// ============================================================================

/**
 * Valid variable scope prefixes for interpolation
 */
export const VARIABLE_SCOPES = ['params', 'env', 'selectors', 'steps'] as const;

export type VariableScope = (typeof VARIABLE_SCOPES)[number];

// ============================================================================
// Validation Helper Functions
// ============================================================================

/**
 * Format Zod validation errors into readable messages
 */
export function formatZodErrors(error: z.ZodError): string[] {
  return error.errors.map((err) => {
    const path = err.path.length > 0 ? err.path.join('.') : 'root';
    return `[${path}] ${err.message}`;
  });
}

/**
 * Check if a value matches the expected parameter type
 */
export function isValidParamType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string'; // enum values are validated separately
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return false;
  }
}

/**
 * Extract variable references from a string (e.g., "${params.name}")
 */
export function extractVariableReferences(str: string): string[] {
  const pattern = /\$\{([^}]+)\}/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(str)) !== null) {
    matches.push(match[1]);
  }

  return matches;
}

/**
 * Parse variable reference into scope and path
 * Example: "params.user.name" -> { scope: "params", path: ["user", "name"] }
 */
export function parseVariableReference(ref: string): { scope: string; path: string[] } | null {
  const parts = ref.split('.');
  if (parts.length === 0) {
    return null;
  }

  const scope = parts[0];
  const path = parts.slice(1);

  return { scope, path };
}

/**
 * Check if a variable scope is valid
 */
export function isValidVariableScope(scope: string): boolean {
  return VARIABLE_SCOPES.includes(scope as VariableScope);
}

/**
 * Check if a step action is known
 */
export function isKnownStepAction(action: string): boolean {
  return KNOWN_STEP_ACTIONS.includes(action as KnownStepAction);
}

// ============================================================================
// Dangerous Patterns (Security)
// ============================================================================

/**
 * Patterns that indicate potential security issues
 */
export const DANGEROUS_PATTERNS = [
  /__proto__/,
  /constructor/,
  /prototype/,
  /eval\(/,
  /Function\(/,
  /require\(/,
  /import\(/,
] as const;

/**
 * Check if a string contains dangerous patterns
 */
export function containsDangerousPattern(str: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(str));
}

/**
 * Allowed operators in expressions
 */
export const ALLOWED_OPERATORS = [
  '==',
  '!=',
  '===',
  '!==',
  '>',
  '<',
  '>=',
  '<=',
  '&&',
  '||',
  '!',
  '(',
  ')',
] as const;

/**
 * Check if an operator is allowed
 */
export function isAllowedOperator(op: string): boolean {
  return ALLOWED_OPERATORS.includes(op as (typeof ALLOWED_OPERATORS)[number]);
}

// ============================================================================
// Structural Validation Functions
// ============================================================================

import { parse as parseYAML } from 'yaml';
import type { ValidationResult, ValidationError, ValidationWarning } from './types.js';

/**
 * Validate a YAML action definition file
 *
 * @param content - YAML file content as string
 * @param sourcePath - Source file path (for error messages)
 * @returns Validation result with errors and warnings
 */
export function validateActionFile(
  content: string,
  sourcePath: string = '<unknown>'
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Step 1: Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYAML(content);
  } catch (error) {
    errors.push({
      code: 'YAML_PARSE_ERROR',
      message: `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      path: [],
      suggestion: 'Check YAML syntax (indentation, quotes, special characters)',
    });
    return { success: false, errors, warnings };
  }

  // Step 2: Schema validation with Zod
  const result = NamespaceFileSchema.safeParse(parsed);

  if (!result.success) {
    // Format Zod errors
    errors.push(
      ...result.error.errors.map((err) => ({
        code: 'SCHEMA_VALIDATION_ERROR',
        message: err.message,
        path: err.path.map(String),
        suggestion: getSuggestionForSchemaError(err),
      }))
    );
    return { success: false, errors, warnings };
  }

  const data = result.data;

  // Step 3: Validate parameter default values match their types
  for (const [actionName, actionDef] of Object.entries(data.actions)) {
    if (actionDef.params) {
      for (const [paramName, paramDef] of Object.entries(actionDef.params)) {
        if (paramDef.default !== undefined) {
          if (!isValidParamType(paramDef.default, paramDef.type)) {
            errors.push({
              code: 'PARAM_DEFAULT_TYPE_MISMATCH',
              message: `Parameter '${paramName}' default value type does not match declared type '${paramDef.type}'`,
              path: ['actions', actionName, 'params', paramName, 'default'],
              suggestion: `Change default value to match type '${paramDef.type}' or update the type declaration`,
            });
          }

          // For enum type, validate default is in values list
          if (paramDef.type === 'enum' && paramDef.values) {
            if (!paramDef.values.includes(String(paramDef.default))) {
              errors.push({
                code: 'PARAM_DEFAULT_NOT_IN_ENUM',
                message: `Parameter '${paramName}' default value '${paramDef.default}' is not in the enum values`,
                path: ['actions', actionName, 'params', paramName, 'default'],
                suggestion: `Use one of: ${paramDef.values.join(', ')}`,
              });
            }
          }
        }

        // Warn if enum type but no values specified
        if (paramDef.type === 'enum' && (!paramDef.values || paramDef.values.length === 0)) {
          warnings.push({
            code: 'ENUM_NO_VALUES',
            message: `Parameter '${paramName}' is of type 'enum' but has no values defined`,
            path: ['actions', actionName, 'params', paramName],
          });
        }
      }
    }
  }

  // Step 4: Validate selectors structure
  if (data.selectors) {
    for (const [selectorName, selectorDef] of Object.entries(data.selectors)) {
      if (typeof selectorDef === 'object' && 'fallback' in selectorDef) {
        // Check for empty fallback array
        if (selectorDef.fallback.length === 0) {
          warnings.push({
            code: 'EMPTY_FALLBACK',
            message: `Selector '${selectorName}' has an empty fallback array`,
            path: ['selectors', selectorName, 'fallback'],
          });
        }

        // Check for duplicate selectors in fallback chain
        const allSelectors = [selectorDef.primary, ...selectorDef.fallback];
        const uniqueSelectors = new Set(allSelectors);
        if (uniqueSelectors.size !== allSelectors.length) {
          warnings.push({
            code: 'DUPLICATE_SELECTOR',
            message: `Selector '${selectorName}' has duplicate selectors in its fallback chain`,
            path: ['selectors', selectorName],
          });
        }
      }
    }
  }

  // Step 5: Validate action steps structure
  for (const [actionName, actionDef] of Object.entries(data.actions)) {
    if (actionDef.steps.length === 0) {
      errors.push({
        code: 'NO_STEPS',
        message: `Action '${actionName}' has no steps defined`,
        path: ['actions', actionName, 'steps'],
        suggestion: 'Add at least one step to the action',
      });
    }

    // Validate each step
    actionDef.steps.forEach((step, stepIndex) => {
      validateStep(step, ['actions', actionName, 'steps', String(stepIndex)], errors, warnings);
    });
  }

  // Step 6: Check for deprecated actions without replacement info
  for (const [actionName, actionDef] of Object.entries(data.actions)) {
    if (actionDef.deprecated && !actionDef.deprecated_message && !actionDef.alias_of) {
      warnings.push({
        code: 'DEPRECATED_NO_MESSAGE',
        message: `Action '${actionName}' is deprecated but has no deprecation message or alias`,
        path: ['actions', actionName],
      });
    }
  }

  // Step 7: Perform deep semantic validation
  performDeepValidation(data, errors, warnings);

  return {
    success: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ============================================================================
// Deep Semantic Validation Functions
// ============================================================================

/**
 * Perform deep semantic validation on action definitions
 *
 * This includes:
 * - Parameter reference validation
 * - Selector reference validation
 * - Expression syntax validation
 * - Circular reference detection
 * - Action recursion detection
 */
export function performDeepValidation(
  data: NamespaceFile,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const availableSelectors = new Set(Object.keys(data.selectors || {}));

  for (const [actionName, actionDef] of Object.entries(data.actions)) {
    const actionPath = ['actions', actionName];
    const availableParams = new Set(Object.keys(actionDef.params || {}));

    // Track step outputs for validation
    const availableStepOutputs = new Set<string>();

    // Validate each step
    actionDef.steps.forEach((step, stepIndex) => {
      const stepPath = [...actionPath, 'steps', String(stepIndex)];

      // Validate step deeply
      validateStepDeep(
        step,
        stepPath,
        availableParams,
        availableSelectors,
        availableStepOutputs,
        data.actions,
        new Set<string>(),
        0,
        errors,
        warnings
      );

      // Add step output to available outputs
      if (step.output) {
        availableStepOutputs.add(step.output);
      }
    });

    // Validate returns expressions
    if (actionDef.returns) {
      for (const [returnKey, returnExpr] of Object.entries(actionDef.returns)) {
        validateVariableReferencesInString(
          returnExpr,
          [...actionPath, 'returns', returnKey],
          availableParams,
          availableSelectors,
          availableStepOutputs,
          errors
        );
      }
    }

    // Validate verify conditions
    if (actionDef.verify) {
      actionDef.verify.forEach((verify, verifyIndex) => {
        const verifyPath = [...actionPath, 'verify', String(verifyIndex)];

        // Validate condition expression
        validateExpression(verify.condition, [...verifyPath, 'condition'], errors);

        // Validate variable references in condition
        validateVariableReferencesInString(
          verify.condition,
          [...verifyPath, 'condition'],
          availableParams,
          availableSelectors,
          availableStepOutputs,
          errors
        );
      });
    }
  }

  // Check for alias cycles
  detectAliasCycles(data.actions, errors);
}

/**
 * Deeply validate a single step
 */
function validateStepDeep(
  step: ActionStepSchemaType,
  path: string[],
  availableParams: Set<string>,
  availableSelectors: Set<string>,
  availableStepOutputs: Set<string>,
  allActions: Record<string, ActionDefinitionRaw>,
  visitedActions: Set<string>,
  depth: number,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  // Check recursion depth
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) {
    errors.push({
      code: 'MAX_DEPTH_EXCEEDED',
      message: `Fallback nesting depth exceeds maximum of ${MAX_DEPTH}`,
      path,
      suggestion: 'Reduce fallback nesting depth or restructure the action',
    });
    return;
  }

  // Validate when condition if present
  if (step.when) {
    validateExpression(step.when, [...path, 'when'], errors);
    validateVariableReferencesInString(
      step.when,
      [...path, 'when'],
      availableParams,
      availableSelectors,
      availableStepOutputs,
      errors
    );
  }

  // Validate args object for variable references
  validateVariableReferencesInObject(
    step.args,
    [...path, 'args'],
    availableParams,
    availableSelectors,
    availableStepOutputs,
    errors
  );

  // Special validation for 'run' action (check for recursion)
  if (step.action === 'run') {
    const targetAction = step.args.action as string;
    if (targetAction && typeof targetAction === 'string') {
      // Check if action exists
      const actionName = targetAction.includes(':')
        ? targetAction.split(':').slice(1).join(':')
        : targetAction;

      if (!allActions[actionName]) {
        errors.push({
          code: 'ACTION_NOT_FOUND',
          message: `Referenced action '${targetAction}' does not exist`,
          path: [...path, 'args', 'action'],
          suggestion: 'Check the action name or define it in the same file',
        });
      } else if (visitedActions.has(actionName)) {
        errors.push({
          code: 'CIRCULAR_ACTION_REFERENCE',
          message: `Circular action reference detected: action '${targetAction}' calls itself`,
          path: [...path, 'args', 'action'],
          suggestion: 'Remove circular reference or use a different action',
        });
      }
    }
  }

  // Validate fallback steps recursively
  if (step.fallback) {
    // Check for circular fallback references
    const fallbackSteps = new Set<string>();

    step.fallback.forEach((fallbackStep, fallbackIndex) => {
      const fallbackPath = [...path, 'fallback', String(fallbackIndex)];
      const fallbackKey = JSON.stringify(fallbackStep);

      if (fallbackSteps.has(fallbackKey)) {
        warnings.push({
          code: 'DUPLICATE_FALLBACK_STEP',
          message: 'Duplicate fallback step detected',
          path: fallbackPath,
        });
      }

      fallbackSteps.add(fallbackKey);

      // Recursively validate fallback steps
      validateStepDeep(
        fallbackStep,
        fallbackPath,
        availableParams,
        availableSelectors,
        availableStepOutputs,
        allActions,
        visitedActions,
        depth + 1,
        errors,
        warnings
      );
    });
  }
}

/**
 * Validate variable references in a string
 */
function validateVariableReferencesInString(
  str: string,
  path: string[],
  availableParams: Set<string>,
  availableSelectors: Set<string>,
  availableStepOutputs: Set<string>,
  errors: ValidationError[]
): void {
  const refs = extractVariableReferences(str);

  for (const ref of refs) {
    const parsed = parseVariableReference(ref);

    if (!parsed) {
      errors.push({
        code: 'INVALID_VARIABLE_REFERENCE',
        message: `Invalid variable reference: \${${ref}}`,
        path,
        suggestion: 'Use format: ${scope.path} where scope is params, env, selectors, or steps',
      });
      continue;
    }

    const { scope, path: varPath } = parsed;

    // Check if scope is valid
    if (!isValidVariableScope(scope)) {
      errors.push({
        code: 'INVALID_VARIABLE_SCOPE',
        message: `Invalid variable scope '${scope}' in \${${ref}}`,
        path,
        suggestion: `Use one of: ${VARIABLE_SCOPES.join(', ')}`,
      });
      continue;
    }

    // Validate reference based on scope
    if (scope === 'params') {
      const paramName = varPath[0];
      if (paramName && !availableParams.has(paramName)) {
        errors.push({
          code: 'PARAM_NOT_DEFINED',
          message: `Parameter '${paramName}' referenced but not defined`,
          path,
          suggestion: 'Define this parameter in the action params section',
        });
      }
    } else if (scope === 'selectors') {
      const selectorName = varPath[0];
      if (selectorName && !availableSelectors.has(selectorName)) {
        errors.push({
          code: 'SELECTOR_NOT_DEFINED',
          message: `Selector '${selectorName}' referenced but not defined`,
          path,
          suggestion: 'Define this selector in the selectors section',
        });
      }
    } else if (scope === 'steps') {
      const stepOutput = varPath[0];
      if (stepOutput && !availableStepOutputs.has(stepOutput)) {
        errors.push({
          code: 'STEP_OUTPUT_NOT_DEFINED',
          message: `Step output '${stepOutput}' referenced but not defined by any previous step`,
          path,
          suggestion: 'Ensure a previous step defines this output',
        });
      }
    }
  }
}

/**
 * Validate variable references in an object recursively
 */
function validateVariableReferencesInObject(
  obj: Record<string, unknown>,
  path: string[],
  availableParams: Set<string>,
  availableSelectors: Set<string>,
  availableStepOutputs: Set<string>,
  errors: ValidationError[]
): void {
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = [...path, key];

    if (typeof value === 'string') {
      validateVariableReferencesInString(
        value,
        currentPath,
        availableParams,
        availableSelectors,
        availableStepOutputs,
        errors
      );
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'string') {
          validateVariableReferencesInString(
            item,
            [...currentPath, String(index)],
            availableParams,
            availableSelectors,
            availableStepOutputs,
            errors
          );
        } else if (typeof item === 'object' && item !== null) {
          validateVariableReferencesInObject(
            item as Record<string, unknown>,
            [...currentPath, String(index)],
            availableParams,
            availableSelectors,
            availableStepOutputs,
            errors
          );
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      validateVariableReferencesInObject(
        value as Record<string, unknown>,
        currentPath,
        availableParams,
        availableSelectors,
        availableStepOutputs,
        errors
      );
    }
  }
}

/**
 * Validate expression syntax (basic check)
 */
function validateExpression(expr: string, path: string[], errors: ValidationError[]): void {
  // Check for dangerous patterns
  if (containsDangerousPattern(expr)) {
    errors.push({
      code: 'DANGEROUS_PATTERN',
      message: 'Expression contains dangerous patterns',
      path,
      suggestion: 'Remove dangerous patterns like __proto__, eval, constructor',
    });
    return;
  }

  // Check for balanced parentheses
  let parenCount = 0;
  for (const char of expr) {
    if (char === '(') parenCount++;
    if (char === ')') parenCount--;
    if (parenCount < 0) {
      errors.push({
        code: 'UNBALANCED_PARENTHESES',
        message: 'Expression has unbalanced parentheses',
        path,
        suggestion: 'Ensure all opening parentheses have matching closing parentheses',
      });
      return;
    }
  }

  if (parenCount !== 0) {
    errors.push({
      code: 'UNBALANCED_PARENTHESES',
      message: 'Expression has unbalanced parentheses',
      path,
      suggestion: 'Ensure all opening parentheses have matching closing parentheses',
    });
  }

  // Check for empty expression after variable interpolation
  const withoutVars = expr.replace(/\$\{[^}]+\}/g, 'VALUE');
  if (withoutVars.trim().length === 0) {
    errors.push({
      code: 'EMPTY_EXPRESSION',
      message: 'Expression is empty or contains only variable references',
      path,
      suggestion: 'Add comparison or logical operators',
    });
  }
}

/**
 * Detect circular alias references
 */
function detectAliasCycles(
  actions: Record<string, ActionDefinitionRaw>,
  errors: ValidationError[]
): void {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(actionName: string, path: string[]): void {
    if (recursionStack.has(actionName)) {
      errors.push({
        code: 'CIRCULAR_ALIAS',
        message: `Circular alias detected: ${[...recursionStack, actionName].join(' -> ')}`,
        path,
        suggestion: 'Remove circular alias reference',
      });
      return;
    }

    if (visited.has(actionName)) {
      return;
    }

    visited.add(actionName);
    recursionStack.add(actionName);

    const action = actions[actionName];
    if (action?.alias_of) {
      const targetActionName = action.alias_of.includes(':')
        ? action.alias_of.split(':').slice(1).join(':')
        : action.alias_of;

      if (actions[targetActionName]) {
        dfs(targetActionName, [...path, 'alias_of']);
      }
    }

    recursionStack.delete(actionName);
  }

  for (const actionName of Object.keys(actions)) {
    dfs(actionName, ['actions', actionName]);
  }
}

/**
 * Validate a single step structure
 */
function validateStep(
  step: ActionStepSchemaType,
  path: string[],
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  // Check if step action is known
  if (!isKnownStepAction(step.action)) {
    warnings.push({
      code: 'UNKNOWN_STEP_ACTION',
      message: `Step action '${step.action}' is not a known built-in action`,
      path: [...path, 'action'],
    });
  }

  // Validate retry configuration
  if (step.retry !== undefined) {
    if (step.retry < 0) {
      errors.push({
        code: 'INVALID_RETRY',
        message: 'Retry count cannot be negative',
        path: [...path, 'retry'],
        suggestion: 'Use a non-negative integer for retry count',
      });
    }

    if (step.retry > 10) {
      warnings.push({
        code: 'HIGH_RETRY_COUNT',
        message: `Retry count ${step.retry} is unusually high`,
        path: [...path, 'retry'],
      });
    }
  }

  // Validate timeout
  if (step.timeout !== undefined && step.timeout <= 0) {
    errors.push({
      code: 'INVALID_TIMEOUT',
      message: 'Timeout must be positive',
      path: [...path, 'timeout'],
      suggestion: 'Use a positive number in milliseconds',
    });
  }

  // Validate onError with fallback
  if (step.onError === 'fallback' && (!step.fallback || step.fallback.length === 0)) {
    errors.push({
      code: 'FALLBACK_MISSING',
      message: 'onError is set to "fallback" but no fallback steps are defined',
      path: [...path, 'onError'],
      suggestion: 'Either define fallback steps or change onError strategy',
    });
  }

  // Recursively validate fallback steps
  if (step.fallback) {
    step.fallback.forEach((fallbackStep, index) => {
      validateStep(fallbackStep, [...path, 'fallback', String(index)], errors, warnings);
    });
  }

  // Check for dangerous patterns in when condition
  if (step.when && containsDangerousPattern(step.when)) {
    errors.push({
      code: 'DANGEROUS_PATTERN',
      message: 'Step condition contains dangerous patterns',
      path: [...path, 'when'],
      suggestion: 'Remove dangerous patterns like __proto__, eval, constructor',
    });
  }
}

/**
 * Get suggestion for a Zod schema error
 */
function getSuggestionForSchemaError(error: z.ZodIssue): string | undefined {
  const { code, path } = error;

  if (code === 'invalid_type') {
    const lastPath = path[path.length - 1];
    if (lastPath === 'namespace') {
      return 'Namespace must be a lowercase string starting with a letter';
    }
    if (lastPath === 'version') {
      return 'Version must follow semantic versioning (e.g., 1.0.0)';
    }
  }

  if (code === 'invalid_string' && path.includes('namespace')) {
    return 'Use only lowercase letters, numbers, hyphens, and underscores';
  }

  if (code === 'invalid_string' && path.includes('version')) {
    return 'Use semantic versioning format: MAJOR.MINOR.PATCH (e.g., 1.0.0)';
  }

  return undefined;
}

/**
 * Validate action definition structure (for runtime use)
 *
 * @param data - Parsed action definition object
 * @returns Validation result
 */
export function validateActionStructure(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const result = NamespaceFileSchema.safeParse(data);

  if (!result.success) {
    errors.push(
      ...result.error.errors.map((err) => ({
        code: 'SCHEMA_VALIDATION_ERROR',
        message: err.message,
        path: err.path.map(String),
      }))
    );
  }

  return {
    success: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ============================================================================
// Runtime Parameter Validation
// ============================================================================

/**
 * Runtime parameter validation result
 */
export interface ValidateParamsResult {
  success: boolean;
  values?: Record<string, unknown>;
  errors?: Array<{
    code: string;
    message: string;
    param: string;
  }>;
}

/**
 * Convert string value to target type
 */
function convertParamValue(
  value: unknown,
  paramType: string,
  paramName: string
): { success: boolean; value?: unknown; error?: string } {
  // If value is already correct type, return as-is
  if (paramType === 'string' && typeof value === 'string') {
    return { success: true, value };
  }
  if (paramType === 'number' && typeof value === 'number') {
    return { success: true, value };
  }
  if (paramType === 'boolean' && typeof value === 'boolean') {
    return { success: true, value };
  }
  if (paramType === 'array' && Array.isArray(value)) {
    return { success: true, value };
  }
  if (
    paramType === 'object' &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    return { success: true, value };
  }

  // Try to convert string values to target type
  if (typeof value === 'string') {
    switch (paramType) {
      case 'number': {
        const num = Number(value);
        if (isNaN(num)) {
          return { success: false, error: `Cannot convert "${value}" to number` };
        }
        return { success: true, value: num };
      }
      case 'boolean': {
        const lower = value.toLowerCase();
        if (lower === 'true' || lower === '1' || lower === 'yes') {
          return { success: true, value: true };
        }
        if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') {
          return { success: true, value: false };
        }
        return { success: false, error: `Cannot convert "${value}" to boolean` };
      }
      case 'array': {
        try {
          const parsed = JSON.parse(value);
          if (!Array.isArray(parsed)) {
            return { success: false, error: `Value "${value}" is not a valid array` };
          }
          return { success: true, value: parsed };
        } catch {
          return { success: false, error: `Cannot parse "${value}" as JSON array` };
        }
      }
      case 'object': {
        try {
          const parsed = JSON.parse(value);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return { success: false, error: `Value "${value}" is not a valid object` };
          }
          return { success: true, value: parsed };
        } catch {
          return { success: false, error: `Cannot parse "${value}" as JSON object` };
        }
      }
      case 'enum':
        // For enum type, keep as string - enum validation happens separately
        return { success: true, value };
      default:
        return { success: false, error: `Unknown parameter type: ${paramType}` };
    }
  }

  // Cannot convert
  return {
    success: false,
    error: `Cannot convert ${typeof value} to ${paramType} for parameter "${paramName}"`,
  };
}

/**
 * Validate runtime parameters against action definition
 *
 * This performs:
 * 1. Type checking and conversion
 * 2. Required parameter validation
 * 3. Enum value validation
 * 4. Default value application
 *
 * @param params - Runtime parameter values
 * @param paramDefs - Parameter definitions from action
 * @returns Validation result with converted values
 */
export function validateParams(
  params: Record<string, unknown>,
  paramDefs: Record<
    string,
    {
      type: string;
      description: string;
      required?: boolean;
      default?: unknown;
      values?: string[];
      secret?: boolean;
    }
  >
): ValidateParamsResult {
  const errors: Array<{ code: string; message: string; param: string }> = [];
  const values: Record<string, unknown> = {};

  // Check for required parameters
  for (const [name, def] of Object.entries(paramDefs)) {
    const hasValue = name in params && params[name] !== undefined && params[name] !== null;

    if (def.required && !hasValue) {
      // Check if there's a default value
      if (def.default === undefined) {
        errors.push({
          code: 'PARAM_MISSING',
          message: `Required parameter "${name}" is missing`,
          param: name,
        });
        continue;
      }
      // Use default value
      values[name] = def.default;
      continue;
    }

    // If not required and not provided, use default if available
    if (!hasValue) {
      if (def.default !== undefined) {
        values[name] = def.default;
      }
      continue;
    }

    const providedValue = params[name];

    // Type checking and conversion
    const conversion = convertParamValue(providedValue, def.type, name);
    if (!conversion.success) {
      errors.push({
        code: 'PARAM_TYPE_ERROR',
        message: conversion.error || `Type mismatch for parameter "${name}"`,
        param: name,
      });
      continue;
    }

    const convertedValue = conversion.value;

    // Enum validation
    if (def.type === 'enum' && def.values) {
      if (typeof convertedValue !== 'string') {
        errors.push({
          code: 'PARAM_TYPE_ERROR',
          message: `Enum parameter "${name}" must be a string`,
          param: name,
        });
        continue;
      }

      if (!def.values.includes(convertedValue)) {
        errors.push({
          code: 'PARAM_ENUM_ERROR',
          message: `Parameter "${name}" must be one of: ${def.values.join(', ')}. Got: ${convertedValue}`,
          param: name,
        });
        continue;
      }
    }

    values[name] = convertedValue;
  }

  // Check for unknown parameters (parameters provided but not defined)
  for (const name of Object.keys(params)) {
    if (!(name in paramDefs)) {
      errors.push({
        code: 'PARAM_UNKNOWN',
        message: `Unknown parameter "${name}"`,
        param: name,
      });
    }
  }

  return {
    success: errors.length === 0,
    values: errors.length === 0 ? values : undefined,
    errors: errors.length > 0 ? errors : undefined,
  };
}
